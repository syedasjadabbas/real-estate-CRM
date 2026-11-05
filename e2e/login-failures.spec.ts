import { test } from "@playwright/test";
import { inactiveUserWithPassword } from "./support/data";
import { E2E_PASSWORD, expect, login, unique } from "./support/seed";

/** F-10: the real sign-in form and API give an inactive account away by nothing. */

const MESSAGE = "Incorrect email or password.";
const email = (label: string) => `${unique(label).replace(/\s/g, "-").toLowerCase()}@test.local`;

test("the form says the same for an inactive account as for a wrong password @mobile", async ({ page }) => {
  const inactive = await inactiveUserWithPassword(email("inactive"));
  await page.goto("/login");
  for (const [address, password] of [[inactive, E2E_PASSWORD], [inactive, "not-the-password"], [email("nobody"), E2E_PASSWORD]]) {
    await page.getByLabel("Email").fill(address);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: MESSAGE })).toBeVisible();
    await expect(page.getByText("inactive", { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  }
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
  expect(await attempt(inactive, E2E_PASSWORD)).toEqual(unknown);
  expect(await attempt(inactive, "not-the-password")).toEqual(unknown);

  await login(page, "agent1");
  await expect(page).toHaveURL(/\/dashboard/);
});
