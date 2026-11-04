import { test } from "@playwright/test";
import { auditCount, createLeadFor, leadPhone } from "./support/data";
import { expect, login, selectTestProject, unique, uniquePhone } from "./support/seed";

/** F-3: editing a lead's phone runs the same duplicate check as creating a lead. */

test("editing a lead's phone to another lead's number is refused; a new number is saved @mobile", async ({ page }) => {
  const takenNumber = uniquePhone();
  const original = await createLeadFor("agent1", unique("E2E Phone Owner"), "manager", { phoneNumber: takenNumber });
  const leadId = await createLeadFor("agent1", unique("E2E Phone Edit"));
  const { code: originalCode } = await leadPhone(original);
  const before = await leadPhone(leadId);
  const updatesBefore = await auditCount("lead.update", leadId);

  await selectTestProject(page.context());
  await login(page, "agent1");
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
