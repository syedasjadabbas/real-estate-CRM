import { test, type Page } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { expect, login, unique, selectTestProject, type Role } from "./support/seed";

/**
 * Critical pages at desktop (1440 px) and phone (375 px) widths: they load, show their main
 * content, and never scroll the whole page sideways (wide tables and the board scroll inside their
 * own containers). Tagged @mobile so both projects run it.
 */

async function expectNoPageOverflow(page: Page, url: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${url} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
}

const PAGES: { role: Role; url: string | (() => Promise<string>); ready: (page: Page) => Promise<void> }[] = [
  { role: "manager", url: "/dashboard", ready: (p) => expect(p.locator('[data-kpi="Total leads"]')).toBeVisible() },
  { role: "manager", url: "/dashboard/leads", ready: (p) => expect(p.getByRole("link", { name: /E2E Responsive/ }).first()).toBeVisible() },
  { role: "agent1", url: "/dashboard/leads/pipeline", ready: (p) => expect(p.locator("[data-stage]").first()).toBeVisible() },
  {
    role: "agent1",
    url: async () => `/dashboard/leads/${await createLeadFor("agent1", unique("E2E Responsive Detail"))}`,
    ready: (p) => expect(p.getByText("Upload a recording")).toBeVisible(),
  },
  { role: "agent1", url: "/dashboard/notifications", ready: (p) => expect(p.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible() },
  { role: "accountant", url: "/dashboard/finance/reports", ready: (p) => expect(p.getByText("1 receipts")).toBeVisible() },
  { role: "hr", url: "/dashboard/workspace", ready: (p) => expect(p.getByRole("heading").first()).toBeVisible() },
];

test.beforeAll(async () => {
  await createLeadFor("agent1", unique("E2E Responsive"));
});

for (const entry of PAGES) {
  const label = typeof entry.url === "string" ? entry.url : "/dashboard/leads/[id]";
  test(`${entry.role} ${label} fits the screen @mobile`, async ({ page }) => {
    await selectTestProject(page.context());
    await login(page, entry.role);
    const url = typeof entry.url === "string" ? entry.url : await entry.url();
    const res = await page.goto(url);
    expect(res?.status()).toBe(200);
    await entry.ready(page);
    await expect(page.getByText("Access denied")).toHaveCount(0);
    await expectNoPageOverflow(page, url);
  });
}

test("the notification dropdown fits the screen @mobile", async ({ page }) => {
  await login(page, "agent1");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const dropdown = page.getByRole("dialog", { name: "Notifications" });
  await expect(dropdown).toBeVisible();
  const box = (await dropdown.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await expectNoPageOverflow(page, "notification dropdown");
});
