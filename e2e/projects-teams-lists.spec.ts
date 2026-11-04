import { test } from "@playwright/test";
import { removeSeededLists, seedProjects, seedTeams } from "./support/data";
import { expect, login, unique } from "./support/seed";

/** F-5 (FR-005): Projects and Teams page 50 at a time and sort on the server, keeping search, filters and the selected team. */

let prefix = "";
test.beforeEach(() => {
  // "Zz": sorts after every other team name in the shared test database.
  prefix = unique("Zz Paging");
});
test.afterEach(async () => {
  await removeSeededLists(prefix);
});

test("Projects: 50 cards a page, sorting keeps the search and returns to page 1 @mobile", async ({ page }) => {
  await seedProjects(prefix, 55);
  await login(page, "admin");
  await page.goto(`/dashboard/projects?q=${encodeURIComponent(prefix)}`);
  const cards = page.locator("article");
  const firstName = cards.first().getByRole("heading");
  await expect(cards).toHaveCount(50);
  await expect(page.getByText("Page 1 of 2 · 55 total")).toBeVisible();

  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/[?&]page=2/);
  await expect(cards).toHaveCount(5);
  await expect(page).toHaveURL(/[?&]q=/);

  const sorts = page.getByRole("navigation", { name: "Sort projects" });
  await sorts.getByRole("link", { name: "Sort by Name" }).click();
  await page.waitForURL(/sort=name&dir=asc/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(cards).toHaveCount(50);
  await expect(firstName).toHaveText(`${prefix} 000`);

  await sorts.getByRole("link", { name: "Sort by Name, now ascending" }).click();
  await page.waitForURL(/sort=name&dir=desc/);
  await expect(firstName).toHaveText(`${prefix} 054`);
  // The sort survives paging.
  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/[?&]page=2/);
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  await expect(cards).toHaveCount(5);
  await expect(cards.last().getByRole("heading")).toHaveText(`${prefix} 000`);

  // Equal unit counts fall back to the name; an unknown sort is ignored.
  await page.goto(`/dashboard/projects?q=${encodeURIComponent(prefix)}&sort=units&dir=desc`);
  await expect(firstName).toHaveText(`${prefix} 000`);
  await page.goto(`/dashboard/projects?q=${encodeURIComponent(prefix)}&sort=evil%3Bdrop&dir=sideways`);
  await expect(cards).toHaveCount(50);
  await expect(firstName).toHaveText(`${prefix} 000`);
});

test("Teams: 50 a page and sortable; a team on page 2 opens without losing the place @mobile", async ({ page }) => {
  await seedTeams(prefix, 55);
  await login(page, "admin");
  await page.goto("/dashboard/teams?tab=teams&sort=name&dir=asc");
  const sorts = page.getByRole("navigation", { name: "Sort teams" });
  await expect(sorts).toBeVisible();
  const rows = page.locator("ul li a[href*='team=']");
  await expect(rows).toHaveCount(50);
  await expect(page.getByText(/^Page 1 of \d+ · \d+ total$/)).toBeVisible();

  await sorts.getByRole("link", { name: "Sort by Name, now ascending" }).click();
  await page.waitForURL(/sort=name&dir=desc/);
  await expect(rows.first()).toContainText(`${prefix} 054`);
  await page.getByRole("link", { name: "Next" }).click();
  await page.waitForURL(/[?&]page=2/);
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  const target = rows.filter({ hasText: `${prefix} 000` });
  await target.click();
  await page.waitForURL(/[?&]team=/);
  await expect(page).toHaveURL(/[?&]page=2/);
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: `${prefix} 000` })).toBeVisible();

  await sorts.getByRole("link", { name: "Sort by Members" }).click();
  await page.waitForURL(/sort=members&dir=desc/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(rows.first()).not.toContainText(prefix);
  await page.goto("/dashboard/teams?tab=teams&sort=evil%3Bdrop");
  await expect(rows).toHaveCount(50);
  await expect(rows.last()).toContainText("Inactive");
});

test("a manager's Teams list holds only their teams; an agent gets no list", async ({ browser }) => {
  await seedTeams(prefix, 3);
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager");
  await mgr.goto("/dashboard/teams?tab=teams&sort=name&dir=desc");
  await expect(mgr.getByRole("navigation", { name: "Sort teams" })).toBeVisible();
  await expect(mgr.getByText(prefix)).toHaveCount(0);
  await mgrCtx.close();

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto("/dashboard/teams?tab=teams&sort=name");
  await expect(agent.getByRole("navigation", { name: "Sort teams" })).toHaveCount(0);
  await agentCtx.close();
});
