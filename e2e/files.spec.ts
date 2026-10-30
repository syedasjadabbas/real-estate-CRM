import { readFile } from "node:fs/promises";
import { test, type Page } from "@playwright/test";
import { auditCount, createLeadFor } from "./support/data";
import { api, expect, login, unique } from "./support/seed";

/**
 * Call recordings (FR-038) and lead documents: upload through the lead page, authorised playback /
 * download, and refusal for users who may not see the lead. Files are synthetic and land in the
 * temporary e2e storage folder, which global setup and teardown remove.
 */

/** One second of 8 kHz mono silence: a real WAV the browser can play. */
function silentWav() {
  const samples = 8000;
  const b = Buffer.alloc(44 + samples);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples, 40);
  b.fill(0x80, 44);
  return b;
}

const tinyPdf = () => Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");

/**
 * Chooses a file and waits until the panel has accepted it (its upload button turns enabled).
 * Choosing again covers a panel that streamed in but had not hydrated when the file was set.
 */
async function chooseFile(page: Page, field: string, button: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const upload = page.getByRole("button", { name: button, exact: true });
  await expect(async () => {
    await page.getByLabel(field).setInputFiles(file);
    await expect(upload).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  return upload;
}

async function idFromLink(href: string | null, prefix: string) {
  expect(href).toMatch(new RegExp(`^${prefix}[0-9a-f-]{36}`));
  return href!.slice(prefix.length, prefix.length + 36);
}

test("an agent uploads a call recording; it plays for permitted users only", async ({ browser }) => {
  const name = unique("E2E Recording");
  const leadId = await createLeadFor("agent1", name);
  const fileName = `call-${Date.now()}.wav`;

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/leads/${leadId}`);
  await expect(agent.getByText("No call recordings yet.")).toBeVisible();
  await (await chooseFile(agent, "Upload a recording", "Upload recording", { name: fileName, mimeType: "audio/wav", buffer: silentWav() })).click();
  await expect(agent.getByRole("status").filter({ hasText: "Recording uploaded." })).toBeVisible();
  const player = agent.getByLabel(`Play ${fileName}`);
  await expect(player).toBeVisible();
  const recordingId = await idFromLink(await player.getAttribute("src"), "/api/v1/recordings/");
  expect(await auditCount("lead.recording_upload", leadId)).toBe(1);

  // Playback: the page's audio element loads the file (one second long), and byte ranges work for seeking.
  const seconds = await player.evaluate(
    (el: HTMLAudioElement) =>
      new Promise<number>((resolve) => {
        el.onloadedmetadata = () => resolve(Math.round(el.duration));
        el.onerror = () => resolve(-1);
        el.load();
      }),
  );
  expect(seconds).toBe(1);
  const ranged = await agent.request.get(`/api/v1/recordings/${recordingId}`, { headers: { Range: "bytes=0-43" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toBe(`bytes 0-43/${silentWav().length}`);
  expect(ranged.headers()["cache-control"]).toContain("no-store");
  expect((await ranged.body()).subarray(0, 4).toString()).toBe("RIFF");
  await agentCtx.close();

  // The team manager may play it; another agent, HR and the accountant may not.
  for (const [role, status] of [["manager", 200], ["agent2", 404], ["hr", 403], ["accountant", 403]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    expect((await page.request.get(`/api/v1/recordings/${recordingId}`)).status(), role).toBe(status);
    if (role === "agent2") expect((await api(page, `/api/v1/leads/${leadId}/recordings`, { method: "POST", multipart: { file: { name: "x.wav", mimeType: "audio/wav", buffer: silentWav() } } })).status).toBe(404);
    await ctx.close();
  }
});

test("a recording with the wrong content is refused before it is stored", async ({ page }) => {
  const leadId = await createLeadFor("agent1", unique("E2E Bad Recording"));
  await login(page, "agent1");
  await page.goto(`/dashboard/leads/${leadId}`);
  await (await chooseFile(page, "Upload a recording", "Upload recording", { name: "fake.wav", mimeType: "audio/wav", buffer: Buffer.from("this is not audio at all, just text padding".repeat(4)) })).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByText("No call recordings yet.")).toBeVisible();
});

test("an agent uploads a document; permitted users download it, others are refused", async ({ browser }) => {
  const leadId = await createLeadFor("agent1", unique("E2E Document"));
  const fileName = `cnic-copy-${Date.now()}.pdf`;
  const pdf = tinyPdf();

  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/leads/${leadId}`);
  await (await chooseFile(agent, "Upload a document", "Upload document", { name: fileName, mimeType: "application/pdf", buffer: pdf })).click();
  await expect(agent.getByRole("status").filter({ hasText: "Document uploaded." })).toBeVisible();
  const link = agent.getByRole("link", { name: `Download ${fileName}` });
  await expect(link).toBeVisible();
  const documentId = await idFromLink(await link.getAttribute("href"), "/api/v1/documents/");
  expect(await auditCount("lead.document_upload", leadId)).toBe(1);

  // A real browser download with the original name and identical bytes.
  const [download] = await Promise.all([agent.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe(fileName);
  expect(Buffer.compare(await readFile(await download.path()), pdf)).toBe(0);
  await agentCtx.close();

  for (const [role, status] of [["manager", 200], ["superAdmin", 200], ["agent2", 404], ["hr", 403], ["accountant", 403]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, role);
    const res = await page.request.get(`/api/v1/documents/${documentId}?download=1`);
    expect(res.status(), role).toBe(status);
    if (status === 200) expect(res.headers()["content-disposition"]).toContain("attachment");
    await ctx.close();
  }
});
