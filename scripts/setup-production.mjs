// Controlled one-time setup of a NEW production database (VERSION_1_EXECUTION_PLAN.md §4 P1).
// Run on the server after `npm run db:migrate`, with the production environment loaded:
//
//   NODE_ENV=production node scripts/setup-production.mjs --confirm-database <db name> \
//     --lookups setup/production-lookups.json [--admin-name "Full Name" --admin-email person@company]
//
// - Refuses unless NODE_ENV=production and --confirm-database matches the connected database.
// - Never reads .env.local and never copies development data, accounts or demo records.
// - Lookup lists (lead sources, cities, budget ranges, lost reasons) come from a reviewed JSON file
//   of client-confirmed values; existing rows are never changed or removed (idempotent).
// - The first Super Admin is created only while no Super Admin exists. The password is typed at a
//   hidden prompt (or piped on stdin for automation); it is never printed, logged or stored.
import { hash } from "@node-rs/argon2";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import pg from "pg";

const LOOKUP_TABLES = { leadSources: "lead_sources", cities: "cities", budgetRanges: "budget_ranges", lostReasons: "lost_reasons" };
const MIN_PASSWORD_LENGTH = 10;

function fail(message) {
  console.error(`setup-production: ${message}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Reads a line without echoing it (TTY), or the first line of piped stdin. */
function readSecret(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      rl._writeToOutput = () => {};
    }
    rl.once("line", (line) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    });
  });
}

function readLookups(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read lookups file ${file}: ${error.message}`);
  }
  const out = {};
  for (const key of Object.keys(LOOKUP_TABLES)) {
    const list = data[key] ?? [];
    if (!Array.isArray(list) || list.some((v) => typeof v !== "string" || !v.trim() || v.trim().length > 100)) fail(`"${key}" must be a list of names (1–100 characters)`);
    // Case-insensitive duplicates keep their first spelling.
    const seen = new Map();
    for (const v of list) if (!seen.has(v.trim().toLowerCase())) seen.set(v.trim().toLowerCase(), v.trim());
    out[key] = [...seen.values()];
  }
  return out;
}

if (process.env.NODE_ENV !== "production") fail("NODE_ENV must be production.");
const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set.");
const confirm = arg("confirm-database");
if (!confirm) fail("pass --confirm-database <name of the production database>.");
const lookupsFile = arg("lookups");
const adminName = arg("admin-name")?.trim();
const adminEmail = arg("admin-email")?.trim().toLowerCase();
if (!lookupsFile && !adminEmail) fail("nothing to do: pass --lookups <file> and / or --admin-name and --admin-email.");
if (adminEmail && (!adminName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))) fail("--admin-name and a valid --admin-email are both required.");
const lookups = lookupsFile ? readLookups(lookupsFile) : null;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const {
    rows: [{ db }],
  } = await client.query("select current_database() as db");
  if (db !== confirm) fail(`connected to database "${db}", but --confirm-database says "${confirm}". Nothing was changed.`);

  if (lookups) {
    for (const [key, table] of Object.entries(LOOKUP_TABLES)) {
      let added = 0;
      // "Other" is a fixed choice on the forms (FR-042), so it never becomes a list row.
      const names = key === "cities" ? lookups[key].filter((n) => n.trim().toLowerCase() !== "other") : lookups[key];
      for (const [i, name] of names.entries()) {
        // Skips names already present in any letter case; never changes or removes existing rows.
        const r = await client.query(
          `INSERT INTO ${table} (name, sort_order) SELECT $1::text, $2::int WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE lower(name) = lower($1::text)) ON CONFLICT (name) DO NOTHING`,
          [name, i],
        );
        added += r.rowCount;
      }
      console.log(`${table}: ${added} added, ${names.length - added} already present.`);
    }
  }

  if (adminEmail) {
    const {
      rows: [{ n }],
    } = await client.query("select count(*)::int as n from users where role = 'super_admin'");
    if (n > 0) fail("a Super Admin already exists. Create further accounts in the CRM (HR → Employees → New CRM user).");
    const password = await readSecret(`Password for ${adminEmail} (at least ${MIN_PASSWORD_LENGTH} characters, not shown): `);
    if (password.length < MIN_PASSWORD_LENGTH) fail(`the password must have at least ${MIN_PASSWORD_LENGTH} characters. Nothing was created.`);
    if (password.trim().toLowerCase() === adminEmail) fail("the password cannot be the email address. Nothing was created.");
    await client.query("BEGIN");
    const {
      rows: [user],
    } = await client.query("INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'super_admin') RETURNING id", [adminName, adminEmail, await hash(password)]);
    await client.query("INSERT INTO audit_logs (actor_id, action, entity, entity_id, before, after) VALUES (NULL, 'user.create', 'user', $1, NULL, $2)", [
      user.id,
      JSON.stringify({ name: adminName, email: adminEmail, role: "super_admin", status: "active", source: "setup-production" }),
    ]);
    await client.query("COMMIT");
    console.log(`First Super Admin created: ${adminEmail}.`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  fail(error.message);
} finally {
  await client.end();
}
