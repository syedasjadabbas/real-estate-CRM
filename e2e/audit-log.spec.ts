import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique } from "./support/seed";

/** F-4: lead notes are audited, and Settings → Audit log is a read-only viewer for Super Admins and Admins. */

test("a note added on a lead appears in the Admin's audit log; search, filters and sorting work @mobile", async ({ browser }) => {
  const note = unique("Audit note");
  const leadId = await createLeadFor("agent1", unique("Audit Lead"));

  // The agent adds a note through the lead page.
  const agentCtx = await browser.newContext();
  await selectTestProject(agentCtx);
  const ag = await agentCtx.newPage();
  await login(ag, "agent1");
  await ag.goto(`/dashboard/leads/${leadId}`);
  const box = ag.getByLabel("New note");
  const add = ag.getByRole("button", { name: "Add note" });
  // Refill if the page hydrated after typing (the button enables only once React has the text).
  await expect(async () => {
    await box.fill(note);
    await expect(add).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await add.click();
  await expect(ag.getByText("Note added.")).toBeVisible();
  await agentCtx.close();

  // The Admin reaches the log from Security settings.
  const adminCtx = await browser.newContext();
  const adm = await adminCtx.newPage();
  await login(adm, "admin");
  await adm.goto("/dashboard/settings/security");
  await adm.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Audit log" }).click();
  await adm.waitForURL("**/dashboard/settings/audit-log");

  const filters = adm.getByRole("form", { name: "Filter audit log" });
  await filters.getByLabel("Search", { exact: true }).fill(note);
  await filters.getByRole("button", { name: "Apply" }).click();
  await adm.waitForURL(/[?&]q=/);
  const table = adm.getByRole("table", { name: "Audit log entries" });
  const row = table.getByRole("row").filter({ hasText: "lead.note" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(seed().users.agent1.name);
  await expect(row.getByRole("link", { name: leadId })).toHaveAttribute("href", `/dashboard/leads/${leadId}`);
  await row.getByText("View changes").click();
  await expect(row.getByText(note)).toBeVisible();
  // No trusted proxy in this test server: no IP is recorded, and none is invented.
  await expect(row.getByRole("cell").last()).toHaveText("—");

  // Filters by user and action (search cleared), kept when sorting.
  await adm.getByRole("link", { name: "Clear all" }).click();
  await adm.waitForURL((u) => !u.search.includes("q="));
  await filters.getByLabel("User", { exact: true }).selectOption({ label: seed().users.agent1.name });
  await filters.getByLabel("Action", { exact: true }).selectOption("lead.note");
  await filters.getByRole("button", { name: "Apply" }).click();
  await adm.waitForURL(/action=lead\.note/);
  await expect(table.getByRole("row").filter({ hasText: note.slice(0, 10) }).first()).toBeVisible();
  const actions = await table.locator("tbody tr td:nth-child(3)").allTextContents();
  expect(new Set(actions)).toEqual(new Set(["lead.note"]));

  await adm.getByRole("link", { name: "Sort by Time" }).click();
  await adm.waitForURL(/sort=time&dir=asc/);
  await expect(adm).toHaveURL(/action=lead\.note/);
  await expect(table.getByRole("columnheader", { name: /Time/ })).toHaveAttribute("aria-sort", "ascending");

  // A phone-width page doesn't scroll sideways: the table scrolls inside its card.
  const overflow = await adm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await adminCtx.close();
});

test("managers, agents, HR and accountants can't open the audit log, in the page or the API", async ({ browser }) => {
  for (const role of ["manager", "agent1", "hr", "accountant"] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    await page.goto("/dashboard/settings/audit-log");
    await expect(page.getByText("Access denied").first()).toBeVisible();
    await expect(page.getByRole("table", { name: "Audit log entries" })).toHaveCount(0);
    expect((await api(page, "/api/v1/audit-logs")).status).toBe(403);
    await ctx.close();
  }
});

test("the Super Admin sees the log; the API is read-only", async ({ page }) => {
  await login(page, "superAdmin");
  const res = await api<{ total: number }>(page, "/api/v1/audit-logs?entity=lead");
  expect(res.status).toBe(200);
  expect(res.data.total).toBeGreaterThan(0);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect((await api(page, "/api/v1/audit-logs", { method })).status).toBe(405);
  await page.goto("/dashboard/settings/audit-log");
  await expect(page.getByRole("table", { name: "Audit log entries" })).toBeVisible();
});
