import { test } from "@playwright/test";
import { convertLeadFor, createLeadFor } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/**
 * FR-025: a lead's client shows on the lead's own timeline, through the real page. Since 13 Nov 2026
 * every lead belongs to its person's client from the moment it is created ("Convert to client" is gone),
 * so the timeline records the client profile being created with the lead.
 */

test("a new lead's client profile shows on its timeline and links to the client, and the count is the full number of entries @mobile", async ({ page, context }) => {
  const name = unique("Timeline Lead");
  const leadId = await createLeadFor("agent1", name);
  // Converting now only returns the lead's existing client (kept for API callers).
  const clientId = await convertLeadFor(leadId);
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert to client" })).toHaveCount(0);

  await expect(page.getByText("Client profile created")).toBeVisible();
  await expect(page.getByText(/^Timeline · \d+ entries$/)).toBeVisible();

  const clientLink = page.getByRole("link", { name }).and(page.locator(`[href="/dashboard/clients/${clientId}"]`));
  await expect(clientLink).toBeVisible();
  await clientLink.click();
  await page.waitForURL(`**/dashboard/clients/${clientId}`);
});
