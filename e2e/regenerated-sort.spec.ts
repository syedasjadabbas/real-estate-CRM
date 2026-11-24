import { test, type Page } from "@playwright/test";
import { createLeadFor, markRegenerated } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/** FR-005: the Regenerated view's headers sort, and until one is chosen it keeps its own order. */

const order = async (page: Page, prefix: string) => (await page.getByRole("link", { name: new RegExp(`^${prefix}`) }).allTextContents()).map((t) => t.replace(`${prefix} `, ""));

test("Regenerated headers reorder the list, and no column claims the sort until one is chosen @mobile", async ({ page, context }) => {
  const prefix = unique("Regen");
  const older = await createLeadFor("agent1", `${prefix} Alpha`);
  const newer = await createLeadFor("agent1", `${prefix} Bravo`);
  await markRegenerated(older, 10);
  await markRegenerated(newer, 5);
  await selectTestProject(context);
  await login(page, "manager");

  await page.goto(`/dashboard/leads/regenerated?q=${encodeURIComponent(prefix)}`);
  await expect.poll(() => order(page, prefix)).toEqual(["Bravo", "Alpha"]);
  await expect(page.getByRole("columnheader", { name: "Sort by Created", exact: true })).not.toHaveAttribute("aria-sort", /.+/);

  await page.getByRole("link", { name: "Sort by Lead", exact: true }).click();
  await page.waitForURL(/sort=name/);
  await expect(page.getByRole("columnheader", { name: "Sort by Lead", exact: true })).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => order(page, prefix)).toEqual(["Bravo", "Alpha"]);

  await page.getByRole("link", { name: "Sort by Lead", exact: true }).click();
  await page.waitForURL(/dir=asc/);
  await expect(page.getByRole("columnheader", { name: "Sort by Lead", exact: true })).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => order(page, prefix)).toEqual(["Alpha", "Bravo"]);
});
