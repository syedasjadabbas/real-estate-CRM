import { test, type Page } from "@playwright/test";
import { createLeadFor, makeUnassigned, ownerOf } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique, uniquePhone } from "./support/seed";

/** Sprint: extra phone numbers, returning customers, claims, import batches, assignment settings, scores, won / lost ranges. */

async function fillLead(page: Page, name: string, phone: string) {
  await page.goto("/dashboard/leads/new");
  await expect(async () => {
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Mobile number").fill(phone);
    await page.getByLabel("Source").selectOption(seed().sourceId);
    await expect(page.getByLabel("Name")).toHaveValue(name, { timeout: 1_000 });
  }).toPass();
}

test("a lead takes extra numbers, and a returning customer goes to their original agent @mobile", async ({ browser, page, context }) => {
  await selectTestProject(context);
  await login(page, "agent1");
  const name = unique("Five Phones");
  const second = uniquePhone();
  await fillLead(page, name, uniquePhone());
  await page.getByLabel("Phone 2", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Enter a valid phone number").first()).toBeVisible();
  await page.getByLabel("Phone 2", { exact: true }).fill(second);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.waitForURL(/\/dashboard\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("form", { name: "Lead details" }).getByLabel("Phone 2", { exact: true })).not.toHaveValue("");

  // Another agent records the same customer, reached on the second number, in the other project.
  const other = await browser.newContext();
  await selectTestProject(other);
  const agent2 = await other.newPage();
  await login(agent2, "agent2");
  await agent2.goto("/dashboard");
  const res = await api<{ leadId: string; visible: boolean; ownerName: string }>(agent2, "/api/v1/leads", {
    method: "POST",
    data: { projectId: seed().otherProjectId, name: unique("Returning"), phoneCountryCode: "+92", phoneNumber: second, sourceId: seed().sourceId },
  });
  expect(res.status).toBe(201);
  expect(res.data.visible).toBe(false);
  expect(await ownerOf(res.data.leadId)).toBe(seed().users.agent1.id);
  await other.close();
});

test("an unassigned lead is claimed from the pool, and a second claim is refused", async ({ browser, page, context }) => {
  const name = unique("Pool Lead");
  const leadId = await createLeadFor("agent1", name);
  await makeUnassigned(leadId);
  await selectTestProject(context);
  await login(page, "agent2");
  await page.goto("/dashboard/leads/unassigned");
  const claim = page.getByRole("button", { name: `Claim ${name}` });
  await expect(claim).toBeVisible();
  await expect(page.getByText(/\+92/)).toHaveCount(0); // no phone numbers in the pool
  await claim.click();
  await page.waitForURL(new RegExp(`/dashboard/leads/${leadId}`));
  expect(await ownerOf(leadId)).toBe(seed().users.agent2.id);

  const ctx = await browser.newContext();
  const agent1 = await ctx.newPage();
  await login(agent1, "agent1");
  expect((await api(agent1, `/api/v1/leads/${leadId}/claim`, { method: "POST" })).status).toBe(409);
  await ctx.close();
});

test("a batch is submitted, stays pending, and only the Super Admin approves it @mobile", async ({ browser, page, context }) => {
  const a = unique("Imp A").replace(/\s+/g, " ");
  const csv = ["name,phone,source,priority", `${a},${uniquePhone()},Facebook,high`, `Bad Row,12,Facebook,`].join("\n");
  await selectTestProject(context);
  await login(page, "agent1");
  await page.goto("/dashboard/leads/import");
  const submit = page.getByRole("button", { name: "Submit for approval" });
  // Re-attach if the page hydrated after the first attempt (the button enables once React has the file).
  await expect(async () => {
    await page.getByLabel("CSV file").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(submit).toBeEnabled({ timeout: 2_000 });
  }).toPass();
  await submit.click();
  await page.waitForURL(/\/dashboard\/leads\/import\/[0-9a-f-]{36}$/);
  const batchUrl = page.url();
  await expect(page.getByText("Waiting for a Super Admin to approve. No leads have been created.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve batch" })).toHaveCount(0);
  expect((await api(page, `/api/v1/lead-imports/${batchUrl.split("/").pop()}/decision`, { method: "POST", data: { approve: true } })).status).toBe(403);

  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const sa = await ctx.newPage();
  await login(sa, "superAdmin");
  await sa.goto(batchUrl);
  // The confirmation is replaced by the batch's decided line once the page refreshes, so wait for
  // either. Click again only while the button is still there (a click before hydration does nothing).
  const approve = sa.getByRole("button", { name: "Approve batch" });
  await expect(async () => {
    if (await approve.isVisible()) await approve.click();
    await expect(sa.getByText(/Approved: 1 lead created|· 1 lead created/)).toBeVisible({ timeout: 3_000 });
  }).toPass();
  await sa.reload();
  await expect(sa.getByRole("link", { name: "Open lead" })).toHaveCount(1);
  await ctx.close();
});

test("admins tune assignment; My Teams shows each agent's score; won and lost have date ranges", async ({ page, context }) => {
  await selectTestProject(context);
  await login(page, "admin");
  await page.goto("/dashboard/settings/assignment");
  const workload = page.getByLabel("Workload and capacity %");
  await expect(workload).toHaveValue("40");
  await expect(async () => {
    await workload.fill("50");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("The four weights must add up to 100").first()).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await workload.fill("40");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Assignment settings saved.")).toBeVisible();

  await page.goto("/dashboard/teams");
  await page.getByRole("link", { name: "Team 1" }).first().click();
  await expect(page.getByRole("table", { name: "Agent scores" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Agent scores" })).toContainText("Agent A");

  await page.goto("/dashboard/leads/won");
  await page.getByRole("link", { name: "This quarter" }).click();
  await page.waitForURL(/period=quarter/);
  await expect(page.getByRole("link", { name: "This quarter" })).toHaveAttribute("aria-current", "page");
  await page.goto("/dashboard/leads/lost");
  await expect(page.getByRole("link", { name: "This month" })).toBeVisible();
});

test("the New lead page links to the CSV import", async ({ page, context }) => {
  await selectTestProject(context);
  await login(page, "agent1");
  await page.goto("/dashboard/leads/new");
  await page.getByRole("link", { name: "Import from CSV" }).click();
  await page.waitForURL(/\/dashboard\/leads\/import$/);
  await expect(page.getByRole("button", { name: "Submit for approval" })).toBeVisible();
});
