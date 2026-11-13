import { test } from "@playwright/test";
import { api, expect, login, type Role } from "./support/seed";

/** F-9: the Performance footnote says what the page actually does (calculation: performance.test.ts "Q25"). */

const CALLS_NOTE = "Calls are call recordings uploaded to a lead (one recording = one call)";
const OLD_CALLS_NOTE = "uploaded call recordings are not counted as calls unless the client confirms that rule";
const LEADS_NOTE = "Leads are counted under their current owner, on their original assignment date.";

for (const role of ["superAdmin", "admin", "manager", "agent1"] satisfies Role[]) {
  test(`${role} sees the corrected Performance footnote @mobile`, async ({ page }) => {
    await login(page, role);
    await page.goto("/dashboard/performance");
    await expect(page.getByText(CALLS_NOTE, { exact: false })).toBeVisible();
    await expect(page.getByText(LEADS_NOTE, { exact: false })).toBeVisible();
    await expect(page.getByText("the date they were added")).toHaveCount(0);
    await expect(page.getByText("need call recordings, which the CRM does not capture yet")).toHaveCount(0);
    // Calls now come from recordings (10 Nov 2026): no "not available" wording on the call charts or footnote.
    await expect(page.getByText(OLD_CALLS_NOTE, { exact: false })).toHaveCount(0);
    await expect(page.getByText("Call quality", { exact: true })).toBeVisible();
    // Ranking charts are for Admins; an agent sees only their own figures (13 Nov 2026).
    for (const title of ["Call volume leaders", "Calls vs meetings"]) await expect(page.getByText(title, { exact: true })).toHaveCount(role === "agent1" ? 0 : 1);
    await expect(page.getByText(role === "agent1" ? "Your performance" : "Team at a glance", { exact: true })).toBeVisible();
    await expect(page.getByText("count as calls but are not in either bucket", { exact: false })).toBeVisible();
    await expect(page.getByText("which the CRM does not capture")).toHaveCount(0);
    // The sign-in note beside it is unchanged.
    await expect(page.getByText("They are not attendance", { exact: false })).toBeVisible();
  });
}

test("the KPI table sorts by Calls and Call min", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/dashboard/performance");
  await page.getByRole("link", { name: "Sort by Calls", exact: true }).click();
  await page.waitForURL(/sort=calls/);
  await expect(page.getByRole("columnheader", { name: "Sort by Calls", exact: true })).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.getByRole("link", { name: "Sort by Call min" }).click();
  await page.waitForURL(/sort=callMin/);
  await expect(page.getByRole("columnheader", { name: /Call min/ })).toHaveAttribute("aria-sort", /ascending|descending/);
});

test("the KPI table shows average first touch, and it sorts", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/dashboard/performance");
  const header = page.getByRole("columnheader", { name: /Avg first touch/ });
  await expect(header).toBeVisible();
  await header.getByRole("link").click();
  await page.waitForURL(/sort=avgFirstTouchMs/);
  await expect(page.getByRole("columnheader", { name: /Avg first touch/ })).toHaveAttribute("aria-sort", /ascending|descending/);
});

for (const role of ["hr", "accountant"] satisfies Role[]) {
  test(`${role} gets no Performance page or footnote`, async ({ page }) => {
    await login(page, role);
    await page.goto("/dashboard/performance");
    await expect(page.getByText("Access denied").first()).toBeVisible();
    await expect(page.getByText(LEADS_NOTE, { exact: false })).toHaveCount(0);
    expect((await api(page, "/api/v1/performance")).status).toBe(403);
  });
}

test("Performance sorting, paging and CSV export still work", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/dashboard/performance");
  await expect(page.getByText(/^Page 1 of \d+ · \d+ total$/)).toBeVisible();
  await page.getByRole("link", { name: "Sort by Booked" }).click();
  await page.waitForURL(/sort=booked/);
  await expect(page.getByRole("columnheader", { name: /Booked/ })).toHaveAttribute("aria-sort", /ascending|descending/);
  await expect(page.getByText("Leads are counted under their current owner", { exact: false })).toBeVisible();

  const csv = await page.request.get("/api/v1/performance/export");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
});
