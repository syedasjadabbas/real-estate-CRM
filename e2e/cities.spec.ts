import { test, type Locator, type Page } from "@playwright/test";
import { createLeadFor } from "./support/data";
import { api, expect, login, seed, selectTestProject, unique, uniquePhone } from "./support/seed";

/** FR-042: the Cities settings screen, "Other" on lead and client forms, and records keeping a deactivated city. */

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
/** City names can't contain digits, so these use letters only. */
const cityName = () => `Town ${Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`;

const cityRow = (page: Page, name: string) => page.getByRole("list", { name: "Cities" }).getByRole("listitem").filter({ hasText: name });
const citySelect = (scope: Page | Locator) => scope.getByLabel("City", { exact: true });
const typedCity = (page: Page) => page.getByLabel("City name");

async function addCity(page: Page, name: string) {
  const r = await api<{ cityId: string }>(page, "/api/v1/lookups/cities", { method: "POST", data: { name } });
  expect(r.status).toBe(201);
  return r.data.cityId;
}
/** Refills if the page hydrated after typing (Add enables only once React has the text). */
async function typeNewCity(page: Page, name: string) {
  const add = page.getByRole("button", { name: "Add", exact: true });
  await expect(async () => {
    await page.getByLabel("New city").fill(name);
    await expect(add).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await add.click();
}
/** Reselects if the page hydrated after choosing, so the name field has appeared. */
async function chooseOther(page: Page) {
  await expect(async () => {
    await citySelect(page).selectOption({ label: "Other" });
    await expect(typedCity(page)).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test("an admin adds, renames, deactivates and reactivates a city, and bad names are refused @mobile", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/dashboard/settings/security");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Cities" }).click();
  await expect(page.getByRole("heading", { name: "Cities", exact: true })).toBeVisible();

  await typeNewCity(page, "03001234567");
  await expect(page.getByText("Enter a city name, not a number or phone number")).toBeVisible();

  const name = cityName();
  await typeNewCity(page, name);
  await expect(page.getByText("City added.")).toBeVisible();
  await expect(cityRow(page, name)).toContainText("0 leads");

  await typeNewCity(page, name.toUpperCase());
  await expect(page.getByText("This city is already on the list")).toBeVisible();
  await page.getByLabel("New city").fill("");

  const renamed = cityName();
  await page.getByRole("button", { name: `Rename ${name}` }).click();
  await page.getByLabel("City name").fill("12345");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter a city name, not a number or phone number")).toBeVisible();
  await page.getByLabel("City name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("City renamed.")).toBeVisible();
  await expect(cityRow(page, renamed)).toBeVisible();

  await page.getByRole("button", { name: `Deactivate ${renamed}` }).click();
  await expect(cityRow(page, renamed)).toContainText("Inactive");
  await page.reload();
  await expect(cityRow(page, renamed)).toContainText("Inactive");
  await page.getByRole("button", { name: `Activate ${renamed}` }).click();
  await expect(page.getByRole("button", { name: `Deactivate ${renamed}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
});

test("a lead takes a typed city under Other, refusing a phone number, and lists and filters by it @mobile", async ({ page, context }) => {
  await selectTestProject(context);
  await login(page, "manager");
  const s = seed();
  const name = unique("City Lead");
  const typed = cityName();

  await page.goto("/dashboard/leads/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await page.getByLabel("Source").selectOption(s.sourceId);
  await expect(typedCity(page)).toHaveCount(0);
  await chooseOther(page);
  await typedCity(page).fill("03001234567");
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Enter a city name, not a number or phone number")).toBeVisible();
  await expect(page).toHaveURL(/\/leads\/new$/);

  await typedCity(page).fill(typed);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.waitForURL(/\/dashboard\/leads\/[0-9a-f-]{36}$/);
  // Scoped: the router can keep the /new form mounted but hidden after the redirect.
  const details = page.getByRole("form", { name: "Lead details" });
  await expect(citySelect(details)).toHaveValue("other");
  await expect(details.getByLabel("City name")).toHaveValue(typed);

  await page.goto("/dashboard/leads?city=other");
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
  await expect(page.getByText(typed).first()).toBeVisible();
  await page.goto(`/dashboard/leads?city=${UNKNOWN_ID}`);
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});

test("a client takes a typed city, and an edit moves it to a list city", async ({ page }) => {
  await login(page, "superAdmin");
  const listed = cityName();
  await addCity(page, listed);
  const name = unique("City Client");
  const typed = cityName();

  await page.goto("/dashboard/clients/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Mobile number").fill(uniquePhone());
  await chooseOther(page);
  await typedCity(page).fill("+92 300 1234567");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("Enter a city name, not a number or phone number")).toBeVisible();
  await typedCity(page).fill(typed);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/dashboard\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByText(typed).first()).toBeVisible();

  // Scoped: the router can keep the /new form mounted but hidden after the redirect.
  const details = page.getByRole("form", { name: "Client details" });
  await citySelect(details).selectOption({ label: listed });
  await details.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(listed).first()).toBeVisible();
  await expect(page.getByText(typed)).toHaveCount(0);
});

test("a lead keeps its deactivated city through an edit, stays filterable, and new leads can't pick it", async ({ page, browser }) => {
  await login(page, "admin");
  const city = cityName();
  const cityId = await addCity(page, city);
  const name = unique("Old City Lead");
  const leadId = await createLeadFor("agent1", name, "manager", { cityId });
  expect((await api(page, `/api/v1/lookups/cities/${cityId}`, { method: "PATCH", data: { isActive: false } })).status).toBe(200);

  const ctx = await browser.newContext();
  await selectTestProject(ctx);
  const manager = await ctx.newPage();
  await login(manager, "manager");
  await manager.goto(`/dashboard/leads/${leadId}`);
  await expect(citySelect(manager).locator("option:checked")).toHaveText(`${city} (inactive)`);
  await expect(async () => {
    await manager.getByLabel("Size").fill("674 sq ft");
    await expect(manager.getByRole("button", { name: "Save changes" })).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await manager.getByRole("button", { name: "Save changes" }).click();
  await expect(manager.getByText("Changes saved.")).toBeVisible();
  await manager.reload();
  await expect(citySelect(manager)).toHaveValue(cityId);

  await manager.goto(`/dashboard/leads?city=${cityId}`);
  await expect(manager.getByRole("link", { name }).first()).toBeVisible();
  await manager.getByRole("button", { name: /Filters/ }).click();
  await expect(manager.getByRole("button", { name: `${city} (inactive)` })).toBeVisible();

  await manager.goto("/dashboard/leads/new");
  await expect(citySelect(manager).locator("option", { hasText: city })).toHaveCount(0);
  await ctx.close();
});

test("only admins reach the screen and API, and the API refuses bad cities", async ({ page, browser }) => {
  const s = seed();
  for (const role of ["manager", "agent1", "hr", "accountant"] as const) {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await login(other, role);
    await other.goto("/dashboard/settings/cities");
    await expect(other.getByText("You do not have permission to view this section.")).toBeVisible();
    await expect(other.getByRole("list", { name: "Cities" })).toHaveCount(0);
    expect((await api(other, "/api/v1/lookups/cities")).status).toBe(403);
    expect((await api(other, "/api/v1/lookups/cities", { method: "POST", data: { name: cityName() } })).status).toBe(403);
    expect((await api(other, `/api/v1/lookups/cities/${UNKNOWN_ID}`, { method: "PATCH", data: { isActive: false } })).status).toBe(403);
    await ctx.close();
  }

  await login(page, "admin");
  const name = cityName();
  await addCity(page, name);
  const post = (data: Record<string, unknown>) => api(page, "/api/v1/lookups/cities", { method: "POST", data });
  expect((await post({ name: "03001234567" })).status).toBe(400);
  expect((await post({ name: name.toUpperCase() })).status).toBe(400);
  expect((await post({ name: "Other" })).status).toBe(400);
  expect((await api(page, `/api/v1/lookups/cities/${UNKNOWN_ID}`, { method: "PATCH", data: { name: cityName() } })).status).toBe(404);
  const list = await api<{ name: string }[]>(page, "/api/v1/lookups/cities");
  expect(list.data.filter((c) => c.name === name)).toHaveLength(1);

  const lead = (extra: Record<string, unknown>) =>
    api(page, "/api/v1/leads", {
      method: "POST",
      data: { projectId: s.projectId, name: unique("Api City"), phoneCountryCode: "+92", phoneNumber: uniquePhone(), sourceId: s.sourceId, ...extra },
    });
  expect((await lead({ cityId: UNKNOWN_ID })).status).toBe(400);
  expect((await lead({ cityId: "Lahore" })).status).toBe(400);
  expect((await lead({ cityId: "other", cityOther: "03001234567" })).status).toBe(400);
  expect((await lead({ cityId: "other" })).status).toBe(400);
  expect((await lead({ cityId: "other", cityOther: cityName() })).status).toBe(201);
});
