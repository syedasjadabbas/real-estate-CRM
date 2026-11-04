import { test, type Page } from "@playwright/test";
import { auditCount } from "./support/data";
import { expect, login, seed } from "./support/seed";

/** FR-075 unit import from CSV, and FR-203 overdue on the Outstanding screen. */

const csvFile = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

/** Chooses the file and waits until the panel accepted it (Check turns enabled); retried for a panel not yet hydrated. */
async function chooseCsv(page: Page, file: ReturnType<typeof csvFile>) {
  const check = page.getByRole("button", { name: "Check file", exact: true });
  await expect(async () => {
    await page.getByLabel("CSV file").setInputFiles(file);
    await expect(check).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  return check;
}

test("a super admin checks a CSV, sees row errors, fixes them and imports the units", async ({ page }) => {
  const { projectId } = seed();
  const tag = Date.now().toString(36).toUpperCase();
  await login(page, "superAdmin");
  await page.goto("/dashboard/inventory");
  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.waitForURL("**/dashboard/inventory/import");
  await page.getByRole("region", { name: "Import units" }).getByLabel("Project").selectOption(projectId);

  // A file with a missing area is reported by line and imports nothing.
  await (await chooseCsv(page, csvFile("bad.csv", `unit_no,area_sqft,base_price\nIMP-${tag}-1,500,10000000\nIMP-${tag}-2,,10000000\n`))).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 row need fixing. Nothing was imported." })).toBeVisible();
  const report = page.getByRole("table", { name: "Validation report" });
  await expect(report.getByRole("row").filter({ hasText: `IMP-${tag}-2` })).toContainText("areaSqft");
  await expect(page.getByRole("button", { name: "Import units" })).toBeDisabled();

  // The fixed file checks clean, then imports.
  const before = await auditCount("unit.import");
  await (await chooseCsv(page, csvFile("good.csv", `unit_no,area_sqft,base_price\nIMP-${tag}-1,500,10000000\nIMP-${tag}-2,650,13000000\n`))).click();
  await expect(page.getByRole("status").filter({ hasText: "All 2 rows are valid." })).toBeVisible();
  await page.getByRole("button", { name: "Import units" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 units imported." })).toBeVisible();
  await expect.poll(() => auditCount("unit.import")).toBe(before + 1);

  await page.goto(`/dashboard/inventory?project=${projectId}&q=IMP-${tag}`);
  await expect(page.getByText(`IMP-${tag}-2`).first()).toBeVisible();
});

test("roles without inventory management can't open the import", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/dashboard/inventory/import");
  await expect(page.getByText("Access denied").first()).toBeVisible();
});

test("the Outstanding screen shows the plan schedule and overdue columns", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/dashboard/finance/outstanding");
  for (const name of ["Due to date (plan)", "Overdue"]) await expect(page.getByRole("columnheader", { name: `Sort by ${name}`, exact: true })).toBeVisible();
  await expect(page.getByText("Past due on payment plans")).toBeVisible();
  // The seeded booking has no payment plan: no schedule is shown, never a guessed figure.
  await expect(page.getByRole("cell", { name: "No plan" }).first()).toBeVisible();
});
