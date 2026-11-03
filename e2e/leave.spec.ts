import { test, type Locator } from "@playwright/test";
import { expect, login, seed } from "./support/seed";

/** Fills the dates and waits until the form has taken them (its live day count updates); refills if it hydrated late. */
async function fillDates(form: Locator, start: string, end: string, days: number) {
  await expect(async () => {
    await form.getByLabel("First day").fill(start);
    await form.getByLabel("Last day").fill(end);
    await expect(form.getByText(`${days} calendar day${days === 1 ? "" : "s"}`)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Leave (questionnaire Q4–Q18) through the real screens. */

test("a manager requests medical leave; a Super Admin (not an Admin) approves it @mobile", async ({ browser }) => {
  // A short window this year that no other test uses (end of the year minus a few days).
  const year = seed().today.slice(0, 4);
  const start = `${year}-12-${String(20 + (test.info().project.name === "mobile" ? 4 : 0)).padStart(2, "0")}`;
  const end = `${year}-12-${String(21 + (test.info().project.name === "mobile" ? 4 : 0)).padStart(2, "0")}`;

  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager");
  await mgr.goto("/dashboard/workspace");
  const form = mgr.getByRole("form", { name: "Request leave" });
  await fillDates(form, start, end, 2);
  await form.getByLabel("Leave type").selectOption("medical");
  await form.getByRole("button", { name: "Request leave" }).click();
  await expect(form.getByRole("status")).toHaveText("Leave requested: 2 days.");
  const list = mgr.getByRole("list", { name: "My leave requests" });
  await expect(list.getByText("Medical (CPL)").first()).toBeVisible();
  await expect(list.getByText("Pending").first()).toBeVisible();

  // An Admin can't approve a manager's leave (Q7: Super Admin).
  const adminCtx = await browser.newContext();
  const adm = await adminCtx.newPage();
  await login(adm, "admin");
  await adm.goto("/dashboard/hr/leave");
  await expect(adm.getByRole("list", { name: "Leave waiting for your decision" }).getByRole("button", { name: `Approve ${seed().users.manager.name}` })).toHaveCount(0);
  await adminCtx.close();

  const saCtx = await browser.newContext();
  const sa = await saCtx.newPage();
  await login(sa, "superAdmin");
  await sa.goto("/dashboard/hr/leave");
  const waiting = sa.getByRole("list", { name: "Leave waiting for your decision" });
  const item = waiting.getByRole("listitem").filter({ hasText: seed().users.manager.name }).filter({ hasText: start.slice(0, 4) }).filter({ hasText: "2 days" });
  await item.getByRole("button", { name: `Approve ${seed().users.manager.name}` }).first().click();
  // Decided: the request leaves the queue and shows as Approved in the full list.
  await expect(item).toHaveCount(0);
  await saCtx.close();

  await mgr.reload();
  await expect(mgr.getByRole("list", { name: "My leave requests" }).getByText("Approved").first()).toBeVisible();
  await mgrCtx.close();
});

test("a request over the remaining balance is refused with the remaining days", async ({ page }) => {
  await login(page, "agent2");
  await page.goto("/dashboard/workspace");
  const year = seed().today.slice(0, 4);
  const form = page.getByRole("form", { name: "Request leave" });
  await fillDates(form, `${year}-01-01`, `${year}-03-31`, Number(year) % 4 === 0 ? 91 : 90);
  await form.getByRole("button", { name: "Request leave" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /remain for/ })).toBeVisible();
});

test("only approvers, HR and admins open HR → Leave; agents are refused", async ({ page }) => {
  await login(page, "agent1");
  await page.goto("/dashboard/hr/leave");
  await expect(page.getByText("Access denied").first()).toBeVisible();
});

test("HR sees everyone's leave balances for the year", async ({ page }) => {
  await login(page, "hr");
  await page.goto("/dashboard/hr/leave");
  const table = page.getByRole("table", { name: "Leave balances" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: seed().users.agent1.name })).toBeVisible();
});
