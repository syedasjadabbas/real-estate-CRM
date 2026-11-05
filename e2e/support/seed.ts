import { expect, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./guard";

/** Synthetic fixture password from tests/support/db.ts (test value; never a real account). */
export const E2E_PASSWORD = "correct-horse-battery";

export type SeedUser = { id: string; email: string; name: string };
export type Role = "superAdmin" | "admin" | "manager" | "agent1" | "agent2" | "hr" | "accountant";
export type Seed = {
  projectId: string;
  otherProjectId: string;
  lostReasonId: string;
  sourceId: string;
  today: string;
  users: Record<Role, SeedUser>;
};

export function seed(): Seed {
  const raw = process.env.E2E_SEED;
  if (!raw) throw new Error("[e2e] seed missing: global setup did not run");
  return JSON.parse(raw) as Seed;
}

/** Signs in through the real login form and waits for the dashboard. */
export async function login(page: Page, role: Role) {
  const user = seed().users[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard(\?|$)/);
  return user;
}

/** Makes the seeded Test Project the active project for every seeded user (the header selector stores it per user). */
export async function selectTestProject(context: BrowserContext) {
  const { hostname } = new URL(E2E_BASE_URL);
  await context.addCookies(Object.values(seed().users).map((u) => ({ name: `mz_project_${u.id}`, value: seed().projectId, domain: hostname, path: "/" })));
}

/** A unique, recognisable name so tests never depend on each other's records. */
export const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A Pakistani mobile number that no other test uses. */
let phoneSeq = 0;
export const uniquePhone = () => `03${String(Date.now() % 1e8).padStart(8, "0").slice(0, 7)}${(phoneSeq++ % 10).toString()}`;

/** Server JSON helper for API checks made with the page's session. */
export async function api<T = unknown>(page: Page, url: string, init?: Parameters<Page["request"]["fetch"]>[1]) {
  const res = await page.request.fetch(url, init);
  const body = res.headers()["content-type"]?.includes("json") ? ((await res.json()) as { data?: T; error?: { code: string } }) : null;
  return { status: res.status(), data: body?.data as T, error: body?.error, res };
}

export { expect };
