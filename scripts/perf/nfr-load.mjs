// NFR-01 (10 concurrent named users) and NFR-02 (list pages under 1.5 s at 10k leads).
// Measures the production build against the TEST database only: it wipes that database and
// fills it with synthetic records, as the end-to-end suite does. Needs `npm run build` first.
// Usage: node scripts/perf/nfr-load.mjs [--out results.json] [--seconds 60]
import { hash } from "@node-rs/argon2";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const PORT = 3310;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET_MS = 1500;
const LEADS = 10_000;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg("seconds", 60));
const OUT = arg("out", null);

process.loadEnvFile(".env.local");
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL) throw new Error("A separate TEST_DATABASE_URL is required.");
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!/test/i.test(dbName)) throw new Error(`Refusing database "${dbName}": its name must contain "test".`);

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (text, values) => client.query(text, values);

// ─── Synthetic data ───────────────────────────────────────────
const password = randomBytes(18).toString("base64url"); // this run only; never stored or printed
const ROLES = [
  ["super_admin", "perf.superadmin"], ["admin", "perf.admin"], ["manager", "perf.manager1"], ["manager", "perf.manager2"],
  ["agent", "perf.agent1"], ["agent", "perf.agent2"], ["agent", "perf.agent3"], ["agent", "perf.agent4"], ["hr", "perf.hr"], ["accountant", "perf.accountant"],
];

