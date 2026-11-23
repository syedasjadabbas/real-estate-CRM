import { test, type Browser, type Page } from "@playwright/test";
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

  // Book the unit. The price comes from inventory (500 sq ft at PKR 20,000); the token needs its proof (14 Nov 2026).
  await page.goto(`/dashboard/bookings/new?project=${seed().projectId}`);
  await expect(async () => {
    await choose(page, "Lead", name);
    await choose(page, "Unit (available)", unitNo);
    await page.getByLabel("Token amount (PKR)").fill("500,000");
    await page.getByLabel("Token payment proof").setInputFiles({ name: "token.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("PKR 10,000,000").first()).toBeVisible({ timeout: 1_000 });
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

  // A booking starts at Token, which already takes payments. The accountant posts the token.
  await postPayment(browser, name, "Token", "500,000");

  // The manager walks the booking through the stages (14 Nov 2026): Token → Partial Down Payment
  // (amount + proof) → Complete Down Payment (signed booking form, then amount + proof).
  await page.goto(bookingUrl);
  await stageMove(page, "partial down payment", "Partial Down Payment", "1,000,000");
  await uploadSignedForm(page, "form-partial.png");
  await stageMove(page, "complete down payment", "Complete Down Payment", "1,000,000");
  await uploadSignedForm(page, "form-complete.png");

  // Closed Won needs the down payment posted by Accounts (19 Nov 2026): only the token is posted so far.
  const closeWon = page.getByRole("button", { name: "Close as Won" });
  await expect(closeWon).toBeEnabled();
  await closeWon.click();
  await expect(page.getByRole("alert").filter({ hasText: "Closed Won needs the down payment posted in Finance first" })).toBeVisible();
  expect(await leadStage(leadId)).toBe("booking_in_process");

  // Accounts posts the rest of the down payment (25% of PKR 10,000,000, less the token), then the manager closes it.
  await postPayment(browser, name, "Down payment", "2,000,000");
  await page.reload();
  await expect(closeWon).toBeEnabled();
  await closeWon.click();
  // Closing swaps the steps for the closed note.
  await expect(page.getByText("This booking is closed won.")).toBeVisible();
  expect(await leadStage(leadId)).toBe("booked");

  // The lead's history shows the sale, and the buyer is a client (every lead has one from the start).
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByText("Reassigned").first()).toBeVisible();
  await expect(page.getByText("Moved to Booked").first()).toBeVisible();
  await page.goto(`/dashboard/clients?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
});

/** A 1×1 PNG, accepted as a payment proof or a signed form scan. */
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082", "hex");

/** The accountant posts a cash payment on the buyer's booking. Dated last year, so other specs' current-period totals don't move. */
async function postPayment(browser: Browser, buyer: string, type: string, amount: string) {
  const context = await browser.newContext();
  const accountant = await context.newPage();
  await login(accountant, "accountant");
  await accountant.goto("/dashboard/finance/record");
  await expect(async () => {
    await choose(accountant, "Booking", buyer);
    await expect(accountant.getByText("PKR 10,000,000").first()).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await combo(accountant, "Type").selectOption({ label: type });
  await accountant.getByLabel("Amount (PKR)").fill(amount);
  await accountant.getByLabel("Received on").fill(`${new Date().getFullYear() - 1}-06-15`);
  await combo(accountant, "Method").selectOption({ label: "Cash" });
  await accountant.getByRole("button", { name: "Post payment" }).click();
  await accountant.waitForURL(/\/dashboard\/finance\/payments\/[0-9a-f-]{36}/);
  await expect(accountant.getByText(`PKR ${amount}`).first()).toBeVisible();
  await context.close();
}

/** On the booking page: enters the amount received with its proof and moves to the next stage. */
async function stageMove(page: Page, payment: string, stage: string, amount: string) {
  const move = page.getByRole("button", { name: `Move to ${stage}` });
  await expect(async () => {
    await page.getByLabel(`Amount received for the ${payment}`).fill(amount);
    await page.getByLabel("Payment proof", { exact: true }).setInputFiles({ name: `${stage.replace(/\s+/g, "-").toLowerCase()}.png`, mimeType: "image/png", buffer: png });
    await expect(move).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await move.click();
  await expect(page.getByText(`Moved to ${stage}.`)).toBeVisible();
}

/** On the booking page: uploads the booking form signed by the client for the current stage. */
async function uploadSignedForm(page: Page, fileName: string) {
  const upload = page.getByRole("button", { name: "Upload", exact: true });
  await expect(async () => {
    await page.getByLabel("Signed booking form", { exact: true }).setInputFiles({ name: fileName, mimeType: "image/png", buffer: png });
    await expect(upload).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await upload.click();
  await expect(page.getByText("Signed booking form uploaded.")).toBeVisible();
}

test("a task can be created and appears in the task list", async ({ page, context }) => {
  const title = unique("V1 Task");
  await selectTestProject(context);
  await login(page, "manager");
  // Tasks are printables since 14 Nov 2026 (general to-dos live on Leads → To-dos): a proposal needs its customer.
  await page.goto("/dashboard/tasks/new");
  await expect(async () => {
    // "Title *": the proposal template also has "Prepared by (title)" and "Project name (print title)".
    await page.getByRole("textbox", { name: /^Title\b/ }).fill(title);
    await page.getByLabel("Customer name").fill(unique("V1 Task Customer"));
    await page.getByLabel("First installment month").fill("2026-12");
    await page.getByRole("button", { name: "Create task" }).click();
    await page.waitForURL(/\/dashboard\/tasks\/[0-9a-f-]{36}/, { timeout: 3_000 });
  }).toPass();
  await page.goto(`/dashboard/tasks?q=${encodeURIComponent(title)}`);
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
