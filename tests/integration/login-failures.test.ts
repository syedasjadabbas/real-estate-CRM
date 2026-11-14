import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate } from "@/server/auth/login";
import { hashPassword } from "@/server/auth/password";
import { findActorByToken } from "@/server/auth/session-store";
import { sessions, signinLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb } from "../support/db";

const PASSWORD = "correct-horse-battery";
const WRONG = "not-the-password";

/** What a caller can observe about a failure. */
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return { code: e.code, message: e.message, status: e.status, fields: e.fields, details: e.details };
  }
};

describe.skipIf(!hasTestDb)("F-10: sign-in failures reveal nothing about the account (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let passwordHash: string;
  let counter = 0;

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    passwordHash = await hashPassword(PASSWORD);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
  });

  /** The limiter keeps state in memory, so every account gets its own email. */
  const account = async (status: "active" | "inactive") => {
    counter += 1;
    const email = `login${counter}@test.local`;
    const [u] = await db.insert(users).values({ name: "Sign In", email, role: "agent", status, passwordHash }).returning();
    return { id: u.id, email };
  };
  const signIn = (email: string, password: string, ip = "198.51.100.1") => authenticate(db, { email, password }, { ip });

  it("an active account signs in and gets a working session", async () => {
    const { id, email } = await account("active");
    const { token, userId } = await signIn(email, PASSWORD);
    expect(userId).toBe(id);
    expect((await findActorByToken(db, token))?.id).toBe(id);
    expect(await db.select().from(signinLogs).where(eq(signinLogs.userId, id))).toEqual([expect.objectContaining({ event: "sign_in", ip: "198.51.100.1" })]);
  });

  it("a wrong password fails identically for every account; the right one is told access is off", async () => {
    const active = await account("active");
    const inactive = await account("inactive");
    const expected = { code: "UNAUTHENTICATED", message: "Incorrect email or password.", status: 401, fields: undefined, details: undefined };
    expect(await failure(signIn(active.email, WRONG))).toEqual(expected);
    expect(await failure(signIn("nobody@test.local", WRONG))).toEqual(expected);
    expect(await failure(signIn(inactive.email, WRONG))).toEqual(expected);
    // Owner, 14 Nov 2026: only someone with the right password learns the account is switched off.
    expect(await failure(signIn(inactive.email, PASSWORD))).toEqual({ ...expected, message: "Your access has been turned off. Please contact your administrator." });
  });

  it("a failed sign-in opens no session and logs no sign-in", async () => {
    const inactive = await account("inactive");
    const active = await account("active");
    await failure(signIn(inactive.email, PASSWORD));
    await failure(signIn(active.email, WRONG));
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await db.select().from(signinLogs)).toEqual([]);
  });

  it("rate limiting is the same for all three: five failures, then the same refusal", async () => {
    const cases = [(await account("active")).email, (await account("inactive")).email, `unknown${counter}@test.local`];
    for (const email of cases) {
      for (let i = 0; i < 5; i += 1) expect((await failure(signIn(email, WRONG)))?.code, email).toBe("UNAUTHENTICATED");
      expect(await failure(signIn(email, WRONG))).toMatchObject({ code: "RATE_LIMITED", message: "Too many failed attempts. Try again in 15 minutes." });
    }
  });

  it("the right password on a switched-off account is not locked out: it keeps saying access is off", async () => {
    const { email } = await account("inactive");
    for (let i = 0; i < 5; i += 1) await failure(signIn(email, PASSWORD));
    expect((await failure(signIn(email, PASSWORD)))?.message).toContain("Your access has been turned off");
  });

  it("a blocked email + address doesn't block the same email elsewhere, and success clears failures", async () => {
    const { email } = await account("active");
    for (let i = 0; i < 5; i += 1) await failure(signIn(email, WRONG));
    expect((await failure(signIn(email, PASSWORD)))?.code).toBe("RATE_LIMITED");
    expect(await failure(signIn(email, PASSWORD, "198.51.100.2"))).toBeNull();

    const other = await account("active");
    for (let i = 0; i < 4; i += 1) await failure(signIn(other.email, WRONG));
    await signIn(other.email, PASSWORD);
    for (let i = 0; i < 4; i += 1) expect((await failure(signIn(other.email, WRONG)))?.code).toBe("UNAUTHENTICATED");
  });

  it("deactivating and reactivating still work, and field validation is unchanged", async () => {
    const { id, email } = await account("active");
    await db.update(users).set({ status: "inactive" }).where(eq(users.id, id));
    // With the right password, a switched-off account is told so (14 Nov 2026); a wrong one still isn't.
    expect((await failure(signIn(email, PASSWORD)))?.message).toBe("Your access has been turned off. Please contact your administrator.");
    expect((await failure(signIn(email, WRONG)))?.message).toBe("Incorrect email or password.");
    await db.update(users).set({ status: "active" }).where(eq(users.id, id));
    // A good sign-in from the same address still works.
    expect(await failure(signIn(email, PASSWORD))).toBeNull();
    expect(await failure(authenticate(db, { email: "not-an-email", password: "" }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
