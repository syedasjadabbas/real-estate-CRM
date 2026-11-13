import { test, type Page } from "@playwright/test";
import { auditCount, bookingState, createAvailableUnit, createBookingFor, createLeadFor, leadStage } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/**
 * F-1: while a lead has an open booking, its stage follows the booking. Mark lost and pipeline moves
 * are refused with an explanation; cancelling the booking releases the unit, after which the lead can
 * be marked lost as usual.
 */

const OPEN_BOOKING = "This lead has an open booking, so its stage follows the booking.";

async function dragTo(page: Page, name: string, columnLabel: string) {
  const handle = page.getByRole("button", { name: `Drag ${name} to another stage` });
  const target = page.locator("[data-stage]").filter({ has: page.getByRole("heading", { name: columnLabel, exact: true }) });
  await expect(handle).toBeVisible();
  await expect(target).toBeVisible();
  const from = (await handle.boundingBox())!;
  const box = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 10, { steps: 4 });
  await page.mouse.move(box.x + 40, box.y + 60, { steps: 12 });
  await page.mouse.up();
}

test("a lead with an open booking can't be marked lost or moved until the booking is cancelled", async ({ page }) => {
  const name = unique("E2E Open Booking");
  const leadId = await createLeadFor("agent1", name);
  const unitId = await createAvailableUnit(unique("F1").replace(/\s+/g, "-"));
  const bookingId = await createBookingFor(leadId, unitId);
  expect(await leadStage(leadId)).toBe("booking_in_process");

  await selectTestProject(page.context());
  await login(page, "manager");

  // Mark lost on the lead page is refused; nothing changes.
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(async () => {
    await page.getByLabel("Lost reason").selectOption({ index: 1 });
    await expect(page.getByRole("button", { name: "Mark lost" })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Mark lost" }).click();
  await expect(page.getByRole("alert").filter({ hasText: OPEN_BOOKING })).toBeVisible();
  expect(await leadStage(leadId)).toBe("booking_in_process");
  expect(await bookingState(bookingId)).toEqual({ stage: "token_pending", unitStatus: "reserved" });

  // Dragging the card to another stage on the pipeline is refused too.
  await page.setViewportSize({ width: 3100, height: 900 });
  await page.goto("/dashboard/leads/pipeline");
  await dragTo(page, name, "Contacted");
  await expect(page.getByRole("alert").filter({ hasText: OPEN_BOOKING })).toBeVisible();
  expect(await leadStage(leadId)).toBe("booking_in_process");
  expect(await auditCount("lead.lost", leadId)).toBe(0);

  // Cancelling the booking releases the unit; the lead can then be marked lost.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard/bookings/${bookingId}`);
  await expect(async () => {
    await page.getByLabel("Reason").fill("Buyer withdrew before paying the token");
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Booking cancelled. The unit is available again." })).toBeVisible();
  expect(await bookingState(bookingId)).toEqual({ stage: "cancelled", unitStatus: "available" });

  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(async () => {
    await page.getByLabel("Lost reason").selectOption({ index: 1 });
    await expect(page.getByRole("button", { name: "Mark lost" })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Mark lost" }).click();
  await expect.poll(() => leadStage(leadId)).toBe("lost_lead");
  expect(await auditCount("lead.lost", leadId)).toBe(1);
});
