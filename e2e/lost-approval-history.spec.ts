import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique } from "./support/seed";

/** FR-021: approving a lost request shows on the lead's timeline as a stage move, like any other. */

test("a manager approves a lost request and the timeline shows the move @mobile", async ({ browser }) => {
  const leadId = await createLeadFor("agent1", unique("Lost Approval"));

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  const requested = await api(agent, `/api/v1/leads/${leadId}/lost-request`, { method: "POST", data: { lostReasonId: seed().lostReasonId, note: "No budget" } });
  expect(requested.status).toBe(200);
  await agentCtx.close();

  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const manager = await ctx.newPage();
  await login(manager, "manager");
  await manager.goto(`/dashboard/leads/${leadId}`);
  await expect(manager.getByText("New Lead → Lost Lead")).toHaveCount(0);
  await manager.getByRole("button", { name: "Approve" }).click();
  await expect(manager.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await expect(manager.getByText("New Lead → Lost Lead")).toBeVisible();
  await expect(manager.getByText("Stage changed to Lost Lead · Not interested")).toBeVisible();
  await expect(manager.getByText("Lost request approved")).toBeVisible();
  await ctx.close();
});

test("a rejected lost request shows no stage move", async ({ browser }) => {
  const leadId = await createLeadFor("agent1", unique("Lost Rejected"));
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await api(agent, `/api/v1/leads/${leadId}/lost-request`, { method: "POST", data: { lostReasonId: seed().lostReasonId } });
  await agentCtx.close();

  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const manager = await ctx.newPage();
  await login(manager, "manager");
  await manager.goto(`/dashboard/leads/${leadId}`);
  await manager.getByRole("button", { name: "Reject" }).click();
  await expect(manager.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(manager.getByText("Lost request rejected")).toBeVisible();
  await expect(manager.getByText("New Lead → Lost Lead")).toHaveCount(0);
  await ctx.close();
});
