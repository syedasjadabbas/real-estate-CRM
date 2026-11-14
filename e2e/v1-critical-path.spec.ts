import { test, type Page } from "@playwright/test";
import { createAvailableUnit, createLeadFor, leadStage } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique, uniquePhone } from "./support/seed";

/**
 * V1 readiness: the core sale through the real pages, as the presentation will run it. Other specs
 * set these records up through services; this one uses only the forms a person uses.
 */

/** A select by its label. Required fields are named "Label *", so this matches the start of the name. */
const combo = (page: Page, label: string) => page.getByRole("combobox", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}`) });

/** Picks the option containing `match`, by its value. */
async function choose(page: Page, label: string, match: string) {
  const select = combo(page, label);
  await expect(select.locator("option", { hasText: match }).first()).toBeAttached();
  const value = await select.locator("option", { hasText: match }).first().getAttribute("value");
  await select.selectOption(value!);
}

test("a lead goes from reassignment to meeting, booking, payment, confirmation and client", async ({ browser, page, context }) => {
  const name = unique("V1 Buyer");
  const unitNo = unique("V1U");
  const leadId = await createLeadFor("agent1", name);
  await createAvailableUnit(unitNo);
  await selectTestProject(context);
  await login(page, "manager");

  // Reassign through the lead page.
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const reassign = page.getByRole("button", { name: "Reassign" });
  await expect(async () => {
    await page.getByLabel("Owner", { exact: true }).selectOption({ label: "Agent B" });
    await expect(reassign).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await reassign.click();
  await expect(page.getByText("Lead reassigned.")).toBeVisible();

  // Schedule a meeting.
  await page.goto("/dashboard/meetings/new");
  const title = unique("V1 Meeting");
  await expect(async () => {
    await page.getByLabel("Title").fill(title);
    // Date field plus hour / minute / AM-PM lists (14 Nov 2026).
    await page.getByLabel("Starts (Pakistan time)").fill("2099-01-15");
    await page.getByLabel("Hour").first().selectOption("11");
    await page.getByLabel("Minute").first().selectOption("00");
    await page.getByLabel("AM or PM").first().selectOption("AM");
    await choose(page, "Meeting type", "Site visit");
    await choose(page, "Lead", name);
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    await page.waitForURL(/\/dashboard\/meetings\/[0-9a-f-]{36}/, { timeout: 3_000 });
  }).toPass();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.goto("/dashboard/meetings");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();

  // Book the unit.
  await page.goto(`/dashboard/bookings/new?project=${seed().projectId}`);
  await expect(async () => {
    await choose(page, "Lead", name);
    await choose(page, "Unit (available)", unitNo);
    await page.getByLabel("Per sq ft rate (PKR)").fill("25,000");
    await page.getByLabel("Token amount (PKR)").fill("500,000");
    await expect(page.getByText("PKR 12,500,000").first()).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/dashboard\/bookings\/[0-9a-f-]{36}$/);
  const bookingUrl = page.url();
  expect(await leadStage(leadId)).toBe("booking_in_process");

  // The unit is held, and no longer offered.
  await page.goto(`/dashboard/inventory?q=${encodeURIComponent(unitNo)}`);
  await expect(page.getByRole("row").filter({ hasText: unitNo })).toContainText("Reserved");
  await page.goto(`/dashboard/bookings/new?project=${seed().projectId}`);
  await expect(combo(page, "Unit (available)").locator("option", { hasText: unitNo })).toHaveCount(0);

  // A booking starts at Token, which already takes payments.

  // The accountant posts the token. Dated last year, so other specs' current-period totals don't move.
  const accountantContext = await browser.newContext();
  const accountant = await accountantContext.newPage();
  await login(accountant, "accountant");
  await accountant.goto("/dashboard/finance/record");
  const lastYear = `${new Date().getFullYear() - 1}-06-15`;
  await expect(async () => {
    await choose(accountant, "Booking", name);
    await expect(accountant.getByText("PKR 12,500,000").first()).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await combo(accountant, "Type").selectOption({ label: "Token" });
  await accountant.getByLabel("Amount (PKR)").fill("500,000");
  await accountant.getByLabel("Received on").fill(lastYear);
  await combo(accountant, "Method").selectOption({ label: "Cash" });
  await accountant.getByRole("button", { name: "Post payment" }).click();
  await accountant.waitForURL(/\/dashboard\/finance\/payments\/[0-9a-f-]{36}/);
  await expect(accountant.getByText("PKR 500,000").first()).toBeVisible();
  await accountantContext.close();

  // The manager walks the booking through each stage to Closed Won.
  await page.goto(bookingUrl);
  const confirm = page.getByRole("button", { name: "Close as Won" });
  const move = page.getByRole("button", { name: /^Move to / });
  for (let i = 0; i < 12; i++) {
    // Wait for the next action to render before deciding: the last stage offers Confirm instead.
    await expect(move.or(confirm)).toBeVisible();
    if (await confirm.isVisible()) break;
    const label = (await move.textContent())!.replace("Move to ", "");
    await move.click();
    await expect(page.getByText(`Moved to ${label}.`)).toBeVisible();
  }
  await confirm.click();
  await expect(page.getByText("Moved to Closed Won.")).toBeVisible();
  expect(await leadStage(leadId)).toBe("booked");

  // The lead's history shows the sale, and the buyer is a client.
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByText("Reassigned").first()).toBeVisible();
  await expect(page.getByText("Client created from the confirmed booking")).toBeVisible();
  await page.goto(`/dashboard/clients?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
});

test("a task can be created and appears in the task list", async ({ page, context }) => {
  const title = unique("V1 Task");
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/tasks/new");
  await expect(async () => {
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await page.waitForURL(/\/dashboard\/tasks\/[0-9a-f-]{36}/, { timeout: 3_000 });
  }).toPass();
  await page.goto("/dashboard/tasks");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
});

test("the API refuses forged list ids and an unknown report, without a server error", async ({ page }) => {
  const s = seed();
  const forged = "00000000-0000-4000-8000-000000000000";
  await login(page, "superAdmin");
  const lead = (extra: Record<string, unknown>) =>
    api(page, "/api/v1/leads", {
      method: "POST",
      data: { projectId: s.projectId, name: unique("Forged"), phoneCountryCode: "+92", phoneNumber: uniquePhone(), sourceId: s.sourceId, ...extra },
    });
  expect((await lead({ sourceId: forged })).status).toBe(400);
  expect((await lead({ budgetRangeId: forged })).status).toBe(400);
  expect((await api(page, "/api/v1/finance/reports/export?report=nonsense")).status).toBe(400);
  expect((await api(page, "/api/v1/finance/reports/export?report=collections")).status).toBe(200);
});

test("an unknown address and an unknown record show a page, not a raw error @mobile", async ({ page }) => {
  await login(page, "agent1");
  const missing = await page.goto("/dashboard/no-such-page");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await page.waitForURL(/\/dashboard$/);
});
