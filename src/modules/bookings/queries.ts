import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { bookingStageHistory, bookings, clients, leads, projects, units, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { canAccessClient } from "@/modules/clients/policy";
import { formatPhone } from "@/modules/leads/phone";
import { canAccessLead } from "@/modules/leads/policy";
import { scopeFilter as leadScopeFilter, teamMemberIds } from "@/modules/leads/support";
import { BOOKING_PAGE_SIZE, CLOSED_STAGES, HOLD_STAGES, MILESTONE_RATIO, nextStage } from "./constants";
import { bookingScope, canAccessBooking, canDoBooking, canMoveTo } from "./policy";
import { netPaid, netPaidByBooking, toPaisa } from "@/modules/finance/ledger";
import { businessToday } from "./today";
import { bookingListQuerySchema } from "./validation";

const agent = alias(users, "agent");

function bookingScopeFilter(actor: Actor, members: string[]): SQL {
  switch (bookingScope(actor.role)) {
    case "all":
      return sql`true`;
    case "team":
      return inArray(bookings.agentId, [actor.id, ...members]);
    case "own":
      return eq(bookings.agentId, actor.id);
    default:
      throw forbidden();
  }
}

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const parts: SQL[] = [ilike(leads.name, term), ilike(leads.code, term), ilike(units.unitNo, term)];
  if (digits.length >= 3) parts.push(ilike(leads.phoneE164, `%${digits}%`));
  return or(...parts);
}

/**
 * Paid comes only from posted Finance records (payments − reversals; Q-F1 default): bookings
 * without records show 0. Outstanding = total − paid (FR-203); milestone = paid ≥ 30% (FR-083).
 */
function money(totalSale: number, paid: number) {
  const outstanding = (toPaisa(totalSale) - toPaisa(paid)) / 100;
  return { paid, total: totalSale, outstanding, milestoneMet: toPaisa(paid) >= toPaisa(totalSale * MILESTONE_RATIO) };
}

/** Hold has passed its date while the booking still waits for the token (flag only; no auto-release until Q-B2). */
function holdOverdue(b: { stage: (typeof bookings.$inferSelect)["stage"]; reservedUntil: string | null }, today: string) {
  return Boolean(b.reservedUntil && b.reservedUntil < today && HOLD_STAGES.includes(b.stage));
}

const rowSelection = {
  id: bookings.id,
  stage: bookings.stage,
  totalSale: bookings.totalSale,
  reservedUntil: bookings.reservedUntil,
  updatedAt: bookings.updatedAt,
  createdAt: bookings.createdAt,
  leadId: leads.id,
  leadName: leads.name,
  leadCode: leads.code,
  agentName: agent.name,
  unitId: units.id,
  unitNo: units.unitNo,
  projectName: projects.name,
};

export type BookingRow = Awaited<ReturnType<typeof listBookings>>["rows"][number];

/** FR-085 list: search (lead, code, phone, unit), project (header project by default, or all), stage. */
export async function listBookings(db: Database, actor: Actor, rawQuery: unknown, defaultProjectId: string | null, today: string) {
  if (!canDoBooking(actor, "view")) throw forbidden();
  const query = bookingListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const projectId = query.project === "all" ? null : (query.project ?? defaultProjectId);
  const where = and(
    bookingScopeFilter(actor, members),
    projectId ? eq(bookings.projectId, projectId) : undefined,
    query.stage ? eq(bookings.stage, query.stage) : undefined,
    searchCondition(query.q),
  );
  const from = () =>
    db
      .select(rowSelection)
      .from(bookings)
      .innerJoin(leads, eq(leads.id, bookings.leadId))
      .innerJoin(units, eq(units.id, bookings.unitId))
      .innerJoin(projects, eq(projects.id, bookings.projectId))
      .leftJoin(agent, eq(agent.id, bookings.agentId));
  const [{ total }] = await db
    .select({ total: count() })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / BOOKING_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await from()
    .where(where)
    .orderBy(desc(bookings.updatedAt))
    .limit(BOOKING_PAGE_SIZE)
    .offset((page - 1) * BOOKING_PAGE_SIZE);
  return {
    query: { ...query, page },
    projectId,
    total,
    page,
    pageCount,
    pageSize: BOOKING_PAGE_SIZE,
    rows: await withMoney(db, rows, today),
  };
}

async function withMoney<T extends { id: string; totalSale: number; stage: (typeof bookings.$inferSelect)["stage"]; reservedUntil: string | null }>(
  db: Database,
  rows: T[],
  today: string,
) {
  const paid = await netPaidByBooking(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, ...money(r.totalSale, paid.get(r.id) ?? 0), holdOverdue: holdOverdue(r, today) }));
}

