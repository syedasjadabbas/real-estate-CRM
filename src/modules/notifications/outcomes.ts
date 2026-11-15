import { inArray } from "drizzle-orm";
import type { DbOrTx } from "@/modules/leads/support";
import { approvals, bookings, leadImportBatches, leads, users } from "@/server/db/schema";

/**
 * "Already handled" on request notifications (owner, 15 Nov 2026). A notification asking someone to
 * act (verify a lead, approve a discount, decide a lost request, approve an import) keeps its text, so
 * the list also shows whether the request has since been decided, and by whom. Read from the request
 * itself each time, so it is always current; nothing extra is stored.
 */
export type RequestOutcome = { decision: "approved" | "rejected"; text: string };

type Row = { id: string; type: string; link: string | null; dedupeKey: string };

const idAfter = (value: string | null, prefix: string) => (value?.startsWith(prefix) ? value.slice(prefix.length).split(/[/?#]/)[0] : null);
const UUID = /^[0-9a-f-]{36}$/i;

export async function requestOutcomes(db: DbOrTx, rows: Row[]) {
  const want = (type: string, pick: (r: Row) => string | null) => [...new Set(rows.filter((r) => r.type === type).map(pick).filter((x): x is string => Boolean(x && UUID.test(x))))];
  const leadIds = want("lead_verification_requested", (r) => idAfter(r.link, "/dashboard/leads/"));
  const bookingIds = want("discount_requested", (r) => idAfter(r.link, "/dashboard/bookings/"));
  const approvalIds = want("lost_requested", (r) => idAfter(r.dedupeKey, "lost_requested:"));
  const batchIds = want("import_requested", (r) => idAfter(r.dedupeKey, "import_requested:"));

  const [leadRows, bookingRows, approvalRows, batchRows] = await Promise.all([
    leadIds.length ? db.select({ id: leads.id, status: leads.verification, by: leads.verifiedById }).from(leads).where(inArray(leads.id, leadIds)) : [],
    bookingIds.length ? db.select({ id: bookings.id, status: bookings.discountStatus, by: bookings.discountDecidedById }).from(bookings).where(inArray(bookings.id, bookingIds)) : [],
    approvalIds.length ? db.select({ id: approvals.id, status: approvals.status, by: approvals.decidedById }).from(approvals).where(inArray(approvals.id, approvalIds)) : [],
    batchIds.length ? db.select({ id: leadImportBatches.id, status: leadImportBatches.status, by: leadImportBatches.decidedById }).from(leadImportBatches).where(inArray(leadImportBatches.id, batchIds)) : [],
  ]);
  const deciders = [...new Set([...leadRows, ...bookingRows, ...approvalRows, ...batchRows].map((r) => r.by).filter((x): x is string => Boolean(x)))];
  const names = new Map((deciders.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, deciders)) : []).map((u) => [u.id, u.name]));

  const outcome = (status: string | undefined, by: string | null | undefined, what: { approved: string; rejected: string }): RequestOutcome | null => {
    if (status !== "approved" && status !== "rejected") return null;
    const who = by ? names.get(by) : null;
    return { decision: status, text: `${what[status]}${who ? ` by ${who}` : ""}` };
  };

  const out = new Map<string, RequestOutcome>();
  for (const r of rows) {
    let o: RequestOutcome | null = null;
    if (r.type === "lead_verification_requested") {
      const x = leadRows.find((l) => l.id === idAfter(r.link, "/dashboard/leads/"));
      o = outcome(x?.status, x?.by, { approved: "Already approved", rejected: "Already rejected" });
    } else if (r.type === "discount_requested") {
      const x = bookingRows.find((b) => b.id === idAfter(r.link, "/dashboard/bookings/"));
      o = outcome(x?.status, x?.by, { approved: "Discount approved", rejected: "Discount rejected" });
    } else if (r.type === "lost_requested") {
      const x = approvalRows.find((a) => a.id === idAfter(r.dedupeKey, "lost_requested:"));
      o = outcome(x?.status, x?.by, { approved: "Lost request approved", rejected: "Lost request rejected" });
    } else if (r.type === "import_requested") {
      const x = batchRows.find((b) => b.id === idAfter(r.dedupeKey, "import_requested:"));
      o = outcome(x?.status, x?.by, { approved: "Import approved", rejected: "Import rejected" });
    }
    if (o) out.set(r.id, o);
  }
  return out;
}
