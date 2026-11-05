// Read-only check that a database has what the V1 presentation needs (docs/V1_PRESENTATION_RUNBOOK.md).
// It only runs SELECTs: it never adds, changes or removes anything. Prints no credentials.
// Usage: node scripts/ops/presentation-preflight.mjs
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the shell environment
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const one = async (sql) => (await client.query(sql)).rows[0].n;

const roles = (await client.query(`select role, count(*)::int n from users where status = 'active' group by role`)).rows;
const active = (role) => roles.find((r) => r.role === role)?.n ?? 0;
const checks = [
  ["An active project", await one(`select count(*)::int n from projects where status = 'active'`), 1],
  ["Available whole units (each run of the sale uses one)", await one(`select count(*)::int n from units u join projects p on p.id = u.project_id where u.status = 'available' and u.sale_model = 'whole' and p.status = 'active'`), 2],
  ["Lead sources", await one(`select count(*)::int n from lead_sources where is_active`), 1],
  ["Active cities", await one(`select count(*)::int n from cities where is_active`), 1],
  ["Active payment methods", await one(`select count(*)::int n from payment_methods where is_active`), 1],
  ["A team with a manager", await one(`select count(*)::int n from teams where manager_id is not null`), 1],
  ["Active Super Admin", active("super_admin"), 1],
  ["Active Manager", active("manager"), 1],
  ["Active Agent", active("agent"), 1],
  ["Active Accountant", active("accountant"), 1],
];
await client.end();

let failed = 0;
for (const [label, value, needed] of checks) {
  const ok = value >= needed;
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "NEED"} ${label}: ${value} (at least ${needed})`);
}
console.log(failed ? `\n${failed} item(s) need attention before presenting.` : "\nReady to present.");
process.exit(failed ? 1 : 0);
