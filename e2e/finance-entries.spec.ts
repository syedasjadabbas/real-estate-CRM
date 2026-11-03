import { test } from "@playwright/test";
import { api, expect, login, unique } from "./support/seed";

/** FR-200 / FR-201 income and expenses through the real screens. */

const pdf = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");

test("a Super Admin adds a category; the accountant records an expense, attaches a receipt and voids it", async ({ browser }) => {
  const category = unique("E2E Rent");

  const saCtx = await browser.newContext();
  const sa = await saCtx.newPage();
  await login(sa, "superAdmin");
  await sa.goto("/dashboard/finance/settings");
  await expect(async () => {
    await sa.getByLabel("Kind", { exact: true }).selectOption("expense");
    await sa.getByLabel("New category").fill(category);
    await expect(sa.getByRole("button", { name: "Add", exact: true }).last()).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  // The categories panel's Add button is the last one on the page.
  await sa.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(sa.getByRole("list", { name: "Expense categories" }).getByText(category)).toBeVisible();
  await saCtx.close();

  const accCtx = await browser.newContext();
  const acc = await accCtx.newPage();
  await login(acc, "accountant");
  await acc.goto("/dashboard/finance/entries");
  const form = acc.getByRole("form", { name: "New income or expense" });
  await expect(async () => {
    await form.getByLabel("Kind").selectOption("expense");
    await form.getByLabel("Category").selectOption({ label: category });
    await expect(form.getByLabel("Payee")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await form.getByLabel("Amount (PKR)").fill("150000");
  await form.getByLabel("Payee").fill("Landlord");
  await form.getByRole("button", { name: "Record entry" }).click();
  await acc.waitForURL(/\/dashboard\/finance\/entries\/[0-9a-f-]{36}$/);
  await expect(acc.getByRole("heading", { name: /Expense · PKR\s*150,000/ })).toBeVisible();
  const entryUrl = acc.url();

  const field = acc.getByLabel("Attach a receipt or document");
  const attach = acc.getByRole("button", { name: "Attach file" });
  await expect(async () => {
    await field.setInputFiles({ name: "rent.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(attach).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await attach.click();
  await expect(acc.getByRole("link", { name: "Download rent.pdf" })).toBeVisible();
  const href = (await acc.getByRole("link", { name: "Download rent.pdf" }).getAttribute("href"))!;

  // Admin views (no edit); managers and agents are refused the file.
  for (const [role, status] of [["admin", 200], ["manager", 403], ["agent1", 403]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    expect((await page.request.get(href)).status(), role).toBe(status);
    if (role === "admin") {
      await page.goto(entryUrl);
      await expect(page.getByRole("form", { name: "Edit entry" })).toHaveCount(0);
      expect((await api(page, `${entryUrl.replace(/.*\/entries\//, "/api/v1/finance/entries/")}/void`, { method: "POST", data: { reason: "Not allowed" } })).status).toBe(403);
    }
    await ctx.close();
  }

  await acc.getByLabel("Reason for voiding").fill("Entered twice");
  await acc.getByRole("button", { name: "Void entry" }).click();
  // The page refreshes into its voided state: the note appears and editing is gone.
  await expect(acc.getByRole("note").filter({ hasText: "Entered twice" })).toBeVisible();
  await expect(acc.getByRole("form", { name: "Edit entry" })).toHaveCount(0);
  await accCtx.close();
});
