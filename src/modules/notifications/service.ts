import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { appSettings, auditLogs, followUps, leads, notifications, teamMembers, teams } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { followUpLeadActive, type DbOrTx } from "@/modules/leads/support";
import { parseTask } from "@/modules/tasks/support";
import { currentTargets, TARGET_METRICS } from "@/modules/targets/service";
import { TARGET_PERIOD_LABELS } from "@/modules/targets/period";

/**
 * In-app notifications (FR-006). Only documented events raise them:
 * - lead_assigned / lead_regenerated: the lead's owner ("Notify owner", USER_FLOWS.md §1);
 * - lost_requested: the managers of the owner's teams; lost_rejected: the requester (§3);
 * - follow_up_soon: the follow-up's assignee, when due within the reminder window (FR-006).
 * Nobody is notified about their own action. Each (recipient, event key) exists once.
 */
export type NotificationType = typeof notifications.$inferInsert.type;
export type NewNotification = { userId: string; type: NotificationType; title: string; body?: string | null; link?: string | null; dedupeKey: string };

export const NOTIFICATION_PAGE_SIZE = 50;
export const BELL_LIMIT = 10;
export const REMINDER_SETTING_KEY = "notifications.follow_up_reminder_minutes";
export const MIN_REMINDER_MINUTES = 1;
export const MAX_REMINDER_MINUTES = 1440;

export const leadLink = (leadId: string) => `/dashboard/leads/${leadId}`;

/** Inserts notifications, skipping the actor and anything already sent for the same event. */
export async function notify(db: DbOrTx, items: NewNotification[], actorId: string | null) {
  const rows = items.filter((n) => n.userId !== actorId);
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(notifications)
    .values(rows.map((n) => ({ ...n, body: n.body ?? null, link: n.link ?? null })))
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  return inserted.length;
}

/** Active managers of the teams the user belongs to (recipients of a lost request). */
export async function teamManagersOf(db: DbOrTx, userId: string) {
  const rows = await db
    .selectDistinct({ id: teams.managerId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teams.isActive, true), sql`${teams.managerId} is not null`));
  return rows.map((r) => r.id!);
}

// ─── Follow-up reminders ──────────────────────────────────────────────────────

/** Minutes before a follow-up is due that its reminder appears; null = reminders off (not configured). */
export async function reminderMinutes(db: DbOrTx) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, REMINDER_SETTING_KEY)).limit(1);
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) && n >= MIN_REMINDER_MINUTES && n <= MAX_REMINDER_MINUTES ? n : null;
}

/**
 * Creates "follow-up soon" notifications for the actor's pending follow-ups due within the window.
 * Called when notifications are read, so no scheduler is needed; the event key includes the due
 * time, so a rescheduled follow-up reminds again but a poll never repeats a reminder.
 */
export async function syncFollowUpReminders(db: DbOrTx, actor: Actor, now = new Date()) {
  const minutes = await reminderMinutes(db);
  if (minutes === null) return 0;
  const due = await db
    .select({ id: followUps.id, dueAt: followUps.dueAt, note: followUps.note, leadId: leads.id, leadName: leads.name })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .where(
      and(
        eq(followUps.assigneeId, actor.id),
        eq(followUps.status, "pending"),
        gte(followUps.dueAt, now),
        lte(followUps.dueAt, new Date(now.getTime() + minutes * 60_000)),
        isNull(leads.deletedAt),
        followUpLeadActive(),
      ),
    );
  return notify(
    db,
    due.map((f) => ({
      userId: actor.id,
      type: "follow_up_soon" as const,
      title: `Follow-up soon · ${f.leadName}`,
      body: f.note,
      link: leadLink(f.leadId),
      dedupeKey: `follow_up_soon:${f.id}:${f.dueAt.toISOString()}`,
    })),
    null,
  );
}

const reminderSchema = z
  .object({
    minutes: z.union([
      z.literal("").transform(() => null),
      z.null(),
      z.coerce.number("Enter minutes").int("Use whole minutes").min(MIN_REMINDER_MINUTES, "At least 1 minute").max(MAX_REMINDER_MINUTES, "At most 1,440 minutes (24 hours)"),
    ]),
  })
  .strict();

