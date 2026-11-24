import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Database } from "@/server/db";
import { leadEnquiries, leads, leadSources, projects, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { leadLink, notify } from "@/modules/notifications/service";
import { parse } from "@/modules/clients/support";
import { assertCan } from "./policy";
import { audit, loadAccessibleLead, logActivity } from "./support";
import { assertWorkable } from "./verification";

/**
 * Enquiry history (client, 24 Nov 2026): every time a customer enquires about a project, with the date,
 * channel, agent and notes. The first enquiry is recorded with the lead; asking again about the same
 * project is a repeat on that lead, never a second lead. Another project is its own lead, same customer.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const OTHER_CHANNEL = "other";
export type EnquiryChannel = { sourceId: string | null; channelOther: string | null };

/** The lead's first enquiry, written when the lead is created. */
export async function recordFirstEnquiry(tx: Tx, actor: Actor, lead: { id: string; sourceId: string; ownerId: string | null; note: string | null; at: Date }) {
  await tx.insert(leadEnquiries).values({ leadId: lead.id, isRepeat: false, enquiredAt: lead.at, sourceId: lead.sourceId, agentId: lead.ownerId, recordedById: actor.id, note: lead.note });
}

/**
 * A repeat enquiry on a lead, inside the caller's transaction. The agent is told, except on a booked lead
 * (only recorded). A lost lead isn't reopened: its agent decides.
 */
export async function recordRepeat(
  tx: Tx,
  actor: Actor,
  lead: Pick<typeof leads.$inferSelect, "id" | "code" | "name" | "stage" | "ownerId" | "regeneratedAt">,
  channel: EnquiryChannel,
  { at, note, now = new Date() }: { at: Date; note: string | null; now?: Date },
) {
  const [row] = await tx
    .insert(leadEnquiries)
    .values({ leadId: lead.id, isRepeat: true, enquiredAt: at, sourceId: channel.sourceId, channelOther: channel.channelOther, agentId: lead.ownerId, recordedById: actor.id, note })
    .returning({ id: leadEnquiries.id });
  const latest = lead.regeneratedAt && lead.regeneratedAt > at ? lead.regeneratedAt : at;
  await tx.update(leads).set({ isRegenerated: true, regeneratedAt: latest, updatedAt: now }).where(eq(leads.id, lead.id));
  const [source] = channel.sourceId ? await tx.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, channel.sourceId)) : [];
  const name = channel.channelOther ?? source?.name ?? null;
  await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "regenerated", body: note, data: { channel: name, enquiredAt: at.toISOString(), by: actor.name } });
  await audit(tx, actor, "lead.regenerated", lead.id, null, { enquiryId: row.id, channel: name, enquiredAt: at.toISOString() });
  if (lead.ownerId && lead.stage !== "booked") {
    await notify(
      tx,
      [
        {
          userId: lead.ownerId,
          type: "lead_regenerated",
          title: `Repeat enquiry · ${lead.name}`,
          body: `Lead ${lead.code} enquired again${name ? ` (${name})` : ""}.${lead.stage === "lost_lead" ? " This lead is Lost: decide whether to reopen it." : ""}`,
          link: leadLink(lead.id),
          dedupeKey: `lead_regenerated:${row.id}`,
        },
      ],
      actor.id,
    );
  }
  return row.id;
}

/** A source from the active list, or Other with a typed name. */
export async function resolveChannel(tx: Tx, channel: string, other: string | undefined): Promise<EnquiryChannel> {
  const bad = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });
  if (channel === OTHER_CHANNEL) {
    if (!other) throw bad("channelOther", "Name the channel");
    return { sourceId: null, channelOther: other };
  }
  const [source] = await tx.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.id, channel), eq(leadSources.isActive, true)));
  if (!source) throw bad("channel", "Choose a channel from the list");
  return { sourceId: source.id, channelOther: null };
}

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().transform((v) => v || undefined);
const repeatSchema = z.object({
  channel: z.union([z.literal(OTHER_CHANNEL), z.uuid()], "Choose the channel"),
  channelOther: text(80),
  at: z.iso.datetime({ offset: true, message: "Pick the date and time" }).optional(),
  note: text(1000),
});

/** The agent (or an Admin) records that the customer asked again about this lead's project. */
export async function recordRepeatEnquiry(db: Database, actor: Actor, leadId: string, input: unknown, now = new Date()) {
  assertCan(actor, "edit");
  const data = parse(repeatSchema, input);
  const at = data.at ? new Date(data.at) : now;
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    assertWorkable(actor, lead);
    if (at.getTime() > now.getTime() + 60_000) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { at: "The date can't be in the future" } });
    if (at < lead.createdAt) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { at: "That is before the lead was added" } });
    const channel = await resolveChannel(tx, data.channel, data.channelOther);
    return { enquiryId: await recordRepeat(tx, actor, lead, channel, { at, note: data.note ?? null, now }) };
  });
}

/**
 * A repeat found in an approved import. The same sheet uploaded twice must not record everyone again, so
 * one per lead, channel and Pakistan day. Returns whether it was recorded.
 */
export async function recordImportedRepeat(db: Database, actor: Actor, leadId: string, sourceId: string, note: string | null, now = new Date()) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
    if (!lead || lead.deletedAt) return false;
    const today = new Date(`${new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+05:00`);
    const [same] = await tx
      .select({ id: leadEnquiries.id })
      .from(leadEnquiries)
      .where(and(eq(leadEnquiries.leadId, leadId), eq(leadEnquiries.sourceId, sourceId), gte(leadEnquiries.createdAt, today)))
      .limit(1);
    if (same) return false;
    await recordRepeat(tx, actor, lead, { sourceId, channelOther: null }, { at: now, note, now });
    return true;
  });
}

const agent = alias(users, "enquiry_agent");
const recorder = alias(users, "enquiry_recorder");

/** Every enquiry on these leads, newest first. The caller decides which leads the actor may see. */
export async function enquiriesFor(db: Database, leadIds: string[]) {
  if (leadIds.length === 0) return [];
  return db
    .select({
      id: leadEnquiries.id,
      leadId: leadEnquiries.leadId,
      leadCode: leads.code,
      projectName: projects.name,
      isRepeat: leadEnquiries.isRepeat,
      enquiredAt: leadEnquiries.enquiredAt,
      channel: sql<string | null>`coalesce(${leadEnquiries.channelOther}, ${leadSources.name})`,
      agentName: agent.name,
      recordedBy: recorder.name,
      note: leadEnquiries.note,
    })
    .from(leadEnquiries)
    .innerJoin(leads, eq(leads.id, leadEnquiries.leadId))
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(leadSources, eq(leadSources.id, leadEnquiries.sourceId))
    .leftJoin(agent, eq(agent.id, leadEnquiries.agentId))
    .leftJoin(recorder, eq(recorder.id, leadEnquiries.recordedById))
    .where(inArray(leadEnquiries.leadId, leadIds))
    .orderBy(desc(leadEnquiries.enquiredAt), desc(leadEnquiries.createdAt));
}
export type EnquiryRow = Awaited<ReturnType<typeof enquiriesFor>>[number];
