import { test, type Page } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { E2E_BASE_URL } from "./support/guard";
import { expect, login, selectTestProject, unique } from "./support/seed";

/**
 * Security headers from next.config.ts (SECURITY_AND_PRIVACY.md §7) on pages, API routes and
 * static assets, and no Content-Security-Policy violations while the app is used.
 */

const EXPECTED = {
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000",
};

function expectSecurityHeaders(headers: Record<string, string>, url: string, { appCsp = true } = {}) {
  for (const [name, value] of Object.entries(EXPECTED)) expect(headers[name], `${url} ${name}`).toBe(value);
  if (!appCsp) return;
  const csp = headers["content-security-policy"] ?? "";
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    expect(csp, `${url} CSP`).toContain(directive);
  }
  // Production build: no eval.
  expect(csp, `${url} CSP`).not.toContain("unsafe-eval");
}

/** Records CSP violations reported in the page (they never throw, so they must be listened for). */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test("pages, API routes and static assets carry the security headers", async ({ page }) => {
  const login = await page.request.get("/login");
  expectSecurityHeaders(login.headers(), "/login");
  // API responses get every header except the app CSP (JSON and files need no script policy).
  const apiHeaders = (await page.request.get("/api/v1/notifications")).headers();
  expectSecurityHeaders(apiHeaders, "/api/v1/notifications", { appCsp: false });
  expect(apiHeaders["content-security-policy"]).toBeUndefined();
  await page.goto("/login");
  const script = await page.locator("script[src]").first().getAttribute("src");
  expectSecurityHeaders((await page.request.get(script!)).headers(), script!);
});

test("file routes keep their own sandbox policy", async ({ page }) => {
  const leadId = await createLeadFor("agent1", unique("E2E CSP File"));
  await login(page, "agent1");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082", "hex");
  const up = await page.request.post(`/api/v1/leads/${leadId}/documents`, { multipart: { file: { name: "dot.png", mimeType: "image/png", buffer: png } } });
  expect(up.status()).toBe(201);
  const { data } = (await up.json()) as { data: { id: string } };
  const res = await page.request.get(`/api/v1/documents/${data.id}`);
  expect(res.status()).toBe(200);
  // The route's own policy survives the config headers: no scripts, sandboxed, images from self only.
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; img-src 'self'; sandbox");
  expectSecurityHeaders(res.headers(), "document", { appCsp: false });
});

test("the app cannot be framed by another page", async ({ page }) => {
  // Another page (here about:blank) that tries to embed the login screen.
  await page.goto("about:blank");
  await page.setContent(`<iframe id="f" src="${E2E_BASE_URL}/login"></iframe>`);
  // The browser refuses to render it: the frame ends on Chrome's error page, never the login form.
  const child = () => page.frames().find((f) => f !== page.mainFrame());
  await expect.poll(() => child()?.url() ?? "").toMatch(/^chrome-error:/);
  await expect(page.frameLocator("#f").getByLabel("Email")).toHaveCount(0);
});

test("the city screen and forms raise no CSP violations @mobile", async ({ page }) => {
  const violations = await watchViolations(page);
  await selectTestProject(page.context());
  await login(page, "superAdmin");
  for (const url of ["/dashboard/settings/cities", "/dashboard/leads/new", "/dashboard/clients/new"]) {
    await page.goto(url);
    await expect(page.getByRole("heading").first()).toBeVisible();
    expect(await violations(), url).toEqual([]);
  }
});

test("signed-in pages and a recording upload raise no CSP violations @mobile", async ({ page }) => {
  const violations = await watchViolations(page);
  const name = unique("E2E CSP");
  const leadId = await createLeadFor("agent1", name);
  await selectTestProject(page.context());
  await login(page, "agent1");
  for (const url of ["/dashboard", "/dashboard/leads", "/dashboard/leads/pipeline", "/dashboard/notifications"]) {
    await page.goto(url);
    await expect(page.getByRole("heading").first()).toBeVisible();
    expect(await violations(), url).toEqual([]);
  }
  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // The recording panel reads a chosen file's duration from a blob: URL; the policy must allow it.
  const blobLoads = await page.evaluate(async () => {
    const samples = 8000;
    const b = new DataView(new ArrayBuffer(44 + samples));
    const text = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    text(0, "RIFF");
    b.setUint32(4, 36 + samples, true);
    text(8, "WAVE");
    text(12, "fmt ");
    b.setUint32(16, 16, true);
    b.setUint16(20, 1, true);
    b.setUint16(22, 1, true);
    b.setUint32(24, 8000, true);
    b.setUint32(28, 8000, true);
    b.setUint16(32, 1, true);
    b.setUint16(34, 8, true);
    text(36, "data");
    b.setUint32(40, samples, true);
    const audio = new Audio();
    const loaded = new Promise<boolean>((resolve) => {
      audio.onloadedmetadata = () => resolve(true);
      audio.onerror = () => resolve(false);
    });
    audio.src = URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
    return loaded;
  });
  expect(blobLoads).toBe(true);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  expect(await violations()).toEqual([]);
});
