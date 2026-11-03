import { test } from "@playwright/test";
import { api, expect, login, seed, selectTestProject } from "./support/seed";

/** List controls from FR-005 and the module plans: sorting, filters, paging, year and KPI links. */

test("dashboard KPI tiles open the matching list for the same days", async ({ page }) => {
  const { today } = seed();
  await selectTestProject(page.context());
  await login(page, "manager");
  await page.goto(`/dashboard?range=custom&from=${today}&to=${today}`);
  await page.locator('[data-kpi="Total leads"]').click();
  await page.waitForURL(`**/dashboard/leads?from=${today}&to=${today}`);
  await page.goto(`/dashboard?range=custom&from=${today}&to=${today}`);
  await page.locator('[data-kpi="Won / Lost"]').click();
  await page.waitForURL(`**/dashboard/leads/won?from=${today}&to=${today}`);
});

test("bookings sort by a column header, then reverse", async ({ page }) => {
  await login(page, "superAdmin");
  await page.goto("/dashboard/bookings?project=all");
  await page.getByRole("link", { name: "Sort by Paid" }).click();
  await page.waitForURL(/sort=paid&dir=desc/);
  await expect(page.getByRole("columnheader", { name: /Paid/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("link", { name: "Sort by Paid" }).click();
  await page.waitForURL(/sort=paid&dir=asc/);
  await expect(page.getByRole("columnheader", { name: /Paid/ })).toHaveAttribute("aria-sort", "ascending");
});

test("finance lists filter payments by method and outstanding by sales agent", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/dashboard/finance");
  const toolbar = page.getByRole("search");
  await expect(async () => {
    await toolbar.getByLabel("Method").selectOption({ label: "Cash" });
    await expect(page).toHaveURL(/[?&]method=[0-9a-f-]{36}/, { timeout: 2_000 });
  }).toPass();
  // The seeded 500,000 payment was cash.
  await expect(page.getByRole("table").first()).toContainText("500,000");

  await page.goto("/dashboard/finance/outstanding");
  await expect(async () => {
    await page.getByRole("search").getByLabel("Sales agent").selectOption({ label: seed().users.agent1.name });
    await expect(page).toHaveURL(/[?&]agent=[0-9a-f-]{36}/, { timeout: 2_000 });
  }).toPass();
  await expect(page.getByRole("cell", { name: seed().users.agent1.name }).first()).toBeVisible();
});

test("HR → Leave filters, sorts and picks the year; My leave shows the year @mobile", async ({ page }, testInfo) => {
  const year = seed().today.slice(0, 4);
  await login(page, "hr");
  // Its own request, so the list has a row whatever ran before (one day; a different day per project).
  const day = `${year}-12-${testInfo.project.name === "mobile" ? "27" : "28"}`;
  const res = await api(page, "/api/v1/leave", { method: "POST", data: { type: "annual", startDate: day, endDate: day, reason: "E2E list controls" } });
  expect(res.status).toBe(201);

  await page.goto("/dashboard/hr/leave");
  const filters = page.getByRole("form", { name: "Filter leave requests" });
  await expect(filters.getByLabel("Year")).toHaveValue(year);
  await filters.getByLabel("Status").selectOption("pending");
  await filters.getByLabel("Search").fill("E2E list controls");
  await filters.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/[?&]status=pending/);
  const table = page.getByRole("table", { name: "All leave requests" });
  await expect(table.getByRole("row").filter({ hasText: seed().users.hr.name }).first()).toBeVisible();
  await expect(filters.getByRole("link", { name: "Clear all" })).toBeVisible();

  await page.getByRole("link", { name: "Sort by Employee" }).click();
  await page.waitForURL(/sort=employee/);
  // Filters are kept when sorting.
  await expect(page).toHaveURL(/status=pending/);
  await expect(page.getByRole("table", { name: "All leave requests" }).getByRole("columnheader", { name: /Employee/ })).toHaveAttribute("aria-sort", "descending");

  await page.goto("/dashboard/workspace");
  await expect(page.getByText(`My leave · ${year}`)).toBeVisible();
});
