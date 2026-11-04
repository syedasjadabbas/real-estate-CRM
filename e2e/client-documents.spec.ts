import { readFile } from "node:fs/promises";
import { test, type Page } from "@playwright/test";
import { auditCount, convertLeadFor, createLeadFor } from "./support/data";
import { api, expect, login, unique } from "./support/seed";

/** F-20 (FR-052): a contract kept on the client, through the real page, with each role's access. */

const tinyPdf = () => Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
const FIELD = "Upload a contract or document";

/** Chooses a file and waits until the panel has accepted it; choosing again covers a late hydration. */
async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const upload = page.getByRole("button", { name: "Upload document", exact: true });
  await expect(async () => {
    await page.getByLabel(FIELD).setInputFiles(file);
    await expect(upload).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  return upload;
}

test("the owner keeps a contract on the client; permitted users open it, others are refused @mobile", async ({ browser }) => {
  const name = unique("Contract Buyer");
  const leadId = await createLeadFor("agent1", name);
  const clientId = await convertLeadFor(leadId);
  const fileName = `sale-contract-${Date.now()}.pdf`;
  const pdf = tinyPdf();

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/clients/${clientId}`);
  await expect(agent.getByText("No contracts or documents yet.")).toBeVisible();
  await (await chooseFile(agent, { name: fileName, mimeType: "application/pdf", buffer: pdf })).click();
  await expect(agent.getByRole("status").filter({ hasText: "Document uploaded." })).toBeVisible();
  const link = agent.getByRole("link", { name: `Download ${fileName}` });
  await expect(link).toBeVisible();
  await expect(agent.getByText("Document uploaded", { exact: true })).toBeVisible(); // timeline
  expect(await auditCount("client.document_upload", clientId)).toBe(1);

  const href = (await link.getAttribute("href"))!;
  const [download] = await Promise.all([agent.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe(fileName);
  expect(Buffer.compare(await readFile(await download.path()), pdf)).toBe(0);
  await agentCtx.close();

  for (const [role, status] of [["manager", 200], ["superAdmin", 200], ["accountant", 200], ["agent2", 404], ["hr", 403]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    expect((await page.request.get(href)).status(), role).toBe(status);
    await ctx.close();
  }
});

test("an accountant reads the client's documents but has no upload; a wrong file is refused", async ({ browser }) => {
  const leadId = await createLeadFor("agent1", unique("Doc Rules"));
  const clientId = await convertLeadFor(leadId);

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/clients/${clientId}`);
  await (await chooseFile(agent, { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf, just text in a file") })).click();
  await expect(agent.getByRole("alert").filter({ hasText: "does not match its type" })).toBeVisible();
  await expect(agent.getByText("No contracts or documents yet.")).toBeVisible();
  await agentCtx.close();

  const accCtx = await browser.newContext();
  const acc = await accCtx.newPage();
  await login(acc, "accountant");
  await acc.goto(`/dashboard/clients/${clientId}`);
  await expect(acc.getByText("Contracts and documents · 0")).toBeVisible();
  await expect(acc.getByLabel(FIELD)).toHaveCount(0);
  const res = await api(acc, `/api/v1/clients/${clientId}/documents`, { method: "POST", multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: tinyPdf() } } });
  expect(res.status).toBe(403);
  await accCtx.close();
});
