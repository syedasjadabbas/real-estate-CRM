import { test, type Page } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, seed, unique, selectTestProject } from "./support/seed";

/**
 * Dashboard filters and lead-count consistency: the Total leads KPI for a range equals the leads
 * list for the same days, a lost lead is counted by team, and the removed "Lost leads by reason" and
 * "Recent leads" widgets stay gone.
 */

async function kpi(page: Page, label: string) {
  const card = page.locator(`[data-kpi="${label}"]`);
  await expect(card).toBeVisible();
  return card;
}

/** Leads created in [from, to] (business days) according to the leads API. */
async function listTotal(page: Page, query: Record<string, string>) {
  const p = new URLSearchParams({ projectId: seed().projectId, ...query });
  const res = await api<{ total: number }>(page, `/api/v1/leads?${p}`);
  expect(res.status).toBe(200);
  return res.data.total;
}

/** The Total leads KPI as a number (small counts are shown in full). */
const totalOf = async (page: Page) => Number((await (await kpi(page, "Total leads")).locator("[data-kpi-value]").innerText()).replace(/,/g, ""));

test("range chips update the URL, and the custom range matches the leads list", async ({ page }) => {
  const { today } = seed();
  await selectTestProject(page.context());
  await login(page, "manager");
  await createLeadFor("agent1", unique("E2E Dashboard"));

  await page.goto("/dashboard");
  const ranges = page.getByRole("radiogroup", { name: "Date range" });
  await ranges.getByRole("radio", { name: "7d" }).click();
  await expect(page).toHaveURL(/[?&]range=7d/);
  await expect(ranges.getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "true");
  await ranges.getByRole("radio", { name: "MTD" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Custom: today only.
  await ranges.getByRole("radio", { name: "Custom" }).click();
  await page.getByLabel("From").fill(today);
  await page.getByLabel("To").fill(today);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`range=custom&from=${today}&to=${today}`));
  await expect(page.getByRole("status").filter({ hasText: "Updating…" })).toHaveCount(0);
  const shown = await totalOf(page);
  expect(shown).toBeGreaterThanOrEqual(1);
  expect(shown).toBe(await listTotal(page, { from: today, to: today }));

  // A new lead today raises both by exactly one.
  await createLeadFor("agent1", unique("E2E Dashboard Extra"));
  await page.reload();
  await expect.poll(() => totalOf(page)).toBe(shown + 1);
  expect(await listTotal(page, { from: today, to: today })).toBe(shown + 1);
});

test("a lost lead is counted by team and listed in the Lost list; the reason and recent-leads widgets are gone", async ({ page }) => {
  const { today, lostReasonId } = seed();
  const name = unique("E2E Lost Widget");
  const leadId = await createLeadFor("agent1", name);
  await selectTestProject(page.context());
  await login(page, "manager");
  // A manager marks the lead lost directly (no approval needed for their role).
  const lost = await api(page, `/api/v1/leads/${leadId}/lost-request`, { method: "POST", data: { lostReasonId, note: "E2E" } });
  expect(lost.status).toBe(200);

  await page.goto(`/dashboard?range=custom&from=${today}&to=${today}`);
  await expect(page.getByText("Lost leads by team")).toBeVisible();
  // Removed at the client's request: no lost-by-reason widget and no recent-leads table.
  await expect(page.getByText("Lost leads by reason")).toHaveCount(0);
  await expect(page.getByText("Recent leads")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Not interested/ })).toHaveCount(0);

  // The Lost list keeps its own lost-reason filter.
  expect(await listTotal(page, { view: "lost", from: today, to: today, lostReason: lostReasonId })).toBeGreaterThanOrEqual(1);
  await page.goto(`/dashboard/leads/lost?lostReason=${lostReasonId}&from=${today}&to=${today}`);
  await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
});

test("the menu's New leads link opens the leads added in the last 24 hours", async ({ page }) => {
  const name = unique("E2E New Lead Menu");
  await createLeadFor("agent1", name);
  await selectTestProject(page.context());
  await login(page, "manager");
  await page.goto("/dashboard");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New leads", exact: true }).click();
  await page.waitForURL(/\/dashboard\/leads\?view=new$/);
  await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();

  // The leads tab bar offers the same view.
  await expect(page.getByRole("navigation", { name: "Lead views" }).getByRole("link", { name: "New leads", exact: true })).toHaveAttribute(
    "href",
    "/dashboard/leads?view=new",
  );
});

test("roles without lead analytics see no lead counts", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/dashboard");
  // The layout stays, but every lead figure is the empty placeholder and no lead data is fetched.
  await expect(page.getByText("No lead analytics for your role").first()).toBeVisible();
  await expect((await kpi(page, "Total leads")).locator("[data-kpi-value]")).toHaveText("—");
  await expect(page.getByRole("link", { name: /Not interested/ })).toHaveCount(0);
});

test("an agent sees their own performance score, not team averages", async ({ page }) => {
  await selectTestProject(page.context());
  await login(page, "agent1");
  await page.goto("/dashboard");
  await expect(page.getByText("Your performance score")).toBeVisible();
  await expect(page.getByText("Team performance scores")).toHaveCount(0);
});