export async function getBookingDetail(db: Database, actor: Actor, bookingId: string, today: string) {
  if (!canDoBooking(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw notFound("Booking");
  const members = await teamMemberIds(db, actor);
  const [b] = await db
    .select({
      booking: bookings,
      lead: { id: leads.id, name: leads.name, code: leads.code, ownerId: leads.ownerId, phoneCountryCode: leads.phoneCountryCode, phoneNumber: leads.phoneNumber, stage: leads.stage },
      unit: { id: units.id, unitNo: units.unitNo, floor: units.floor, status: units.status, saleModel: units.saleModel },
      projectName: projects.name,
      agentName: agent.name,
      client: { id: clients.id, name: clients.name, ownerId: clients.ownerId },
    })
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(agent, eq(agent.id, bookings.agentId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(eq(bookings.id, bookingId));
  if (!b || !canAccessBooking(actor, b.booking.agentId, members)) throw notFound("Booking");

  const historyActor = alias(users, "history_actor");
  const history = await db
    .select({
      id: bookingStageHistory.id,
      fromStage: bookingStageHistory.fromStage,
      toStage: bookingStageHistory.toStage,
      note: bookingStageHistory.note,
      createdAt: bookingStageHistory.createdAt,
      actorName: historyActor.name,
    })
    .from(bookingStageHistory)
    .leftJoin(historyActor, eq(historyActor.id, bookingStageHistory.actorId))
    .where(eq(bookingStageHistory.bookingId, bookingId))
    .orderBy(desc(bookingStageHistory.createdAt));

  const next = nextStage(b.booking.stage);
  const open = !CLOSED_STAGES.includes(b.booking.stage);
  return {
    booking: b.booking,
    lead: { ...b.lead, phone: formatPhone(b.lead.phoneCountryCode, b.lead.phoneNumber), visible: canAccessLead(actor, b.lead.ownerId, members) },
    unit: b.unit,
    projectName: b.projectName,
    agentName: b.agentName,
    client: b.client?.id ? { id: b.client.id, name: b.client.name, visible: canAccessClient(actor, b.client.ownerId, members) } : null,
    money: money(b.booking.totalSale, await netPaid(db, b.booking.id)),
    holdOverdue: holdOverdue(b.booking, today),
    history,
    permissions: {
      nextStage: next,
      advance: Boolean(open && next && canMoveTo(actor, next)),
      cancel: open && canDoBooking(actor, "cancel"),
      editDetails: b.booking.stage !== "cancelled" && canDoBooking(actor, "editDetails"),
    },
  };
}
export type BookingDetail = Awaited<ReturnType<typeof getBookingDetail>>;

/** New-booking form choices: the actor's eligible leads in the project and its Available whole units. */
export async function bookingFormOptions(db: Database, actor: Actor, projectId: string) {
  if (!canDoBooking(actor, "create")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const [leadRows, unitRows] = await Promise.all([
    db
      .select({ id: leads.id, name: leads.name, code: leads.code, stage: leads.stage })
      .from(leads)
      .where(
        and(
          eq(leads.projectId, projectId),
          isNull(leads.deletedAt),
          notInArray(leads.stage, ["lost_lead", "booked"]),
          leadScopeFilter(actor, members),
        ),
      )
      .orderBy(asc(leads.name)),
    db
      .select({ id: units.id, unitNo: units.unitNo, floor: units.floor, areaSqft: units.areaSqft, basePrice: units.basePrice })
      .from(units)
      .where(and(eq(units.projectId, projectId), eq(units.status, "available"), eq(units.saleModel, "whole")))
      .orderBy(asc(sql`lower(${units.unitNo})`)),
  ]);
  return { leads: leadRows, units: unitRows };
}

/** Bookings shown on unit, lead and client pages, within the actor's booking scope. */
export async function bookingsFor(db: Database, actor: Actor, by: { unitId?: string; leadId?: string; clientId?: string }, today = businessToday()) {
  if (!canDoBooking(actor, "view")) return [];
  const members = await teamMemberIds(db, actor);
  const rows = await db
    .select(rowSelection)
    .from(bookings)
    .innerJoin(leads, eq(leads.id, bookings.leadId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .innerJoin(projects, eq(projects.id, bookings.projectId))
    .leftJoin(agent, eq(agent.id, bookings.agentId))
    .where(
      and(
        bookingScopeFilter(actor, members),
        by.unitId ? eq(bookings.unitId, by.unitId) : undefined,
        by.leadId ? eq(bookings.leadId, by.leadId) : undefined,
        by.clientId ? eq(bookings.clientId, by.clientId) : undefined,
      ),
    )
    .orderBy(desc(bookings.createdAt));
  return withMoney(db, rows, today);
}

