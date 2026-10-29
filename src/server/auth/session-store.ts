import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { sessions, signinLogs, teams, users } from "@/server/db/schema";
import type { Actor, Role } from "./types";

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(db: Database, userId: string, meta: RequestMeta = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  await db.insert(signinLogs).values({ userId, event: "sign_in", ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
  return { token, expiresAt };
}

/**
 * Resolves a token to an active user, enforcing absolute and idle expiry.
 * Expiry is checked against the database clock (`now()`), so session reads never depend on the server clock.
 */
export async function findActorByToken(db: Database, token: string): Promise<Actor | null> {
  const idle = sql`now() - make_interval(secs => ${SESSION_IDLE_MS / 1000})`;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, sql`now()`),
        gt(sessions.lastSeenAt, idle),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Sliding idle window, written at most once per touch interval.
  await db
    .update(sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, row.sessionId),
        lt(sessions.lastSeenAt, sql`now() - make_interval(secs => ${TOUCH_INTERVAL_MS / 1000})`),
      ),
    );
  return loadActor(db, { id: row.id, name: row.name, email: row.email, role: row.role });
}

export async function loadActor(
  db: Database,
  user: { id: string; name: string; email: string; role: Role },
): Promise<Actor> {
  const managed =
    user.role === "manager"
      ? await db.select({ id: teams.id }).from(teams).where(eq(teams.managerId, user.id))
      : [];
  return { ...user, managedTeamIds: managed.map((t) => t.id) };
}

export async function revokeSession(db: Database, token: string, meta: RequestMeta = {}) {
  const [row] = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .returning({ userId: sessions.userId });
  if (row) {
    await db
      .insert(signinLogs)
      .values({ userId: row.userId, event: "sign_out", ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });
  }
}

/** Revokes every session of a user (deactivation, password change). */
export async function revokeAllSessions(db: Database, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneExpiredSessions(db: Database) {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}