/** Super admin / admin. Blank turns follow-up reminders off. Audited as an app setting. */
export async function updateReminderMinutes(db: Database, actor: Actor, input: unknown) {
  if (actor.role !== "super_admin" && actor.role !== "admin") throw forbidden();
  const { minutes } = parseTask(reminderSchema, input);
  return db.transaction(async (tx) => {
    const before = await reminderMinutes(tx);
    if (before === minutes) return { changed: false };
    if (minutes === null) await tx.delete(appSettings).where(eq(appSettings.key, REMINDER_SETTING_KEY));
    else
      await tx
        .insert(appSettings)
        .values({ key: REMINDER_SETTING_KEY, value: String(minutes), updatedById: actor.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: String(minutes), updatedById: actor.id, updatedAt: new Date() } });
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      ip: actor.ip ?? null,
      action: "app.setting",
      entity: "app_setting",
      entityId: REMINDER_SETTING_KEY,
      before: { value: before === null ? "" : String(before) },
      after: { value: minutes === null ? "" : String(minutes) },
    });
    return { changed: true };
  });
}

// ─── Targets met ──────────────────────────────────────────────────────────────

/**
 * target_met (owner, 14 Nov 2026): when an agent reaches a goal of today's, this week's or this
 * month's target, the agent and their team admins are told once per goal and period. Checked when
 * the agent's notifications are read (the app polls them), so no scheduler is needed.
 */
export async function syncTargetsMet(db: Database, actor: Actor, now = new Date()) {
  if (actor.role !== "agent") return 0;
  const periods = await currentTargets(db, actor.id, now);
  const met = periods.flatMap((p) => p.met.map((key) => ({ p, metric: TARGET_METRICS.find((m) => m.key === key)! })));
  if (met.length === 0) return 0;
  const admins = await teamManagersOf(db, actor.id);
  const items: NewNotification[] = [];
  for (const { p, metric } of met) {
    const period = TARGET_PERIOD_LABELS[p.period].toLowerCase();
    const link = `/dashboard/targets?period=${p.period}&anchor=${p.start}`;
    const figures = `${p.achieved[metric.key]} of ${p.goals![metric.key]}`;
    const key = `target_met:${actor.id}:${p.period}:${p.start}:${metric.key}`;
    items.push({ userId: actor.id, type: "target_met", title: `Target met: ${metric.label} (${period})`, body: `You reached ${figures}. Well done!`, link, dedupeKey: key });
    for (const adminId of admins) {
      items.push({ userId: adminId, type: "target_met", title: `${actor.name} met a ${period} target: ${metric.label}`, body: `Reached ${figures}.`, link, dedupeKey: key });
    }
  }
  // actorId null: the agent is told about their own achievement too.
  return notify(db, items, null);
}

// ─── Reading ──────────────────────────────────────────────────────────────────

const listSchema = z.object({
  unread: z.enum(["1", "true"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** The actor's own notifications, newest first, plus the unread count. Never anyone else's. */
export async function listNotifications(db: Database, actor: Actor, input: unknown = {}, now = new Date()) {
  const query = listSchema.parse(input ?? {});
  await syncFollowUpReminders(db, actor, now);
  await syncTargetsMet(db, actor, now);
  const own = eq(notifications.userId, actor.id);
  const where = query.unread ? and(own, isNull(notifications.readAt)) : own;
  const [[{ total }], [{ unread }]] = await Promise.all([
    db.select({ total: count() }).from(notifications).where(where),
    db.select({ unread: count() }).from(notifications).where(and(own, isNull(notifications.readAt))),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      // A reminder created before its lead was marked Lost stays listed (history) but no longer pops up (F-2).
      popup: sql<boolean>`${notifications.type} = 'follow_up_soon' and not exists (select 1 from ${leads} where ${notifications.link} = '/dashboard/leads/' || ${leads.id}::text and ${leads.stage} = 'lost_lead')`,
    })
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATION_PAGE_SIZE)
    .offset((page - 1) * NOTIFICATION_PAGE_SIZE);
  return { query: { ...query, page }, total, page, pageCount, unread, rows };
}
export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>["rows"][number];

/** Marks one of the actor's notifications read; 404 for anyone else's. */
export async function markRead(db: Database, actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Notification");
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)))
    .returning({ id: notifications.id });
  if (!row) throw notFound("Notification");
  return { read: true };
}

export async function markAllRead(db: Database, actor: Actor) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { marked: rows.length };
}

/** For tests and admin checks: unread notifications per user id. */
export async function unreadCounts(db: DbOrTx, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ userId: notifications.userId, n: count() })
    .from(notifications)
    .where(and(inArray(notifications.userId, userIds), isNull(notifications.readAt)))
    .groupBy(notifications.userId);
  return new Map(rows.map((r) => [r.userId, r.n]));
}

