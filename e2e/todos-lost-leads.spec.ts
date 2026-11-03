import { test } from "@playwright/test";
import { createLeadFor, leadStage, scheduleFollowUpFor } from "./support/data";
import { expect, login, selectTestProject, unique } from "./support/seed";

/**
 * F-2: a lead's overdue follow-up is in To-dos → Overdue while the lead is active, leaves it when
 * the lead is marked Lost, and comes back when the lead is moved back to an active stage.
 */

test("an overdue follow-up leaves To-dos when its lead is marked lost and returns when the lead is reopened", async ({ page }) => {
  const name = unique("E2E Todo Lost");
  const leadId = await createLeadFor("agent1", name);
  await scheduleFollowUpFor("agent1", leadId, -30, "Call about the second floor");

  await selectTestProject(page.context());
  await login(page, "manager");
  const overdueList = async () => {
    await page.goto("/dashboard/leads/todos?bucket=overdue");
    await expect(page.getByRole("heading", { name: "Overdue lead follow-ups" })).toBeVisible();
    return page.locator(`a[href="/dashboard/leads/${leadId}"]`).filter({ hasText: name });
  };
  await expect(await overdueList()).toBeVisible();

  // Mark lost from the lead page.
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(async () => {
    await page.getByLabel("Lost reason").selectOption({ index: 1 });
    await expect(page.getByRole("button", { name: "Mark lost" })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Mark lost" }).click();
  await expect.poll(() => leadStage(leadId)).toBe("lost_lead");

  await expect(await overdueList()).toHaveCount(0);
  // The follow-up itself is kept on the lead.
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByText("Call about the second floor").first()).toBeVisible();

  // Moving the lead back to an active stage brings the follow-up back to Overdue.
  await expect(async () => {
    await page.getByLabel("Target stage").selectOption("contacted");
    await expect(page.getByRole("button", { name: "Move", exact: true })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(() => leadStage(leadId)).toBe("contacted");
  await expect(await overdueList()).toBeVisible();
});
