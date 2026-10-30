import { test, type Locator, type Page } from "@playwright/test";
import { auditCount, createLeadFor, leadStage } from "./support/data";
import { expect, login, unique, selectTestProject } from "./support/seed";

/**
 * Pipeline drag-and-drop (FR-023): a card is moved by its handle with a mouse (desktop) or a finger
 * (mobile, real touch events). The server action applies the stage rules and writes the audit row.
 */

const column = (page: Page, label: string) => page.locator("[data-stage]").filter({ has: page.getByRole("heading", { name: label, exact: true }) });

/** Count shown in a column's accessible name ("New Lead: 3 leads"). */
async function columnTotal(col: Locator) {
  const label = (await col.getAttribute("aria-label")) ?? "";
  return Number(/: (\d+) leads$/.exec(label)?.[1] ?? NaN);
}

/** A point inside the visible part of the target column, below its header. */
async function dropPoint(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const width = page.viewportSize()!.width;
  const x = Math.min(box.x + 40, width - 8);
  return { x, y: box.y + 60 };
}

async function openBoard(page: Page, role: "agent1" | "manager") {
  await selectTestProject(page.context());
  await login(page, role);
  await page.goto("/dashboard/leads/pipeline");
}

test("desktop: dragging a card with the mouse moves the lead to the dropped stage", async ({ page }) => {
  const name = unique("E2E Drag");
  const leadId = await createLeadFor("agent1", name);
  await openBoard(page, "agent1");
  const target = column(page, "Contact Attempted");
  const before = await columnTotal(target);
  const handle = page.getByRole("button", { name: `Drag ${name} to another stage` });
  await expect(handle).toBeVisible();

  const from = (await handle.boundingBox())!;
  const to = await dropPoint(page, target);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  await expect(target.getByRole("link", { name, exact: true })).toBeVisible();
  await expect.poll(() => leadStage(leadId)).toBe("contact_attempted");
  await expect.poll(() => columnTotal(target)).toBe(before + 1);
  expect(await auditCount("lead.stage", leadId)).toBe(1);
});

test("desktop: dropping on Lost or Booked is refused with an explanation", async ({ page }) => {
  const name = unique("E2E Refused");
  const leadId = await createLeadFor("agent1", name);
  // Wide enough for all ten columns: the drop targets are on screen without edge auto-scroll.
  await page.setViewportSize({ width: 3100, height: 900 });
  await openBoard(page, "agent1");
  for (const [label, message] of [
    ["Lost Lead", "Mark a lead lost from its page (a reason is required)."],
    ["Booked", "Booked is set by the lead's booking."],
  ] as const) {
    const handle = page.getByRole("button", { name: `Drag ${name} to another stage` });
    const target = column(page, label);
    const from = (await handle.boundingBox())!;
    const to = await dropPoint(page, target);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  }
  expect(await leadStage(leadId)).toBe("new_lead");
  expect(await auditCount("lead.stage", leadId)).toBe(0);
});

test("mobile: dragging a card with a finger moves the lead @mobile-only", async ({ page }) => {
  const name = unique("E2E Touch");
  const leadId = await createLeadFor("agent1", name);
  await openBoard(page, "agent1");
  const target = column(page, "Contact Attempted");
  const handle = page.getByRole("button", { name: `Drag ${name} to another stage` });
  await handle.scrollIntoViewIfNeeded();
  await expect(handle).toBeInViewport();

  const from = (await handle.boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const to = await dropPoint(page, target);
  // Real touch input through the browser (Playwright's touchscreen only taps).
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y) }] : [] });
  await touch("touchStart", start);
  for (let i = 1; i <= 12; i++) await touch("touchMove", { x: start.x + ((to.x - start.x) * i) / 12, y: start.y + ((to.y - start.y) * i) / 12 });
  await touch("touchEnd");

  await expect.poll(() => leadStage(leadId)).toBe("contact_attempted");
  await expect(target.getByRole("link", { name, exact: true })).toBeAttached();
});

test("users who may not edit leads see no drag handles", async ({ page }) => {
  // HR cannot open the pipeline at all; the board itself is covered by the auth spec for them.
  await selectTestProject(page.context());
  await login(page, "hr");
  await page.goto("/dashboard/leads/pipeline");
  await expect(page.getByText("Access denied").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Drag / })).toHaveCount(0);
});
