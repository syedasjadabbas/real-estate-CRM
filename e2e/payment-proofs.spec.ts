import { test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seededPaymentId } from "./support/data";
import { api, expect, login } from "./support/seed";

/** Q33 payment proofs on the payment page: attach, preview, download, and access by role. */

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082", "hex");

test("the accountant attaches a cash photo; finance and the team manager can open it; agents can't", async ({ browser }) => {
  const paymentId = await seededPaymentId();
  const name = `cash-${Date.now()}.png`;

  const accCtx = await browser.newContext();
  const acc = await accCtx.newPage();
  await login(acc, "accountant");
  await acc.goto(`/dashboard/finance/payments/${paymentId}`);
  const field = acc.getByLabel("Attach a receipt or photo");
  const button = acc.getByRole("button", { name: "Attach proof" });
  // Retry the choice until the panel has hydrated and accepted the file.
  await expect(async () => {
    await field.setInputFiles({ name, mimeType: "image/png", buffer: png });
    await expect(button).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await button.click();
  await expect(acc.getByRole("status").filter({ hasText: "Proof attached." })).toBeVisible();
  await expect(acc.getByText("Payment proof attached")).toBeVisible();

  const open = acc.getByRole("link", { name: `Open ${name}` });
  const href = (await open.getAttribute("href"))!;
  const preview = await acc.request.get(href);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("image/png");
  expect(preview.headers()["content-disposition"]).toMatch(/^inline/);
  const [download] = await Promise.all([acc.waitForEvent("download"), acc.getByRole("link", { name: `Download ${name}` }).click()]);
  expect(Buffer.compare(await readFile(await download.path()), png)).toBe(0);
  await accCtx.close();

  for (const [role, status] of [["admin", 200], ["manager", 200], ["agent1", 403], ["hr", 403]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    expect((await page.request.get(href)).status(), role).toBe(status);
    if (role === "admin") {
      expect((await api(page, `/api/v1/finance/payments/${paymentId}/proofs`, { method: "POST", multipart: { file: { name: "x.png", mimeType: "image/png", buffer: png } } })).status).toBe(403);
      await page.goto(`/dashboard/finance/payments/${paymentId}`);
      await expect(page.getByRole("link", { name: `Open ${name}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Attach proof" })).toHaveCount(0);
    }
    await ctx.close();
  }
});
