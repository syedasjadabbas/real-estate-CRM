import { test } from "@playwright/test";
import { assignBookingToNewAgent, cancelBookingFor, createAvailableUnit, createBookingFor, createLeadFor } from "./support/data";
import { expect, login, unique } from "./support/seed";

/** F-23: two agents with the same name stay two rows in the Outstanding by agent report and its CSV. */

let bookingIds: string[] = [];
test.afterEach(async () => {
  // Cancelled bookings leave the outstanding figures, so later specs see the usual totals.
  for (const id of bookingIds) await cancelBookingFor(id, "superAdmin");
  bookingIds = [];
});

test("agents sharing a name stay separate on the report and in the export @mobile", async ({ page }) => {
  const name = unique("Same Name Agent");
  for (const label of ["CA", "CB"]) {
    const bookingId = await createBookingFor(await createLeadFor("agent1", unique("Twin Lead")), await createAvailableUnit(unique(label)));
    bookingIds.push(bookingId);
    await assignBookingToNewAgent(bookingId, name);
  }

  await login(page, "accountant");
  await page.goto("/dashboard/finance/reports");
  await expect(page.getByRole("heading", { name: "Outstanding by sales agent" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(2);

  const csv = await page.request.get("/api/v1/finance/reports/export?report=outstanding_agent");
  expect(csv.status()).toBe(200);
  const rows = (await csv.text()).trim().split("\n").filter((l) => l.startsWith(`${name},`));
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.split(",")[2]).toBe("1"); // one booking each, not two on one row
});
