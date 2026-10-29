// Seeds lookup lists and LOCAL DEVELOPMENT accounts/project/team.
// Idempotent: existing rows are left untouched. Never run against production.
// Generated passwords are printed once and written to the untracked .dev-credentials file.
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on shell environment
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed development accounts with NODE_ENV=production.");
  process.exit(1);
}

const SOURCES = [
  "WhatsApp", "Email", "Website", "Twitter", "TikTok", "Billboard", "Walk in", "Personal",
  "Reference", "Cold data", "Dealers", "Facebook", "Google", "Old CRM (Meta)", "CEO data",
];
const CITIES = [
  "Islamabad", "Rawalpindi", "Lahore", "Karachi", "Peshawar", "Faisalabad", "Multan",
  "Abbottabad", "Gujranwala", "Sialkot", "Quetta", "Hyderabad", "Overseas",
];
const BUDGETS = ["Under PKR 10 million", "PKR 10–20 million", "PKR 20–30 million", "PKR 30–50 million", "Above PKR 50 million"];
const LOST_REASONS = ["Not interested", "Budget mismatch", "Not responding", "Bought elsewhere", "Invalid number", "Other"];

const DEV_USERS = [
  { name: "Dev Super Admin", email: "superadmin@mz.local", role: "super_admin" },
  { name: "Dev Manager", email: "manager@mz.local", role: "manager" },
  { name: "Dev Agent One", email: "agent1@mz.local", role: "agent" },
  { name: "Dev Agent Two", email: "agent2@mz.local", role: "agent" },
  { name: "Dev HR", email: "hr@mz.local", role: "hr" },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const created = [];

async function seedLookup(table, names) {
  for (const [i, name] of names.entries()) {
    await client.query(`INSERT INTO ${table} (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [name, i]);
  }
}

try {
  await client.query("BEGIN");
  await seedLookup("lead_sources", SOURCES);
  await seedLookup("cities", CITIES);
  await seedLookup("budget_ranges", BUDGETS);
  await seedLookup("lost_reasons", LOST_REASONS);

  await client.query(
    `INSERT INTO projects (name, type, developer, city) VALUES ('Demo Project', 'building', 'Demo Developer', 'Islamabad')
     ON CONFLICT (name) DO NOTHING`,
  );

  const ids = {};
  for (const u of DEV_USERS) {
    const existing = await client.query("SELECT id FROM users WHERE lower(email) = lower($1)", [u.email]);
    if (existing.rows[0]) {
      ids[u.email] = existing.rows[0].id;
      continue;
    }
    const password = randomBytes(9).toString("base64url");
    const res = await client.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      [u.name, u.email, await hash(password), u.role],
    );
    ids[u.email] = res.rows[0].id;
    created.push(`${u.role.padEnd(12)} ${u.email.padEnd(22)} ${password}`);
  }

  const team = await client.query(
    `INSERT INTO teams (name, manager_id) VALUES ('Demo Sales Team', $1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ids["manager@mz.local"]],
  );
  for (const email of ["manager@mz.local", "agent1@mz.local", "agent2@mz.local"]) {
    await client.query(
      "INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [team.rows[0].id, ids[email]],
    );
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

if (created.length) {
  const block = `# Local development accounts — created ${new Date().toISOString()}\n${created.join("\n")}\n\n`;
  appendFileSync(".dev-credentials", block);
  console.log("Created development accounts (also saved to .dev-credentials, which is git-ignored):");
  console.log(created.join("\n"));
} else {
  console.log("Seed complete. Development accounts already existed (see .dev-credentials).");
}
