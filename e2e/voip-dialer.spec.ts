import { test } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, selectTestProject, unique } from "./support/seed";

/** VoIP foundation (docs/VOIP_INTEGRATION.md): with no provider configured the lead page says so and offers the phone dialer. */

test("with no calling provider, the lead page says browser calling isn't set up and offers the phone dialer @mobile", async ({ page }) => {
  const leadId = await createLeadFor("agent1", unique("E2E VoIP Dialer"));

  await selectTestProject(page.context());
  await login(page, "agent1");
  await page.goto(`/dashboard/leads/${leadId}`);

  const dialer = page.getByRole("region", { name: "Browser calling" });
  await expect(dialer).toBeVisible();
  await expect(dialer.getByRole("status")).toContainText("Browser calling isn't set up yet.");
  const phoneCall = dialer.getByRole("link", { name: /with your phone$/ });
  await expect(phoneCall).toHaveAttribute("href", /^tel:\+92\d+$/);
  // Nothing pretends a call can be placed in the browser.
  await expect(dialer.locator("[data-voip-mount]")).toHaveCount(0);
  await expect(dialer.getByRole("button")).toHaveCount(0);

  // The status API reports the same, and never more than the provider name.
  const r = await api<Record<string, unknown>>(page, "/api/v1/voip/status");
  expect(r.status).toBe(200);
  expect(r.data).toEqual({ configured: false, reason: "not_selected", provider: null, providerName: null });
});

test("roles without lead access can't read the calling status", async ({ page }) => {
  await login(page, "hr");
  const r = await api(page, "/api/v1/voip/status");
  expect(r.status).toBe(403);
});
