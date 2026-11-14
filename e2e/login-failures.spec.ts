import { test } from "@playwright/test";
import { inactiveUserWithPassword } from "./support/data";
import { E2E_PASSWORD, expect, login, seed, unique } from "./support/seed";

/** F-10: the real sign-in form and API give an inactive account away by nothing. */

const MESSAGE = "Incorrect email or password.";
const email = (label: string) => `${unique(label).replace(/\s/g, "-").toLowerCase()}@test.local`;

test("a wrong password says the same for every account; only the right one learns access is off @mobile", async ({ page }) => {
  const inactive = await inactiveUserWithPassword(email("inactive"));
  await page.goto("/login");
  await page.getByLabel("Email").fill(inactive);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your access has been turned off" })).toBeVisible();
  for (const [address, password] of [[inactive, "not-the-password"], [email("nobody"), E2E_PASSWORD]]) {
    await page.getByLabel("Email").fill(address);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: MESSAGE })).toBeVisible();
    await expect(page.getByText("inactive", { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("API sign-in accepts its own origin and refuses another", async ({ request, baseURL }) => {
  const data = { email: seed().users.agent1.email, password: E2E_PASSWORD };
  const own = await request.post("/api/v1/auth/login", { data, headers: { origin: baseURL! } });
  expect(own.status()).toBe(200);
  const other = await request.post("/api/v1/auth/login", { data, headers: { origin: "https://evil.example" } });
  expect(other.status()).toBe(403);
});

test("the API answers all failures with the same status and body, and active accounts still sign in", async ({ page, request }) => {
  const inactive = await inactiveUserWithPassword(email("api"));
  const attempt = async (address: string, password: string) => {
    const res = await request.post("/api/v1/auth/login", { data: { email: address, password } });
    return { status: res.status(), body: await res.json(), cookie: res.headers()["set-cookie"] ?? null };
  };
  const unknown = await attempt(email("nobody"), E2E_PASSWORD);
  expect(unknown.status).toBe(401);
  expect(unknown.cookie).toBeNull();
  // Only the right password learns the account is switched off (14 Nov 2026).
  const off = await attempt(inactive, E2E_PASSWORD);
  expect(off.status).toBe(401);
  expect(off.cookie).toBeNull();
  expect(JSON.stringify(off.body)).toContain("Your access has been turned off");
  expect(await attempt(inactive, "not-the-password")).toEqual(unknown);

  await login(page, "agent1");
  await expect(page).toHaveURL(/\/dashboard/);
});
