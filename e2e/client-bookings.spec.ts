import { test } from "@playwright/test";
import { cancelBookingFor, convertLeadFor, createAvailableUnit, createBookingFor, createLeadFor, payTokenFor } from "./support/data";
import { expect, login, unique } from "./support/seed";

/** F-13: an existing client's open bookings and payments show on the client page, within each person's access. */

test("an existing client's open booking and token show on the client page; a cancelled booking leaves it @mobile", async ({ browser }) => {
  const name = unique("Repeat Buyer");
  const unitNo = unique("CB");
  const leadId = await createLeadFor("agent1", name);
  const clientId = await convertLeadFor(leadId);
  const bookingId = await createBookingFor(leadId, await createAvailableUnit(unitNo));
  await payTokenFor(bookingId, "75000");
  const dropped = unique("CX");
  const droppedBooking = await createBookingFor(leadId, await createAvailableUnit(dropped));

  // The manager sees both open bookings and the itemised token.
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager");
  await mgr.goto(`/dashboard/clients/${clientId}`);
  const open = mgr.getByRole("link", { name: `Unit ${unitNo} · ${name}` });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", `/dashboard/bookings/${bookingId}`);
  await expect(mgr.getByRole("link", { name: `Unit ${dropped} · ${name}` })).toBeVisible();
  await expect(mgr.getByText("Payment history · 1")).toBeVisible();
  await expect(mgr.getByText(`Unit ${unitNo}`, { exact: false }).last()).toBeVisible();
  await expect(mgr.getByText("75,000").first()).toBeVisible();

  // Cancelling leaves the client page; the paid booking stays.
  await cancelBookingFor(droppedBooking);
  await mgr.reload();
  await expect(open).toBeVisible();
  await expect(mgr.getByRole("link", { name: `Unit ${dropped} · ${name}` })).toHaveCount(0);

  // The clients list shows it as the latest investment.
  await mgr.goto(`/dashboard/clients?q=${encodeURIComponent(name)}`);
  await expect(mgr.getByRole("link", { name: new RegExp(unitNo) })).toBeVisible();
  await mgrCtx.close();

  // The owning agent sees the booking, but not itemised payments.
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await login(agent, "agent1");
  await agent.goto(`/dashboard/clients/${clientId}`);
  await expect(agent.getByRole("link", { name: `Unit ${unitNo} · ${name}` })).toBeVisible();
  await expect(agent.getByText(/^Payment history/)).toHaveCount(0);
  await agentCtx.close();
});

test("another agent can't open the client or its booking", async ({ page }) => {
  const name = unique("Private Buyer");
  const leadId = await createLeadFor("agent1", name);
  const clientId = await convertLeadFor(leadId);
  const bookingId = await createBookingFor(leadId, await createAvailableUnit(unique("CP")));
  await login(page, "agent2");
  for (const url of [`/dashboard/clients/${clientId}`, `/dashboard/bookings/${bookingId}`]) {
    await page.goto(url);
    await expect(page.getByText("This page could not be found")).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  }
});
