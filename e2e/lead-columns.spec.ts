import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/** FR-022: the reference columns are present on the leads table, and each data column sorts. */

const SORTS: [label: string, sort: string][] = [
  ["Time in stage", "inStage"],
  ["Last contact", "lastContact"],
  ["Agent", "owner"],
  ["Modified", "modified"],
  ["First touch", "firstTouch"],
  ["Next follow-up", "next"],
  ["Inbound", "inbound"],
  ["Size", "size"],
  ["Comment", "comment"],
  ["Lost reason", "lostReason"],
  ["External ID", "externalId"],
];

test("the new columns show, and every new sort reorders through the header @mobile", async ({ page, context }) => {
  const name = unique("Column Lead");
  await createLeadFor("agent1", name, "manager", { gender: "female", desiredSize: "674 sq ft" });
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/leads?columns=all");

  const row = page.getByRole("row").filter({ hasText: name });
  // Gender is on the lead page only (client, 23 Nov 2026).
  await expect(page.getByRole("columnheader", { name: "Gender" })).toHaveCount(0);
  await expect(row).toContainText("Not contacted yet");
  await expect(row).toContainText("Manual");

  for (const [label, sort] of SORTS) {
    const link = page.getByRole("link", { name: `Sort by ${label}`, exact: true });
    await link.click();
    await page.waitForURL(new RegExp(`sort=${sort}(&|$)`));
    await expect(page.getByRole("columnheader", { name: `Sort by ${label}`, exact: true })).toHaveAttribute("aria-sort", "descending");
  }
});
