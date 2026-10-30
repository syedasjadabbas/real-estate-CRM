import { test } from "@playwright/test";
import { api, expect, login, seed, selectTestProject, type Role } from "./support/seed";

/** Authentication and role-based access (server-enforced: pages show Access denied, APIs return 401 / 403). */

test("signed-out visitors are sent to the login page and APIs refuse them", async ({ page }) => {
  await page.goto("/dashboard/leads");
  await expect(page).toHaveURL(/\/login/);
  for (const url of ["/api/v1/leads", "/api/v1/notifications", "/api/v1/finance/reports", "/api/v1/recordings/00000000-0000-4000-8000-000000000000"]) {
    expect((await api(page, url)).status, url).toBe(401);
  }
});

test("a wrong password is rejected with the generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(seed().users.agent1.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

const ROLE_BADGE: Record<Role, string> = {
  superAdmin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  agent1: "Sales Agent",
  agent2: "Sales Agent",
  hr: "HR",
  accountant: "Accountant",
};

/** Pages each role must NOT open (documented permissions); every other checked page must open. */
const DENIED: Partial<Record<Role, string[]>> = {
  superAdmin: [],
  admin: ["/dashboard/finance/record"],
  manager: ["/dashboard/finance/reports", "/dashboard/settings/security"],
  agent1: ["/dashboard/finance", "/dashboard/finance/reports", "/dashboard/hr/employees", "/dashboard/settings/security"],
  hr: ["/dashboard/leads", "/dashboard/finance/reports", "/dashboard/performance", "/dashboard/settings/security"],
  accountant: ["/dashboard/leads", "/dashboard/leads/pipeline", "/dashboard/hr/employees", "/dashboard/settings/security"],
};
const ALLOWED: Partial<Record<Role, string[]>> = {
  superAdmin: ["/dashboard/leads", "/dashboard/finance/reports", "/dashboard/hr/employees", "/dashboard/settings/security", "/dashboard/notifications"],
  admin: ["/dashboard/leads", "/dashboard/finance/reports", "/dashboard/settings/security", "/dashboard/notifications"],
  manager: ["/dashboard/leads", "/dashboard/leads/pipeline", "/dashboard/hr/employees", "/dashboard/notifications"],
  agent1: ["/dashboard/leads", "/dashboard/leads/pipeline", "/dashboard/workspace", "/dashboard/notifications"],
  hr: ["/dashboard/hr/employees", "/dashboard/hr/holidays", "/dashboard/workspace", "/dashboard/notifications"],
  accountant: ["/dashboard/finance", "/dashboard/finance/reports", "/dashboard/bookings", "/dashboard/notifications"],
};

for (const role of Object.keys(DENIED) as Role[]) {
  test(`${role}: signs in, sees their role, and only reaches permitted pages`, async ({ page, context }) => {
    await selectTestProject(context);
    await login(page, role);
    await expect(page.getByText(ROLE_BADGE[role], { exact: true }).first()).toBeVisible();
    for (const url of DENIED[role]!) {
      await page.goto(url);
      await expect(page.getByText("Access denied").first(), url).toBeVisible();
    }
    for (const url of ALLOWED[role]!) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(200);
      await expect(page.getByText("Access denied"), url).toHaveCount(0);
    }
  });
}

test("APIs enforce the same rules for unauthorised roles", async ({ browser }) => {
  const s = seed();
  const check = async (role: Role, expectations: [string, number][]) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, role);
    for (const [url, status] of expectations) expect((await api(page, url)).status, `${role} ${url}`).toBe(status);
    await context.close();
  };
  await check("agent1", [["/api/v1/finance/reports", 403], ["/api/v1/finance/reports/export?report=collections", 403], [`/api/v1/leads?projectId=${s.projectId}`, 200]]);
  await check("hr", [[`/api/v1/leads?projectId=${s.projectId}`, 403], ["/api/v1/finance/reports", 403]]);
  await check("accountant", [[`/api/v1/leads?projectId=${s.projectId}`, 403], ["/api/v1/finance/reports", 200]]);
  await check("manager", [["/api/v1/finance/reports", 403]]);
});

test("sign out ends the session", async ({ page }) => {
  await login(page, "agent1");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await api(page, "/api/v1/notifications")).status).toBe(401);
});