async function seed() {
  // Everything the test reset clears. payment_methods stays: migrations seed it once, and the suites need it.
  const tables = (await q(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'payment_methods'`)).rows.map((r) => `"${r.tablename}"`);
  await q(`truncate ${tables.join(", ")} restart identity`);
  const passwordHash = await hash(password);
  const users = [];
  for (const [role, name] of ROLES) {
    const { rows } = await q(`insert into users (name, email, role, password_hash) values ($1, $2, $3, $4) returning id, email, role`, [name, `${name}@test.local`, role, passwordHash]);
    users.push(rows[0]);
  }
  const by = (email) => users.find((u) => u.email.startsWith(email));
  const [{ id: projectId }] = (await q(`insert into projects (name) values ('Perf Project') returning id`)).rows;
  await q(`insert into projects (name) values ('Perf Other Project')`);
  const teamIds = [];
  for (const [name, manager, agents] of [["Perf Team 1", "perf.manager1", ["perf.agent1", "perf.agent2"]], ["Perf Team 2", "perf.manager2", ["perf.agent3", "perf.agent4"]]]) {
    const [{ id }] = (await q(`insert into teams (name, manager_id) values ($1, $2) returning id`, [name, by(manager).id])).rows;
    teamIds.push(id);
    for (const member of [manager, ...agents]) await q(`insert into team_members (team_id, user_id) values ($1, $2)`, [id, by(member).id]);
  }
  for (const [table, names] of [
    ["lead_sources", ["WhatsApp", "Email", "Website", "TikTok", "Walk in", "Reference", "Facebook", "Google"]],
    ["cities", ["Islamabad", "Rawalpindi", "Lahore", "Karachi", "Peshawar", "Multan"]],
    ["budget_ranges", ["Under PKR 10 million", "PKR 10–20 million", "PKR 20–30 million"]],
    ["lost_reasons", ["Not interested", "Budget mismatch", "Not responding"]],
  ]) {
    for (const [i, name] of names.entries()) await q(`insert into ${table} (name, sort_order) values ($1, $2)`, [name, i]);
  }

  // 10,000 leads over a year, spread across agents, stages and lookups.
  await q(
    `with a as (select array_agg(id) ids from users where role = 'agent'),
          s as (select array_agg(id) ids from lead_sources),
          c as (select array_agg(id) ids from cities),
          b as (select array_agg(id) ids from budget_ranges),
          g as (select i, (now() - (random() * interval '365 days')) as at from generate_series(0, $2::int - 1) i)
     insert into leads (code, project_id, owner_id, name, phone_country_code, phone_number, phone_e164, email, city_id, gender, stage,
                        stage_changed_at, source_id, budget_range_id, desired_size, priority, next_follow_up_at, first_touch_at, last_activity_at,
                        latest_comment, created_at, updated_at)
     select chr(65 + (i / 456976) % 26) || chr(65 + (i / 17576) % 26) || chr(65 + (i / 676) % 26) || chr(65 + (i / 26) % 26) || chr(65 + i % 26) || 'PRF',
            $1::uuid, a.ids[1 + i % array_length(a.ids, 1)], 'Perf Lead ' || i, '+92', '30' || lpad(i::text, 8, '0'), '+9230' || lpad(i::text, 8, '0'),
            case when i % 3 = 0 then 'lead' || i || '@test.local' end, c.ids[1 + i % array_length(c.ids, 1)], case when i % 2 = 0 then 'female' else 'male' end,
            (array['new_lead','contact_attempted','contacted','qualified_lead','meeting_scheduled','meeting_done','booking_in_process','lost_lead'])[1 + i % 8]::lead_stage,
            at + interval '1 day', s.ids[1 + i % array_length(s.ids, 1)], b.ids[1 + i % array_length(b.ids, 1)], (500 + i % 900) || ' sq ft',
            (array['none','low','medium','high'])[1 + i % 4]::lead_priority,
            case when i % 2 = 0 then now() + ((i % 60 - 30) * interval '1 day') end, case when i % 4 <> 0 then at + interval '2 hours' end, at + interval '2 days',
            'Synthetic comment for load testing, lead number ' || i, at, at + interval '2 days'
     from g, a, s, c, b`,
    [projectId, LEADS],
  );
  await q(`insert into lead_activities (lead_id, actor_id, type, body, created_at) select l.id, l.owner_id, 'note', 'Synthetic note ' || n, l.created_at + n * interval '1 hour' from leads l, generate_series(1, 5) n`);
  await q(`insert into follow_ups (lead_id, assignee_id, due_at, status) select id, owner_id, next_follow_up_at, 'pending' from leads where next_follow_up_at is not null`);
  await q(
    `insert into clients (name, phone_country_code, phone_number, phone_e164, owner_id, created_by_id)
     select 'Perf Client ' || i, '+92', '31' || lpad(i::text, 8, '0'), '+9231' || lpad(i::text, 8, '0'), (select id from users where role = 'agent' order by email limit 1), (select id from users where role = 'admin' limit 1)
     from generate_series(0, 1999) i`,
  );
  await q(`insert into units (project_id, unit_no, area_sqft, base_price, floor, block) select $1::uuid, 'P-' || i, 500 + i % 900, 10000000 + i * 1000, 'Floor ' || i % 20, 'Block ' || chr(65 + i % 4) from generate_series(0, 1999) i`, [projectId]);
  await q(`analyze`);
  return { users, projectId };
}

// ─── Server and sessions ──────────────────────────────────────
function startServer() {
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "production", FILE_STORAGE_DIR: path.join(tmpdir(), "mz-crm-perf-storage") },
    stdio: "ignore",
  });
  return server;
}
async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The server did not start.");
}
async function signIn(user, projectId) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: user.email, password }),
  });
  if (!res.ok) throw new Error(`Sign-in failed for ${user.role}: ${res.status}`);
  const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("mz_session="));
  return { ...user, cookie: `${session}; mz_project_${user.id}=${projectId}` };
}

// ─── Measuring ────────────────────────────────────────────────
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const stats = (samples) => {
  const s = [...samples].sort((a, b) => a - b);
  return { n: s.length, p50: Math.round(percentile(s, 50)), p95: Math.round(percentile(s, 95)), max: Math.round(s.at(-1)) };
};
/** Time until the whole response has arrived, including streamed content. */
async function timed(user, target) {
  const start = performance.now();
  const res = await fetch(`${BASE}${target}`, { headers: { cookie: user.cookie, origin: BASE }, redirect: "manual" });
  await res.arrayBuffer();
  return { ms: performance.now() - start, status: res.status };
}

const LIST_PAGES = [
  ["Leads (default)", "/dashboard/leads"],
  ["Leads, last page", "/dashboard/leads?page=200"],
  ["Leads, sorted by city", "/dashboard/leads?sort=city&dir=asc"],
  ["Leads, sorted by size (computed)", "/dashboard/leads?sort=size&dir=desc"],
  ["Leads, search", "/dashboard/leads?q=Perf%20Lead%209"],
  ["Leads, filtered", "/dashboard/leads?priority=high"],
  ["Leads, lost", "/dashboard/leads/lost"],
  ["Leads, pipeline board", "/dashboard/leads/pipeline"],
  ["Clients", "/dashboard/clients"],
  ["Inventory", "/dashboard/inventory"],
  ["Bookings", "/dashboard/bookings"],
  ["Tasks", "/dashboard/tasks"],
  ["Performance", "/dashboard/performance"],
  ["Dashboard", "/dashboard"],
];

async function singleUser(admin) {
  const out = [];
  for (const [label, target] of LIST_PAGES) {
    for (let i = 0; i < 3; i++) await timed(admin, target);
    const samples = [];
    let bad = 0;
    for (let i = 0; i < 15; i++) {
      const r = await timed(admin, target);
      samples.push(r.ms);
      if (r.status !== 200) bad += 1;
    }
    out.push({ label, target, bad, ...stats(samples) });
    console.log(`server  ${label.padEnd(34)} p50 ${out.at(-1).p50} ms  p95 ${out.at(-1).p95} ms  max ${out.at(-1).max} ms${bad ? `  BAD ${bad}` : ""}`);
  }
  return out;
}

/** Real Chrome: from navigation until the first data row is visible. */
async function inBrowser(admin) {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(admin.cookie.split("; ").map((c) => {
    const i = c.indexOf("=");
    return { name: c.slice(0, i), value: c.slice(i + 1), domain: "127.0.0.1", path: "/" };
  }));
  const page = await context.newPage();
  const out = [];
  for (const [label, target, ready] of [
    ["Leads", "/dashboard/leads", "table tbody tr"],
    ["Leads, sorted by size", "/dashboard/leads?sort=size&dir=desc", "table tbody tr"],
    ["Clients", "/dashboard/clients", "table tbody tr"],
    ["Inventory", "/dashboard/inventory", "table tbody tr"],
  ]) {
    const samples = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      await page.goto(`${BASE}${target}`, { waitUntil: "commit" });
      await page.locator(ready).first().waitFor({ state: "visible" });
      if (i > 1) samples.push(performance.now() - start);
    }
    out.push({ label, target, ...stats(samples) });
    console.log(`browser ${label.padEnd(34)} p50 ${out.at(-1).p50} ms  p95 ${out.at(-1).p95} ms  max ${out.at(-1).max} ms`);
  }
  await browser.close();
  return out;
}

/** All ten people at once, reading lists and writing notes. `thinkMs` is the pause between actions. */
async function concurrent(sessions, leadIdsByOwner, thinkMs) {
  const stop = Date.now() + SECONDS * 1000;
  const reads = [];
  const failures = [];
  let notes = 0;
  const pages = LIST_PAGES.filter(([, t]) => !t.includes("performance") && !t.includes("bookings") && !t.includes("tasks")).map(([, t]) => t);
  await Promise.all(
    sessions.map(async (user, u) => {
      let i = u;
      while (Date.now() < stop) {
        i += 1;
        const own = leadIdsByOwner.get(user.id);
        if (own && i % 5 === 0) {
          const lead = own[i % own.length];
          const res = await fetch(`${BASE}/api/v1/leads/${lead}/notes`, {
            method: "POST",
            headers: { cookie: user.cookie, origin: BASE, "content-type": "application/json" },
            body: JSON.stringify({ body: `Load test note ${user.role} ${i}` }),
          });
          await res.arrayBuffer();
          if (res.ok) notes += 1;
          else failures.push({ role: user.role, target: "note", status: res.status });
        } else {
          const target = pages[i % pages.length];
          const r = await timed(user, target);
          reads.push(r.ms);
          // HR and Accountants are refused some lists by design: a 200 or a restricted page, never a 5xx.
          if (r.status >= 500) failures.push({ role: user.role, target, status: r.status });
        }
        if (thinkMs) await new Promise((r) => setTimeout(r, thinkMs));
      }
    }),
  );
  return { thinkMs, seconds: SECONDS, users: sessions.length, reads: stats(reads), notesWritten: notes, failures: failures.length, failureSample: failures.slice(0, 5) };
}

/** Each agent, signed in at the same moment, must see exactly their own leads. */
async function isolation(sessions, projectId) {
  const agents = sessions.filter((s) => s.role === "agent");
  const expected = new Map((await q(`select owner_id, count(*)::int n from leads where project_id = $1 group by owner_id`, [projectId])).rows.map((r) => [r.owner_id, r.n]));
  let mismatches = 0;
  for (let round = 0; round < 20; round++) {
    await Promise.all(
      agents.map(async (agent) => {
        const res = await fetch(`${BASE}/api/v1/leads`, { headers: { cookie: agent.cookie, origin: BASE } });
        const body = await res.json();
        if (body.data.total !== expected.get(agent.id) || body.data.rows.some((r) => r.ownerId !== agent.id)) mismatches += 1;
      }),
    );
  }
  return { rounds: 20, agents: agents.length, mismatches };
}

// ─── Run ──────────────────────────────────────────────────────
console.log("Seeding the test database…");
const { users, projectId } = await seed();
const counts = (await q(`select (select count(*) from leads)::int leads, (select count(*) from lead_activities)::int activities, (select count(*) from follow_ups)::int follow_ups, (select count(*) from clients)::int clients, (select count(*) from units)::int units`)).rows[0];
console.log(counts);
const server = startServer();
const results = { date: new Date().toISOString(), target: TARGET_MS, counts };
try {
  await waitForServer();
  const sessions = await Promise.all(users.map((u) => signIn(u, projectId)));
  const admin = sessions.find((s) => s.role === "super_admin");
  const notesBefore = (await q(`select count(*)::int n from lead_activities where type = 'note'`)).rows[0].n;
  results.server = await singleUser(admin);
  results.browser = await inBrowser(admin);

  const owned = (await q(`select owner_id, (array_agg(id))[1:50] ids from leads group by owner_id`)).rows;
  const leadIdsByOwner = new Map(owned.map((r) => [r.owner_id, r.ids]));
  console.log(`\n10 users, no pauses, ${SECONDS} s…`);
  results.stress = await concurrent(sessions, leadIdsByOwner, 0);
  console.log(results.stress);
  console.log(`\n10 users, 3 s between actions, ${SECONDS} s…`);
  results.realistic = await concurrent(sessions, leadIdsByOwner, 3000);
  console.log(results.realistic);

  const notesAfter = (await q(`select count(*)::int n from lead_activities where type = 'note'`)).rows[0].n;
  results.writes = { reported: results.stress.notesWritten + results.realistic.notesWritten, stored: notesAfter - notesBefore };
  results.isolation = await isolation(sessions, projectId);
  console.log(results.writes, results.isolation);
} finally {
  server.kill();
  await client.end();
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
const slow = [...results.server, ...results.browser].filter((r) => r.p95 >= TARGET_MS || r.bad);
console.log(slow.length ? `\nOVER ${TARGET_MS} ms: ${slow.map((r) => r.label).join(", ")}` : `\nAll measured pages under ${TARGET_MS} ms at p95.`);
