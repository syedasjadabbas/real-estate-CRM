import { test } from "@playwright/test";
import { createLeadFor, overdueFollowUpsFor, removeFollowUpsFor } from "./support/data";
import { api, expect, login, selectTestProject, unique } from "./support/seed";

/** FR-027: a To-dos bucket above one page can be walked to its last item (it used to stop silently). */

let leadId = "";
test.afterEach(async () => {
  if (leadId) await removeFollowUpsFor(leadId);
});

test("an agent pages through overdue follow-ups to the last one @mobile", async ({ browser }) => {
  const marker = unique("Overdue call");
  leadId = await createLeadFor("agent2", unique("Todo Lead"));
  await overdueFollowUpsFor("agent2", leadId, marker, 55);

  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const page = await ctx.newPage();
  await login(page, "agent2");
  await page.goto("/dashboard/leads/todos?bucket=overdue");
  const rows = page.locator("li").filter({ hasText: marker });
  await expect(rows).toHaveCount(50);
  await expect(page.getByText(`${marker} 000`)).toBeVisible();
  await expect(page.getByText(`${marker} 054`)).toHaveCount(0);
  const total = Number((await page.getByText(/\d+ in this view/).textContent())?.match(/\d+/)?.[0]);
  expect(total).toBeGreaterThanOrEqual(55);

  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/[?&]page=2/);
  await expect(page).toHaveURL(/bucket=overdue/);
  await expect(page.getByText(`${marker} 054`)).toBeVisible();
  await expect(rows).toHaveCount(5);
  await expect(page.getByText(new RegExp(`^${total} in this view$`))).toBeVisible();

  // Changing bucket returns to page 1.
  await page.getByRole("link", { name: /^Today/ }).click();
  await page.waitForURL(/bucket=today/);
  await expect(page).not.toHaveURL(/[?&]page=/);

  const res = await api<{ items: unknown[]; page: number; pageCount: number }>(page, "/api/v1/leads/todos?bucket=overdue&page=2");
  expect(res.status).toBe(200);
  expect(res.data).toMatchObject({ page: 2, pageCount: 2 });
  await ctx.close();
});

test("a bucket that fits on one page has no paging controls", async ({ page }) => {
  leadId = "";
  await login(page, "agent2");
  await page.goto("/dashboard/leads/todos?bucket=today");
  await expect(page.getByText(/\d+ in this view/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Next" })).toHaveCount(0);
});
