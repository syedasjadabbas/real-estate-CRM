import { test } from "@playwright/test";
import { createAvailableUnit, createTeamWithAgent } from "./support/data";
import { expect, login, seed, selectTestProject, unique } from "./support/seed";

/** Screens added from the client questionnaire: Q1 (records without login), Q9 (team weekends), Q43 (due dates). */

test("HR adds an employee without a CRM login, finds them in the directory and edits them @mobile", async ({ page }) => {
  const name = unique("E2E Driver");
  await login(page, "hr");
  await page.goto("/dashboard/hr/employees");
  await page.getByRole("link", { name: "Add employee (no login)" }).click();
  await page.waitForURL("**/dashboard/hr/employees/new-record");
  const form = page.getByRole("form", { name: "HR profile" });
  await form.getByLabel("Full name").fill(name);
  await form.getByLabel("Department").fill("Logistics");
  await form.getByRole("button", { name: "Add employee" }).click();
  await page.waitForURL(/\/dashboard\/hr\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("No CRM login.", { exact: false })).toBeVisible();
  // No account controls for a record without a login.
  await expect(page.getByRole("button", { name: "Deactivate account" })).toHaveCount(0);

  await page.getByRole("form", { name: "HR profile" }).getByLabel("Employment status").selectOption("inactive");
  await page.getByRole("form", { name: "HR profile" }).getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();

  await page.goto(`/dashboard/hr/employees?role=none&q=${encodeURIComponent(name)}`);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("No CRM login");
  await expect(row).toContainText("Inactive");
});

test("an admin sets a team's weekend days; the roster month view shades them", async ({ page }) => {
  const teamName = unique("E2E Weekend Team");
  const teamId = await createTeamWithAgent(teamName);
  await login(page, "admin");
  await page.goto(`/dashboard/teams?tab=teams&team=${teamId}`);
  const form = page.getByRole("form", { name: "Edit team" });
  await form.getByLabel("Fri").check();
  await form.getByLabel("Sat").check();
  await form.getByRole("button", { name: "Save team" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Team saved." })).toBeVisible();

  // November 2026: the 6th is a Friday, the 7th a Saturday, the 9th a Monday.
  await page.goto(`/dashboard/teams?tab=roster&team=${teamId}&view=month&month=2026-11`);
  await expect(page.getByText("Shaded columns are this team's weekend.")).toBeVisible();
  const header = (day: number) => page.getByRole("columnheader", { name: String(day), exact: true });
  await expect(header(6)).toHaveAttribute("title", "Team weekend");
  await expect(header(7)).toHaveAttribute("title", "Team weekend");
  await expect(header(9)).not.toHaveAttribute("title", "Team weekend");

  await page.goto(`/dashboard/teams?tab=roster&team=${teamId}&view=day&date=2026-11-06`);
  await expect(page.getByText(`This day is a weekend for ${teamName}.`)).toBeVisible();
});

test("a proposal needs the first installment month; installments are due on the 10th", async ({ page }) => {
  const unitNo = unique("E2E-U").replace(/\s+/g, "-");
  const unitId = await createAvailableUnit(unitNo);
  await selectTestProject(page.context());
  await login(page, "agent1");
  await page.goto("/dashboard/tasks/new");
  await page.getByLabel("Title").fill(unique("E2E Proposal"));
  await page.getByLabel("Type").selectOption("proposal");
  await page.getByLabel("Customer name").fill("E2E Customer");
  await page.getByLabel("Project", { exact: true }).selectOption(seed().projectId);
  await page.getByLabel("Unit", { exact: true }).selectOption(unitId);
  await page.getByLabel("No. of installments").fill("3");

  // Without the month the server refuses the save.
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Choose the month of the first installment (installments are due on the 10th)")).toBeVisible();

  await page.getByLabel("First installment month").fill("2026-12");
  await expect(page.getByLabel("Row 2 due date")).toHaveValue("2026-12-10");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/dashboard\/tasks\/[0-9a-f-]{36}\?saved=1$/);
  for (const due of ["Dec 10, 2026", "Jan 10, 2027", "Feb 10, 2027"]) await expect(page.getByRole("cell", { name: due })).toBeVisible();
  // The down payment row has no date; 25% is the new default (Q42).
  await expect(page.getByText("Down payment 25%")).toBeVisible();
});

test("the unit picker offers only Available units for proposals (Q48)", async ({ page }) => {
  await selectTestProject(page.context());
  await login(page, "agent1");
  await page.goto("/dashboard/tasks/new");
  await page.getByLabel("Type").selectOption("proposal");
  await page.getByLabel("Project", { exact: true }).selectOption(seed().projectId);
  // E2E-1 is reserved by the seeded booking.
  const unit = page.getByLabel("Unit", { exact: true });
  await expect(unit.locator("option", { hasText: "E2E-1 ·" })).toHaveCount(0);
  await page.getByLabel("Type").selectOption("payment_plan");
  await expect(unit.locator("option", { hasText: "E2E-1 ·" })).toHaveCount(1);
});
