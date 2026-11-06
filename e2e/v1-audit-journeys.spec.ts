import { test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createAvailableUnit } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique, uniquePhone } from "./support/seed";

/**
 * V1 audit: journeys that had only been set up through services, driven through their real pages,
 * with each result read back after a reload so persistence is proved, not assumed.
 */

test("a project and a unit are created through their forms, and the unit is listed", async ({ page, context }) => {
  // "Zz": other specs rely on which project sorts first.
  const project = unique("Zz Audit Project");
  const unitNo = unique("AUD").replace(/\s+/g, "-");
  await selectTestProject(context);
  await login(page, "superAdmin");

  await page.goto("/dashboard/projects/new");
  await expect(async () => {
    await page.getByLabel("Name").fill(project);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}/, { timeout: 3_000 });
  }).toPass();
  const projectId = /projects\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.reload();
  await expect(page.getByRole("heading", { name: project })).toBeVisible();

  await page.goto(`/dashboard/inventory/new?project=${projectId}`);
  await expect(async () => {
    await page.getByLabel("Unit number").fill(unitNo);
    await page.getByLabel("Area (sq ft)").fill("674");
    await page.getByLabel("Base price (PKR)").fill("12,500,000");
    await page.getByRole("button", { name: "Create unit" }).click();
    await page.waitForURL(/\/dashboard\/inventory\/[0-9a-f-]{36}/, { timeout: 3_000 });
  }).toPass();

  await page.goto(`/dashboard/inventory?project=${projectId}`);
  const row = page.getByRole("row").filter({ hasText: unitNo });
  await expect(row).toContainText("Available");
  await expect(row).toContainText(project);
});

test("a manager sets an agent's target, and it is still there after a reload", async ({ page, context }) => {
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/targets");
  const set = page.getByRole("button", { name: /Set target for Agent B/ });
  await expect(async () => {
    await set.click({ timeout: 1_000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Meetings/).fill("17");
  await dialog.getByRole("button", { name: "Save target" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Agent B" })).toContainText("17");
});

test("a manager saves a daily report, and the figures persist", async ({ page, context }) => {
  await selectTestProject(context);
  await login(page, "manager");
  await page.goto("/dashboard/teams?tab=daily");
  await expect(async () => {
    await page.getByRole("combobox", { name: "Team", exact: true }).selectOption({ label: "Team 1" });
    await page.waitForURL(/team=/, { timeout: 2_000 });
  }).toPass();
  const leads = page.getByLabel("Agent A Leads");
  const save = page.getByRole("button", { name: "Save report" });
  await expect(leads).toBeEditable();
  await expect(async () => {
    await leads.fill("7");
    await save.click({ timeout: 1_000 });
    await expect(page.getByText("Daily report saved.")).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await page.reload();
  await expect(page.getByLabel("Agent A Leads")).toHaveValue("7");
});

test("a client's note reaches its history and persists", async ({ page, context }) => {
  const name = unique("Audit Client");
  const note = unique("Audit client note");
  await selectTestProject(context);
  await login(page, "superAdmin");
  await page.goto("/dashboard/clients/new");
  await expect(async () => {
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Mobile number").fill(uniquePhone());
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]{36}$/, { timeout: 3_000 });
  }).toPass();
  const box = page.getByLabel("New note");
  const add = page.getByRole("button", { name: "Add note" });
  await expect(async () => {
    await box.fill(note);
    await expect(add).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await add.click();
  await expect(page.getByText(note).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(note).first()).toBeVisible();
});

test("a proposal's print page shows the customer, unit and payment plan", async ({ page, context }) => {
  const unitNo = unique("PRN").replace(/\s+/g, "-");
  const unitId = await createAvailableUnit(unitNo);
  const customer = unique("Print Customer");
  await selectTestProject(context);
  await login(page, "agent1");
  await page.goto("/dashboard/tasks/new");
  await expect(async () => {
    await page.getByLabel("Title").fill(unique("Audit Proposal"));
    await page.getByLabel("Type").selectOption("proposal");
    await expect(page.getByLabel("Customer name")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByLabel("Customer name").fill(customer);
  await page.getByLabel("Project", { exact: true }).selectOption(seed().projectId);
  await page.getByLabel("Unit", { exact: true }).selectOption(unitId);
  await page.getByLabel("No. of installments").fill("3");
  await page.getByLabel("First installment month").fill("2026-12");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/dashboard\/tasks\/[0-9a-f-]{36}\?saved=1$/);
  const taskId = /tasks\/([0-9a-f-]{36})/.exec(page.url())![1];

  await page.goto(`/print/proposal/${taskId}`);
  await expect(page.getByText(customer).first()).toBeVisible();
  await expect(page.getByText(unitNo).first()).toBeVisible();
  for (const due of ["Dec 10, 2026", "Jan 10, 2027", "Feb 10, 2027"]) await expect(page.getByRole("cell", { name: due })).toBeVisible();
});

/** Every /api/v1 route on disk, with the methods it exports. */
function apiRoutes() {
  const root = path.join("src", "app", "api", "v1");
  const out: { url: string; methods: string[] }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") {
        const source = readFileSync(full, "utf8");
        const methods = [...source.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
        const url = `/api/v1/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000");
        out.push({ url, methods });
      }
    }
  };
  walk(root);
  return out;
}

test("every API route refuses a signed-out caller", async ({ request }) => {
  // Sign-in and sign-out are the only routes meant to work without a session.
  const open = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);
  const routes = apiRoutes().filter((r) => !open.has(r.url));
  expect(routes.length).toBeGreaterThan(50);
  const exposed: string[] = [];
  for (const { url, methods } of routes) {
    for (const method of methods) {
      const res = await request.fetch(url, { method, data: method === "GET" || method === "DELETE" ? undefined : {} });
      if (res.status() !== 401) exposed.push(`${method} ${url} -> ${res.status()}`);
    }
  }
  expect(exposed).toEqual([]);
});

test("no API response carries a password hash or session token", async ({ page }) => {
  await login(page, "superAdmin");
  const targets = ["/api/v1/me", "/api/v1/auth/me", "/api/v1/users", "/api/v1/employees", "/api/v1/teams", "/api/v1/audit-logs", "/api/v1/leads", "/api/v1/clients"];
  for (const target of targets) {
    const res = await page.request.get(target);
    const text = await res.text();
    expect(text, target).not.toMatch(/\$argon2|passwordHash|password_hash|tokenHash|token_hash/);
  }
  expect((await api(page, "/api/v1/audit-logs")).status).toBe(200);
});
