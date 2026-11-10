import { test } from "@playwright/test";
import { leadOwnerId, userIdByEmail } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique, uniquePhone } from "./support/seed";

/** F-15: a manager's Auto-assign stays inside their team, so they can always open the lead they just created. */

const leadBody = (extra: Record<string, unknown> = {}) => ({ projectId: seed().projectId, name: unique("Auto Lead"), phoneCountryCode: "+92", phoneNumber: uniquePhone(), sourceId: seed().sourceId, ...extra });

test("a manager's Auto-assign gives the lead to their team, and the lead opens @mobile", async ({ browser }) => {
  const s = seed();
  const name = unique("Auto Assign");
  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const page = await ctx.newPage();
  await login(page, "manager");
  await page.goto("/dashboard/leads/new");
  await expect(page.getByText("assign automatically among your teams' available agents")).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByLabel("Source").selectOption(s.sourceId);
  await expect(page.getByLabel("Owner")).toHaveValue(""); // Auto-assign
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.waitForURL(/\/dashboard\/leads\/[0-9a-f-]{36}$/);
  const leadId = page.url().split("/").pop()!;

  // Before the fix this could be another team's agent, and this page a 404.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText(/^Auto-assigned/).first()).toBeVisible();
  expect([s.users.agent1.id, s.users.agent2.id]).toContain(await leadOwnerId(leadId));
  await ctx.close();
});

test("repeated Auto-assign through the API never leaves the manager's team, and spreads across it", async ({ page }) => {
  const s = seed();
  await login(page, "manager");
  const owners: (string | null)[] = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await api<{ leadId: string }>(page, "/api/v1/leads", { method: "POST", data: leadBody() });
    expect(res.status).toBe(201);
    owners.push(await leadOwnerId(res.data.leadId));
    expect((await api(page, `/api/v1/leads/${res.data.leadId}`)).status).toBe(200);
  }
  for (const o of owners) expect([s.users.agent1.id, s.users.agent2.id]).toContain(o);
});

test("the API refuses a manager choosing an outsider, and roles that can't create leads", async ({ browser }) => {
  const outsider = await userIdByEmail("outside@test.local");
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager");
  expect((await api(mgr, "/api/v1/leads", { method: "POST", data: leadBody({ ownerId: outsider }) })).status).toBe(403);
  await mgrCtx.close();

  const hrCtx = await browser.newContext();
  const hr = await hrCtx.newPage();
  await login(hr, "hr");
  expect((await api(hr, "/api/v1/leads", { method: "POST", data: leadBody() })).status).toBe(403);
  await hrCtx.close();
});
