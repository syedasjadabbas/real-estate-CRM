import { readFile } from "node:fs/promises";
import { test } from "@playwright/test";
import { auditCount } from "./support/data";
import { api, expect, login, seed } from "./support/seed";

/**
 * Finance reports (FR-205) and the audited CSV export. Global setup recorded one 500,000 cash
 * payment today against a 12,500,000 booking in the Test Project.
 */

type Collections = { totals: { receipts: number; net: number | string }; rows: { project: string; net: number | string }[] };

test("the accountant sees today's collections and exports them as CSV", async ({ page }) => {
  const { today } = seed();
  await login(page, "accountant");
  await page.goto(`/dashboard/finance/reports?from=${today}&to=${today}`);
  await expect(page.getByText("1 receipts")).toBeVisible();
  await expect(page.getByRole("table").first().getByRole("cell", { name: "Test Project" })).toBeVisible();

  // Page, API and CSV agree.
  const report = await api<{ collections: Collections }>(page, `/api/v1/finance/reports?from=${today}&to=${today}`);
  expect(report.status).toBe(200);
  expect(Number(report.data.collections.totals.net)).toBe(500_000);
  expect(report.data.collections.totals.receipts).toBe(1);

  const exportsBefore = await auditCount("finance.report_export", "collections");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(`a[href="/api/v1/finance/reports/export?report=collections&from=${today}&to=${today}"]`).click()]);
  expect(download.suggestedFilename()).toBe(`collections-${today}-to-${today}.csv`);
  const lines = (await readFile(await download.path(), "utf8")).trim().split("\n");
  expect(lines[0]).toBe("Project,From,To,Receipts,Received (PKR),Reversals,Reversed (PKR),Net collected (PKR)");
  const total = lines.at(-1)!.split(",");
  expect(total[0]).toBe("Total");
  expect(Number(total[3])).toBe(1);
  expect(Number(total[7])).toBe(500_000);
  await expect.poll(() => auditCount("finance.report_export", "collections")).toBe(exportsBefore + 1);
});

test("outstanding reports list the booking balance", async ({ page }) => {
  await login(page, "accountant");
  const res = await api<{ outstandingByProject: { totals: { outstanding: number | string; bookings: number } } }>(page, "/api/v1/finance/reports");
  expect(res.status).toBe(200);
  expect(res.data.outstandingByProject.totals.bookings).toBeGreaterThanOrEqual(1);
  expect(Number(res.data.outstandingByProject.totals.outstanding)).toBeGreaterThanOrEqual(12_000_000);
  await page.goto("/dashboard/finance/reports");
  await expect(page.getByRole("heading", { name: "Outstanding by project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outstanding by sales agent" })).toBeVisible();
});

test("roles without finance access are refused the reports and the export", async ({ browser }) => {
  for (const role of ["manager", "agent1", "hr"] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    await page.goto("/dashboard/finance/reports");
    await expect(page.getByText("Access denied").first(), role).toBeVisible();
    const before = await auditCount("finance.report_export");
    expect((await page.request.get("/api/v1/finance/reports/export?report=collections")).status(), role).toBe(403);
    expect(await auditCount("finance.report_export")).toBe(before);
    await ctx.close();
  }
});
