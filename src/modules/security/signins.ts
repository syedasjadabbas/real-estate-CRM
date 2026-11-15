import { and, count, desc, eq, gte, ilike, lt, or } from "drizzle-orm";
import { z } from "zod";
import { addDays } from "@/modules/bookings/today";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { signinLogs, users } from "@/server/db/schema";
import { assertCanManageSecurity } from "./policy";

/**
 * Sign-in history viewer (owner review, 16 Nov 2026): who signed in or out of the CRM, when, from
 * which address and browser. Admins and Super Admins only. Newest first, 50 per page. It is
 * authentication activity only, not attendance.
 */
export const SIGNIN_PAGE_SIZE = 50;

const query = z.object({
  sq: z.string().trim().max(100).optional().catch(undefined),
  sevent: z.enum(["sign_in", "sign_out"]).optional().catch(undefined),
  sfrom: z.iso.date().optional().catch(undefined),
  sto: z.iso.date().optional().catch(undefined),
  spage: z.coerce.number().int().min(1).max(100_000).catch(1),
});
export type SigninQuery = z.infer<typeof query>;

/** A short browser and device name from the user agent ("Chrome on Windows"), for reading only. */
export function describeAgent(agent: string | null) {
  if (!agent) return "—";
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const device = /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iPhone / iPad" : /Windows/.test(agent) ? "Windows" : /Mac OS X/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "";
  return device ? `${browser} on ${device}` : browser;
}

export async function listSignins(db: Database, actor: Actor, rawQuery: unknown = {}) {
  assertCanManageSecurity(actor);
  const q = query.parse(rawQuery ?? {});
  const term = q.sq ? `%${q.sq.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    q.sevent ? eq(signinLogs.event, q.sevent) : undefined,
    q.sfrom ? gte(signinLogs.at, new Date(`${q.sfrom}T00:00:00+05:00`)) : undefined,
    q.sto ? lt(signinLogs.at, new Date(`${addDays(q.sto, 1)}T00:00:00+05:00`)) : undefined,
    term ? or(ilike(users.name, term), ilike(users.email, term), ilike(signinLogs.ip, term)) : undefined,
  );
  const [{ total }] = await db.select({ total: count() }).from(signinLogs).innerJoin(users, eq(users.id, signinLogs.userId)).where(where);
  const pageCount = Math.max(1, Math.ceil(total / SIGNIN_PAGE_SIZE));
  const page = Math.min(q.spage, pageCount);
  const rows = await db
    .select({ id: signinLogs.id, at: signinLogs.at, event: signinLogs.event, ip: signinLogs.ip, agent: signinLogs.userAgent, userId: users.id, name: users.name, role: users.role, email: users.email })
    .from(signinLogs)
    .innerJoin(users, eq(users.id, signinLogs.userId))
    .where(where)
    .orderBy(desc(signinLogs.at), desc(signinLogs.id))
    .limit(SIGNIN_PAGE_SIZE)
    .offset((page - 1) * SIGNIN_PAGE_SIZE);
  return { query: { ...q, spage: page }, total, page, pageCount, rows: rows.map((r) => ({ ...r, device: describeAgent(r.agent) })) };
}
