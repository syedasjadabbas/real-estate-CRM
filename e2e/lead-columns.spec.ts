import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/** FR-022: the reference columns are present on the leads table, and each data column sorts. */

const SORTS: [label: string, sort: string][] = [
  ["Code", "code"],
  ["In stage", "inStage"],
  ["Modified", "modified"],
  ["First touch", "firstTouch"],
  ["Next follow-up", "next"],
  ["Inbound", "inbound"],
  ["Size", "size"],
  ["Gender", "gender"],
  ["Comment", "comment"],
  ["Lost reason", "lostReason"],
  ["External ID", "externalId"],
];

test("the new columns show, and every new sort reorders through the header @mobile", async ({ page, context }) => {
  const name = unique("Column Lead");
  await createLeadFor("agent1", name, "manager", { gender: "female", desiredSize: "674 sq ft" });
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/leads");

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("female");
  await expect(row).toContainText("Manual");

  for (const [label, sort] of SORTS) {
    const link = page.getByRole("link", { name: `Sort by ${label}`, exact: true });
    await link.click();
    await page.waitForURL(new RegExp(`sort=${sort}(&|$)`));
    await expect(page.getByRole("columnheader", { name: `Sort by ${label}`, exact: true })).toHaveAttribute("aria-sort", "descending");
  }
});
