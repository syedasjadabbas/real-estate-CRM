import { test, type Page } from "@playwright/test";
import { createAvailableUnit, seedEntriesFor } from "./support/data";
import { expect, login, unique } from "./support/seed";

/** F-16 (FR-005): column sorting on Inventory, Payments, Finance entries and Outstanding, through the real pages. */

/** Numbers shown in one column of the page's first table (1-based), reversals' minus sign included. */
async function numbers(page: Page, column: number) {
  const cells = await page.locator(`table tbody tr td:nth-child(${column})`).allTextContents();
  return cells.map((t) => Number(t.replace(/[−-]/, "-").replace(/[^\d.-]/g, "")));
}
const isSorted = (values: number[], dir: "asc" | "desc") => values.every((v, i) => i === 0 || (dir === "asc" ? values[i - 1] <= v : values[i - 1] >= v));

/** Clicks a header twice: highest first, then lowest first, checking the URL, the header state and the column. */
async function checkSort(page: Page, label: string, sort: string, column: number) {
  const header = page.getByRole("columnheader", { name: `Sort by ${label}`, exact: true });
  await page.getByRole("link", { name: `Sort by ${label}`, exact: true }).click();
  await page.waitForURL(new RegExp(`sort=${sort}&dir=desc`));
  await expect(header).toHaveAttribute("aria-sort", "descending");
  expect(isSorted(await numbers(page, column), "desc"), `${label} desc`).toBe(true);
  await page.getByRole("link", { name: `Sort by ${label}`, exact: true }).click();
  await page.waitForURL(new RegExp(`sort=${sort}&dir=asc`));
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  expect(isSorted(await numbers(page, column), "asc"), `${label} asc`).toBe(true);
}

test("Inventory sorts by a column and keeps the status filter @mobile", async ({ page }) => {
  await createAvailableUnit(unique("SRT"));
  await createAvailableUnit(unique("SRT"));
  await login(page, "superAdmin");
  await page.goto("/dashboard/inventory?project=all&status=available");
  await checkSort(page, "Base price", "price", 7);
  await expect(page).toHaveURL(/status=available/);
  await expect(page.getByRole("columnheader", { name: "Comment" }).getByRole("link")).toHaveCount(0);
  // An unknown sort is ignored.
  await page.goto("/dashboard/inventory?project=all&sort=evil%3Bdrop");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("Payments sort by amount and keep the type filter @mobile", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/dashboard/finance?type=token");
  await checkSort(page, "Amount", "amount", 8);
  await expect(page).toHaveURL(/type=token/);
  await expect(page.getByText("500,000").first()).toBeVisible();
});

test("Finance entries sort by amount, and Apply keeps the sort @mobile", async ({ page }) => {
  await seedEntriesFor(unique("Sort cat"), ["1000", "3000", "2000"]);
  await login(page, "accountant");
  await page.goto("/dashboard/finance/entries");
  await checkSort(page, "Amount", "amount", 5);
  await page.getByRole("form", { name: "Filter entries" }).getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/sort=amount&dir=asc/);
  expect(isSorted(await numbers(page, 5), "asc")).toBe(true);
});

test("Outstanding sorts by computed figures, keeps filters and shows its totals @mobile", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/dashboard/finance/outstanding?milestone=not_met");
  const before = await page.getByText(/\d+ bookings$/).textContent();
  await checkSort(page, "Paid", "paid", 7);
  await checkSort(page, "Outstanding", "outstanding", 8);
  await expect(page).toHaveURL(/milestone=not_met/);
  await expect(page.getByText(before!)).toBeVisible(); // Totals cover the whole list, not the order.
  await expect(page.getByText(/^Page 1 of \d+ · \d+ total$/)).toBeVisible();
});

test("roles without finance access can't reach the sorted finance lists", async ({ browser }) => {
  for (const role of ["agent1", "hr"] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    for (const url of ["/dashboard/finance/outstanding?sort=paid", "/dashboard/finance/entries?sort=amount"]) {
      await page.goto(url);
      await expect(page.getByText("Access denied").first()).toBeVisible();
    }
    await ctx.close();
  }
});
