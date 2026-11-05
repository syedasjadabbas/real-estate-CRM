import { test } from "@playwright/test";
import { createAvailableUnit } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/** FR-061: a project's dimensions appear as filters on Inventory, through the real page. */

test("the size filter narrows the list, shows in the URL and clears; all projects has none @mobile", async ({ page, context }) => {
  const unitNo = unique("DIM");
  await createAvailableUnit(unitNo); // 500 sq ft, in Test Project
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/inventory");

  const size = page.getByLabel("Sizes");
  await expect(async () => {
    await size.selectOption({ label: "500 sq ft" });
    await page.waitForURL(/area=500/, { timeout: 2_000 });
  }).toPass();
  await expect(page.getByRole("link", { name: unitNo })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForURL((url) => !url.search.includes("area="));

  await page.locator("select").filter({ has: page.locator("option", { hasText: "All projects" }) }).selectOption({ label: "All projects" });
  await page.waitForURL(/project=all/);
  await expect(page.getByLabel("Sizes")).toHaveCount(0);
});
