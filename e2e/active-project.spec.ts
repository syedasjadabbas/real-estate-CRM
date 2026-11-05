import { test, type Page } from "@playwright/test";
import { createAvailableUnit, createInactiveableProject, setProjectStatus } from "./support/data";
import { E2E_PASSWORD, expect, login, seed, unique, type Role } from "./support/seed";

/** FR-004: on one shared browser each person keeps their own project, through the real selector and sign-in. */

const selector = (page: Page) => page.getByRole("button", { name: "Active project" });
async function choose(page: Page, name: string) {
  await selector(page).click();
  await page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
  await expect(selector(page)).toContainText(name);
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/);
}
/** Signs in on the page's browser as it stands, keeping its cookies. */
async function signIn(page: Page, role: Role) {
  await page.getByLabel("Email").fill(seed().users[role].email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard(\?|$)/);
}

test("on a shared browser nobody inherits a project, and each person's returns after signing in @mobile", async ({ page }) => {
  await login(page, "manager");
  await choose(page, "Test Project");
  await page.reload();
  await expect(selector(page)).toContainText("Test Project");
  await signOut(page);

  // The next person on this browser starts from the default, not the manager's project.
  await signIn(page, "agent1");
  await expect(selector(page)).toContainText("Other Project");
  await signOut(page);

  await signIn(page, "manager");
  await expect(selector(page)).toContainText("Test Project");
});

test("lists follow the chosen project, and the API agrees", async ({ page }) => {
  const unitNo = unique("AP");
  await createAvailableUnit(unitNo); // in Test Project
  await login(page, "manager");
  const listed = async () => ((await (await page.request.get(`/api/v1/units?q=${encodeURIComponent(unitNo)}`)).json()) as { data: { total: number } }).data.total;

  await choose(page, "Other Project");
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("link", { name: unitNo })).toHaveCount(0);
  expect(await listed()).toBe(0);

  await choose(page, "Test Project");
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("link", { name: unitNo })).toBeVisible();
  expect(await listed()).toBe(1);
});

test("two people signed in at once on different browsers don't affect each other", async ({ browser }) => {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await contexts[0].newPage(), await contexts[1].newPage()];
  await login(a, "manager");
  await login(b, "agent1");
  await choose(a, "Test Project");
  await choose(b, "Other Project");
  await a.reload();
  await b.reload();
  await expect(selector(a)).toContainText("Test Project");
  await expect(selector(b)).toContainText("Other Project");
  for (const c of contexts) await c.close();
});

test("a second tab uses the new project after it reloads", async ({ context }) => {
  const first = await context.newPage();
  await login(first, "agent2");
  const second = await context.newPage();
  await second.goto("/dashboard");
  await choose(first, "Test Project");
  await second.reload();
  await expect(selector(second)).toContainText("Test Project");
});

test("a saved project that becomes inactive falls back to one the user can select", async ({ page }) => {
  const { id, name } = await createInactiveableProject();
  await login(page, "agent2");
  await page.reload();
  await choose(page, name);
  await setProjectStatus(id, "inactive");
  await page.reload();
  await expect(selector(page)).not.toContainText(name);
  await expect(selector(page)).toContainText("Other Project");
});

test("the old shared cookie is ignored and removed at sign-out", async ({ page, context }) => {
  await login(page, "agent1");
  const { hostname } = new URL(page.url());
  await context.addCookies([{ name: "mz_project", value: seed().projectId, domain: hostname, path: "/" }]);
  await page.reload();
  await expect(selector(page)).toContainText("Other Project");
  await signOut(page);
  expect((await context.cookies()).some((c) => c.name === "mz_project")).toBe(false);
});
