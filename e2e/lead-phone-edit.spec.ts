import { test } from "@playwright/test";
import { auditCount, createLeadFor, leadPhone } from "./support/data";
import { expect, login, selectTestProject, unique, uniquePhone } from "./support/seed";

/** F-3: editing a lead's phone runs the same duplicate check as creating a lead. */

test("editing a lead's phone to another lead's number is refused; a new number is saved @mobile", async ({ page, browser }) => {
  const takenNumber = uniquePhone();
  const original = await createLeadFor("agent1", unique("E2E Phone Owner"), "manager", { phoneNumber: takenNumber });
  const leadId = await createLeadFor("agent1", unique("E2E Phone Edit"));
  const { code: originalCode } = await leadPhone(original);
  const before = await leadPhone(leadId);
  const updatesBefore = await auditCount("lead.update", leadId);

  // Agents never change phone numbers (owner, 14 Nov 2026): the lead's owner sees the field locked.
  const agentCtx = await browser.newContext();
  await selectTestProject(agentCtx);
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/leads/${leadId}`);
  const agentForm = agent.getByRole("form", { name: "Lead details" });
  await expect(agentForm.getByLabel("Mobile number")).toBeDisabled();
  await expect(agentForm.getByText("Phone numbers can only be changed by an Admin.")).toBeVisible();
  await agentCtx.close();

  // An Admin (the merged Manager role) edits it.
  await selectTestProject(page.context());
  await login(page, "manager");
  await page.goto(`/dashboard/leads/${leadId}`);
  const form = page.getByRole("form", { name: "Lead details" });
  const mobile = form.getByLabel("Mobile number");
  const save = form.getByRole("button", { name: "Save changes" });

  // The taken number written differently ("+92 3xx…" instead of "03xx…") is still the same number.
  await expect(async () => {
    await mobile.fill(`+92 ${takenNumber.slice(1, 4)} ${takenNumber.slice(4)}`);
    await expect(save).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await save.click();
  await expect(form.getByRole("alert").filter({ hasText: "A lead with this phone number already exists in this project." })).toBeVisible();
  await expect(form.getByText(`Already used by lead ${originalCode}`)).toBeVisible();
  expect(await leadPhone(leadId)).toEqual(before);
  expect(await auditCount("lead.update", leadId)).toBe(updatesBefore);

  // An unused number saves and is stored normalized.
  const fresh = uniquePhone();
  await mobile.fill(fresh);
  await save.click();
  await expect(form.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  await expect.poll(async () => (await leadPhone(leadId)).phoneE164).toBe(`+92${fresh.replace(/^0+/, "")}`);
  expect(await auditCount("lead.update", leadId)).toBe(updatesBefore + 1);
});
