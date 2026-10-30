import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, seed, unique, uniquePhone, selectTestProject } from "./support/seed";

/** Lead creation and assignment through the UI, and the resulting notifications (FR-006). */

test("a manager creates a lead for an agent; the agent is notified and can mark it read", async ({ browser }) => {
  const name = unique("E2E Assigned");
  const s = seed();

  // Manager: create the lead with the agent as owner.
  const managerCtx = await browser.newContext();
  await selectTestProject(managerCtx);
  const manager = await managerCtx.newPage();
  await login(manager, "manager");
  await manager.goto("/dashboard/leads/new");
  await manager.getByLabel("Name").fill(name);
  await manager.getByLabel("Mobile number").fill(uniquePhone());
  await manager.getByLabel("Source").selectOption(s.sourceId);
  await manager.getByLabel("Owner").selectOption(s.users.agent1.id);
  await manager.getByRole("button", { name: "Create lead" }).click();
  await manager.waitForURL(/\/dashboard\/leads\/[0-9a-f-]{36}$/);
  const leadId = manager.url().split("/").pop()!;
  await expect(manager.getByRole("heading", { name })).toBeVisible();
  await expect(manager.getByText(`Owner ${s.users.agent1.name}`)).toBeVisible();
  // The manager is never notified about their own action.
  const managerFeed = await api<{ rows: { title: string }[] }>(manager, "/api/v1/notifications");
  expect(managerFeed.data.rows.some((r) => r.title.includes(name))).toBe(false);
  await managerCtx.close();

  // Agent: the bell shows the assignment; opening it goes to the lead and marks it read.
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  const before = (await api<{ unread: number }>(agent, "/api/v1/notifications")).data.unread;
  expect(before).toBeGreaterThan(0);
  const bell = agent.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toHaveAccessibleName(`Notifications, ${before} unread`);
  await bell.click();
  const dropdown = agent.getByRole("dialog", { name: "Notifications" });
  const item = dropdown.getByRole("button", { name: new RegExp(`Lead assigned to you · ${name}`) });
  await expect(item).toBeVisible();
  await item.click();
  await agent.waitForURL(`**/dashboard/leads/${leadId}`);
  await expect(agent.getByRole("button", { name: `Notifications, ${before - 1} unread` })).toBeVisible();

  // Mark all read from the history page empties the unread tab.
  await agent.goto("/dashboard/notifications?unread=1");
  await agent.getByRole("button", { name: "Mark all read" }).click();
  await expect(agent.getByText("No unread notifications.")).toBeVisible();
  await expect(agent.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await agentCtx.close();

  // Privacy: another agent never sees it.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, "agent2");
  const otherFeed = await api<{ rows: { title: string }[] }>(other, "/api/v1/notifications");
  expect(otherFeed.data.rows.some((r) => r.title.includes(name))).toBe(false);
  await otherCtx.close();
});

test("a lost request notifies the manager and a rejection notifies the agent", async ({ browser }) => {
  const name = unique("E2E Lost");
  const leadId = await createLeadFor("agent1", name);

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  const req = await api(agent, `/api/v1/leads/${leadId}/lost-request`, { method: "POST", data: { lostReasonId: seed().lostReasonId, note: "Budget" } });
  expect(req.status).toBe(200);

  const managerCtx = await browser.newContext();
  const manager = await managerCtx.newPage();
  await login(manager, "manager");
  await manager.goto("/dashboard/notifications");
  await expect(manager.getByRole("link", { name: `Lost request · ${name}` })).toBeVisible();
  // Reject from the lead page.
  await manager.getByRole("link", { name: `Lost request · ${name}` }).click();
  await manager.waitForURL(`**/dashboard/leads/${leadId}`);
  await manager.getByLabel("Decision comment").fill("Try one more call");
  await manager.getByRole("button", { name: "Reject" }).click();
  // Decided: the pending request (and its buttons) leave the lead page.
  await expect(manager.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await managerCtx.close();

  await agent.goto("/dashboard/notifications");
  await expect(agent.getByRole("link", { name: `Lost request rejected · ${name}` })).toBeVisible();
  await agentCtx.close();
});

test("follow-up reminders appear as a pop-up once, inside the configured window", async ({ page }) => {
  const name = unique("E2E Reminder");
  const leadId = await createLeadFor("agent1", name);
  await login(page, "agent1");
  const due = new Date(Date.now() + 10 * 60_000).toISOString();
  expect((await api(page, `/api/v1/leads/${leadId}/follow-ups`, { method: "POST", data: { dueAt: due, note: "E2E reminder note" } })).status).toBe(201);
  await page.goto("/dashboard");
  const popup = page.getByRole("alert").filter({ hasText: "Follow-up soon" });
  await expect(popup).toContainText(name);
  await expect(popup).toContainText("E2E reminder note");
  await popup.getByRole("button", { name: "View" }).click();
  await page.waitForURL(`**/dashboard/leads/${leadId}`);
  // Shown once per session: going back does not show it again.
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: name })).toHaveCount(0);
});
