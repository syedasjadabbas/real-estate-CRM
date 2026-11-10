import { test } from "@playwright/test";
import { createLeadFor, setLeadCreatedHoursAgo } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique } from "./support/seed";

/** FR-010: a dashboard tile opens the same leads it counts, for rolling ranges and the team filter. */

test("a rolling range tile opens exactly its window, shows why, and can be cleared @mobile", async ({ page }) => {
  const inside = unique("Inside Window");
  const outside = unique("Before Window");
  // High priority so the uncleared list shows them on its first page however many leads other specs add.
  await createLeadFor("agent1", inside, "manager", { priority: "high" });
  // Before the 24h window, but on a day whole-day filtering would have included.
  await setLeadCreatedHoursAgo(await createLeadFor("agent1", outside, "manager", { priority: "high" }), 24.2);

  await selectTestProject(page.context());
  await login(page, "manager");
  await page.goto("/dashboard?range=24h");
  await page.locator('[data-kpi="Total leads"]').click();
  await page.waitForURL(/\/dashboard\/leads\?.*createdFrom=/);
  await expect(page).toHaveURL(/createdTo=/);
  await expect(page.getByRole("note").filter({ hasText: "Opened from the dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: inside }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: outside })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.waitForURL((u) => !u.search.includes("createdFrom"));
  await expect(page.getByRole("note").filter({ hasText: "Opened from the dashboard" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: outside }).first()).toBeVisible();
});

test("the team filter carries through to the list; Open pipeline now links", async ({ page }) => {
  const { today } = seed();
  await selectTestProject(page.context());
  await login(page, "superAdmin");
  await page.goto(`/dashboard?range=custom&from=${today}&to=${today}`);
  await page.getByRole("navigation", { name: "Team scope" }).getByRole("button", { name: "Team 1" }).click();
  await page.waitForURL(/[?&]team=/);
  const team = new URL(page.url()).searchParams.get("team")!;

  await page.locator('[data-kpi="Open pipeline"]').click();
  await page.waitForURL(/\/dashboard\/leads\?.*stage=/);
  await expect(page).toHaveURL(new RegExp(`team=${team}`));
  await expect(page).toHaveURL(new RegExp(`from=${today}`));
  await expect(page.getByRole("note").filter({ hasText: "Team 1" })).toBeVisible();
  // Agent Outside is in Team 2, so none of this list is theirs.
  const list = await api<{ rows: { stage: string }[]; teamName: string }>(page, `/api/v1/leads?team=${team}&from=${today}&to=${today}`);
  expect(list.data.teamName).toBe("Team 1");
});

test("the Won and Regenerated tiles keep the range; a manager can't widen a list with another team", async ({ page }) => {
  await selectTestProject(page.context());
  await login(page, "manager");
  await page.goto("/dashboard?range=7d");
  await page.locator('[data-kpi="Won / Lost"]').click();
  await page.waitForURL(/\/dashboard\/leads\/won\?.*createdFrom=/);
  await page.goto("/dashboard?range=7d");
  await page.locator('[data-kpi="Regenerated"]').click();
  await page.waitForURL(/\/dashboard\/leads\/regenerated\?.*createdFrom=/);

  const other = "00000000-0000-4000-8000-000000000000";
  const plain = await api<{ total: number; teamName: string | null }>(page, "/api/v1/leads");
  const res = await api<{ total: number; teamName: string | null }>(page, `/api/v1/leads?team=${other}`);
  expect(res.data).toMatchObject({ total: plain.data.total, teamName: null });
});
