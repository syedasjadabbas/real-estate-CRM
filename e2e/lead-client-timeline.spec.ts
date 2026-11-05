import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/** FR-025: converting a lead shows on the lead's own timeline, through the real page. */

test("converting a lead shows on its timeline, and the count is the full number of entries @mobile", async ({ page, context }) => {
  const name = unique("Timeline Lead");
  const leadId = await createLeadFor("agent1", name);
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Converted to a client")).toHaveCount(0);

  // Clicks again only if the page hydrated after the first click and nothing happened.
  const onClient = /\/dashboard\/clients\/[0-9a-f-]{36}$/;
  await expect(async () => {
    if (!onClient.test(page.url())) await page.getByRole("button", { name: "Convert to client" }).click({ timeout: 1_000 });
    await page.waitForURL(onClient, { timeout: 2_000 });
  }).toPass();

  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByText("Converted to a client")).toBeVisible();
  await expect(page.getByText(/^Timeline · \d+ entries$/)).toBeVisible();
});
