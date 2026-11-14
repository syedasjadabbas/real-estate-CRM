import { test } from "@playwright/test";
import { api, E2E_PASSWORD, expect, login, seed, unique } from "./support/seed";

/** Account management on the HR Employees screens (questionnaire Q2, Q3). */

test("an admin creates a user who can sign in, then deactivates them and their session ends", async ({ browser }) => {
  const email = `${unique("e2e.user").replace(/\s+/g, ".").toLowerCase()}@test.local`;
  const password = `${E2E_PASSWORD}-new`;

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin");
  await admin.goto("/dashboard/hr/employees");
  await admin.getByRole("link", { name: "New CRM user" }).click();
  await admin.waitForURL("**/dashboard/hr/employees/new");
  const form = admin.getByRole("form", { name: "New CRM user" });
  await form.getByLabel("Name").fill("E2E Created Agent");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Role").selectOption("agent");
  await form.getByLabel("Initial password").fill(password);
  await form.getByRole("button", { name: "Create user" }).click();
  await admin.waitForURL(/\/dashboard\/hr\/employees\/[0-9a-f-]{36}$/);
  await expect(admin.getByRole("heading", { name: "E2E Created Agent" })).toBeVisible();

  // The new user signs in.
  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  await user.goto("/login");
  await user.getByLabel("Email").fill(email);
  await user.getByLabel("Password").fill(password);
  await user.getByRole("button", { name: "Sign in" }).click();
  await user.waitForURL(/\/dashboard(\?|$)/);

  // Admin deactivates them; their next request is signed out.
  await admin.getByRole("button", { name: "Deactivate account" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Account deactivated." })).toBeVisible();
  expect((await api(user, "/api/v1/notifications")).status).toBe(401);
  await user.goto("/login");
  await user.getByLabel("Email").fill(email);
  await user.getByLabel("Password").fill(password);
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user.getByText("Your access has been turned off. Please contact your administrator.")).toBeVisible();

  await admin.getByRole("button", { name: "Reactivate account" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Account reactivated." })).toBeVisible();
  await userCtx.close();
  await adminCtx.close();
});

test("an admin cannot manage a Super Admin account", async ({ page }) => {
  await login(page, "admin");
  await page.goto(`/dashboard/hr/employees/${seed().users.superAdmin.id}`);
  await expect(page.getByText("Only a Super Admin can manage Super Admin accounts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate account" })).toHaveCount(0);
  expect((await api(page, `/api/v1/users/${seed().users.superAdmin.id}/status`, { method: "POST", data: { status: "inactive" } })).status).toBe(403);
});

test("other roles have no account management @mobile", async ({ browser }) => {
  for (const role of ["hr", "manager", "agent1", "accountant"] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    await page.goto("/dashboard/hr/employees/new");
    await expect(page.getByText("Access denied").first(), role).toBeVisible();
    expect((await api(page, "/api/v1/users", { method: "POST", data: { name: "X", email: "x@test.local", role: "agent", password: "0123456789" } })).status, role).toBe(403);
    await ctx.close();
  }
});
