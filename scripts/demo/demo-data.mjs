// Demo data: made-up customers covering every Leads scenario, through the app's own commands so the
// timelines, notifications and rules are the real ones. Local database only, unless DEMO_DATA_DB names another.
//   node --experimental-transform-types --no-warnings scripts/demo/demo-data.mjs
// Run it again on the day of the demo: nobody is added twice, the "today" and "tomorrow" dates move to today.
// Numbers are +92 300 0002xxx and emails example.com, so nobody real is contacted.
import { createRequire, registerHooks } from "node:module";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../../", import.meta.url).href;
const require = createRequire(rootUrl + "package.json");
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    let base = null;
    if (spec.startsWith("@/")) base = new URL("src/" + spec.slice(2), rootUrl).href;
    else if (spec.startsWith(".") && ctx.parentURL?.startsWith(rootUrl + "src/")) base = new URL(spec, ctx.parentURL).href;
    if (base) for (const ext of [".ts", "/index.ts", ".tsx"]) if (existsSync(fileURLToPath(base + ext))) return { url: base + ext, format: "module-typescript", shortCircuit: true };
    return next(spec, ctx);
  },
});
process.chdir(fileURLToPath(rootUrl));
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "localhost" || url.pathname !== `/${process.env.DEMO_DATA_DB ?? "mz_crm"}`) throw new Error("Demo data goes into a local demo database only.");

const imp = (p) => import(new URL("src/" + p, rootUrl).href);
const schema = await imp("server/db/schema.ts");
const { createLead, changeStage, markLost } = await imp("modules/leads/commands.ts");
const { logCallUpdate } = await imp("modules/leads/call-update.ts");
const { recordRepeatEnquiry } = await imp("modules/leads/enquiries.ts");
const { verifyLead } = await imp("modules/leads/verification.ts");
const { createMeeting, completeMeeting, cancelMeeting } = await imp("modules/meetings/commands.ts");
const { createProject, updateProject } = await imp("modules/projects/commands.ts");
const { createAccount } = await imp("modules/accounts/service.ts");
const { setTeamMembers } = await imp("modules/teams/commands.ts");
const { submitImport, decideImportBatch } = await imp("modules/leads/imports.ts");
const { createUnit } = await imp("modules/inventory/commands.ts");
const { createBooking, advanceBooking } = await imp("modules/bookings/commands.ts");
const { recordPayment } = await imp("modules/finance/commands.ts");
const { listPaymentMethods } = await imp("modules/finance/queries.ts");
const { businessToday } = await imp("modules/bookings/today.ts");
const { saveLeadFile } = await imp("modules/files/lead-files.ts");
const { uploadBookingProof } = await imp("modules/bookings/proofs.ts");
const { uploadSignedBookingForm } = await imp("modules/bookings/signed-forms.ts");
const { loadActor } = await imp("server/auth/session-store.ts");
const pg = require("pg");
const sharp = require("sharp");
const { drizzle } = require("drizzle-orm/node-postgres");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const q = async (s, p = []) => (await pool.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const actorOf = async (email) => {
  const r = await one("select id,name,email,role from users where email=$1 and status='active'", [email]);
  if (!r) throw new Error("No active account " + email);
  return loadActor(db, r);
};
const admin = await actorOf("superadmin@mz.local");
const agent = await actorOf("agent1@mz.local");
const agent2 = await actorOf("agent2@mz.local");

const HOUR = 3_600_000, DAY = 24 * HOUR;
const names = async (table) => new Map((await q(`select id,name from ${table}`)).map((r) => [r.name, r.id]));
const [sources, cities, budgets, reasons] = [await names("lead_sources"), await names("cities"), await names("budget_ranges"), await names("lost_reasons")];
const need = (map, name) => map.get(name) ?? (() => { throw new Error("Missing " + name); })();

/** Runs a step as if it happened `hours` ago: what it wrote is moved back, in the same order. */
const STAMPS = {
  audit_logs: ["created_at"],
  leads: ["created_at", "stage_changed_at", "first_touch_at", "last_activity_at", "last_contact_at", "regenerated_at", "updated_at"],
  lead_activities: ["created_at"], lead_enquiries: ["created_at", "enquired_at"], lead_assignments: ["created_at"], follow_ups: ["created_at", "done_at"],
  meetings: ["created_at", "completed_at"], files: ["created_at"], clients: ["created_at", "last_activity_at"], client_activities: ["created_at"],
  bookings: ["created_at", "stage_changed_at", "confirmed_at"], booking_stage_history: ["created_at"], approvals: ["created_at"], notifications: ["created_at"],
};
/** Append-only tables (migration 0067). Made-up history on a local database only: the checks above refuse any other. */
const LOCKED = ["audit_logs", "lead_activities", "client_activities", "booking_stage_history"];
const columns = new Set((await q("select table_name||'.'||column_name c from information_schema.columns where table_schema='public'")).map((r) => r.c));
async function ago(hours, step) {
  const t0 = new Date(Date.now() - 20);
  const out = await step();
  const back = `${Math.round(hours * 3600)} seconds`;
  const c1 = await pool.connect();
  try {
    await c1.query("begin");
    for (const t of LOCKED) await c1.query(`alter table ${t} disable trigger ${t}_append_only`);
    for (const [table, cols] of Object.entries(STAMPS))
      for (const c of cols) if (columns.has(`${table}.${c}`)) await c1.query(`update ${table} set ${c}=${c}-$2::interval where ${c}>=$1 and ${c}<=now()`, [t0, back]);
    for (const t of LOCKED) await c1.query(`alter table ${t} enable trigger ${t}_append_only`);
    await c1.query("commit");
  } catch (error) {
    await c1.query("rollback");
    throw error;
  } finally {
    c1.release();
  }
  return out;
}

/** `was`: the name an earlier run gave it. */
async function project(name, type, city, prefix, { was, marlaSqft = 225, marlas = [], nature = "House" } = {}) {
  let p = await one("select id from projects where name=$1", [name]);
  const old = was ? await one("select id from projects where name=$1", [was]) : null;
  if (!p && old) {
    await updateProject(db, admin, old.id, { name });
    p = old;
  }
  if (!p) p = { id: (await createProject(db, admin, { name, type, city, marlaSqft, developer: "Demo Developer", description: "Made-up project for demonstration" })).projectId };
  for (const [i, m] of marlas.entries()) {
    const unitNo = `${prefix}-${201 + i}`;
    if (await one("select 1 from units where project_id=$1 and unit_no=$2", [p.id, unitNo])) continue;
    const area = m * marlaSqft;
    await createUnit(db, admin, { projectId: p.id, unitNo, block: "ABC"[i % 3], areaSqft: String(area), basePrice: String(area * 14_000), nature });
  }
  if (marlas.length) return p.id;
  for (let i = 1; i <= 6; i += 1) {
    const unitNo = `${prefix}-${100 + i}`;
    if (await one("select 1 from units where project_id=$1 and unit_no=$2", [p.id, unitNo])) continue;
    const area = [520, 640, 780, 900, 1150, 1400][i - 1];
    await createUnit(db, admin, { projectId: p.id, unitNo, floor: i < 4 ? "1st Floor" : "2nd Floor", areaSqft: String(area), basePrice: String(area * 18_000), nature: "Apartment", bedrooms: String(1 + Math.floor(i / 3)) });
  }
  return p.id;
}
const cedar = await project("Demo Project 1", "building", "Islamabad", "CC", { was: "Cedar Court Residences" });
const palm = await project("Demo Project 2", "society", "Rawalpindi", "PC", { was: "Palm Court Villas", marlas: [5, 5, 5, 5, 7, 7, 10, 10, 10, 20, 20, 20] });
const garden = await project("Demo Project 3", "farmhouse", "Islamabad", "GC", { was: "Garden Court Farmhouses", marlas: [20, 20, 40, 40, 80], nature: "Farmhouse" });
const plots = await project("Demo Project 4", "society", "Lahore", "PL", { marlaSqft: 250, marlas: [3, 3, 5, 5, 5, 7, 7, 10, 10, 20, 20, 20], nature: "Plot" });

const phoneOf = (n) => `0300 0002${String(n).padStart(3, "0")}`.replace(" ", "");
/** Adds the lead (by an Admin, for the agent) unless that number already has one in the project. */
async function add(n, name, { projectId = cedar, owner = agent, by = admin, source = "Facebook", hours = 24, city = "Islamabad", budget = "PKR 10–20 million", priority = "medium", size, note } = {}) {
  if (await one("select 1 from leads where project_id=$1 and phone_e164=$2", [projectId, `+92${phoneOf(n).slice(1)}`])) return null;
  const r = await ago(hours, () =>
    createLead(db, by, {
      projectId, ...(by.role === "agent" ? {} : { ownerId: owner.id }), name, phoneCountryCode: "+92", phoneNumber: phoneOf(n), email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
      sourceId: need(sources, source), cityId: need(cities, city), budgetRangeId: need(budgets, budget), priority, desiredSize: size, note,
    }),
  );
  if (r.outcome !== "created") throw new Error(`${name}: ${r.outcome}`);
  made += 1;
  return r.leadId;
}
let made = 0;
const call = (hours, id, result, note, extra = {}, by = agent) => ago(hours, () => logCallUpdate(db, by, id, { result, note, ...extra }));
const stage = (hours, id, to, remarks, by = agent) => ago(hours, () => changeStage(db, by, id, { stage: to, remarks }));
const lose = (hours, id, reason, note) => ago(hours, () => markLost(db, admin, id, { lostReasonId: need(reasons, reason), note }));
const repeat = (hours, id, source, note, by = agent) => ago(hours, () => recordRepeatEnquiry(db, by, id, { channel: need(sources, source), note }));
const refreshNext = (id) => q("update leads set next_follow_up_at=(select min(due_at) from follow_ups where lead_id=$1 and status='pending') where id=$1", [id]);
async function followUp(id, dueAt, note, by = agent) {
  await logCallUpdate(db, by, id, { result: "no_call", followUp: { dueAt: new Date(Math.max(dueAt.getTime(), Date.now() + 60_000)).toISOString(), note } });
  await q("update follow_ups set due_at=$2, created_at=least(created_at, $2::timestamptz - interval '1 day') where lead_id=$1 and status='pending'", [id, dueAt]);
  await refreshNext(id);
}
async function meeting(id, title, startsAt, { by = agent, done, cancelled, hours = 48 } = {}) {
  const { meetingId } = await ago(hours, () => createMeeting(db, by, { title, type: "site_visit", startsAt: startsAt.toISOString(), leadId: id, location: "Site office" }));
  await q("update meetings set starts_at=$2 where id=$1", [meetingId, startsAt]);
  const after = Math.max(0, (Date.now() - startsAt.getTime()) / HOUR - 1);
  if (done) await ago(after, () => completeMeeting(db, by, meetingId, { note: done, moveLead: true }));
  if (cancelled) await ago(after, () => cancelMeeting(db, by, meetingId, { note: cancelled }));
}
const pkt = (days, hour) => {
  const d = new Date(Date.now() + 5 * HOUR + days * DAY);
  return new Date(`${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00+05:00`);
};
const dueToday = () => new Date(Math.min(Math.max(pkt(0, 18).getTime(), Date.now() + HOUR), pkt(0, 23).getTime() + 59 * 60_000));

async function screenshot(title, lines) {
  const rows = lines.map((l, i) => `<rect x="${l[0] === "<" ? 24 : 110}" y="${110 + i * 78}" width="346" height="60" rx="14" fill="${l[0] === "<" ? "#fff" : "#d7f5c8"}"/><text x="${l[0] === "<" ? 42 : 128}" y="${147 + i * 78}" font-size="17" fill="#222">${l.slice(2)}</text>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${170 + lines.length * 78}" font-family="Arial"><rect width="100%" height="100%" fill="#ece5dd"/><rect width="100%" height="84" fill="#2d6a5a"/><text x="24" y="40" font-size="21" fill="#fff">${title}</text><text x="24" y="66" font-size="14" fill="#dfe">SAMPLE CHAT FOR DEMONSTRATION</text>${rows}</svg>`)).png().toBuffer();
}
const chat = async (hours, id, title, lines, by = agent) => {
  const bytes = await screenshot(title, lines);
  await ago(hours, () => saveLeadFile(db, by, id, { kind: "whatsapp_chat", bytes, name: "chat-screenshot.png", ext: "png", mime: "image/png", auditAction: "lead.whatsapp_chat_upload" }));
};
const recording = async (hours, id) => {
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-af", "volume=0.1", "-b:a", "32k", "-f", "mp3", "-"], { maxBuffer: 1e7 });
  await ago(hours, () => saveLeadFile(db, agent, id, { kind: "call_recording", bytes, name: "call-sample.mp3", ext: "mp3", mime: "audio/mpeg", durationSec: 20, auditAction: "lead.recording_upload" }));
};
async function book(hours, id, projectId, unitNo, by = agent) {
  const unit = await one("select id,base_price from units where project_id=$1 and unit_no=$2", [projectId, unitNo]);
  const { bookingId } = await ago(hours, () => createBooking(db, by, { projectId, leadId: id, unitId: unit.id, tokenAmount: "500000" }));
  return { bookingId, price: Number(unit.base_price) };
}
/** Token → Partial → Complete down payment → Closed Won, with sample proofs and the money posted in Finance. */
async function closeWon(hours, bookingId, price, by = agent) {
  const cash = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash");
  const proof = await screenshot("Sample payment proof", ["> Sample document"]);
  await ago(hours, async () => {
    await advanceBooking(db, by, bookingId, { toStage: "down_payment", proofFileId: (await uploadBookingProof(db, by, bookingId, { bytes: proof, name: "sample-receipt.png" })).id, amount: String(Math.round(price * 0.1)) });
    await uploadSignedBookingForm(db, by, bookingId, { bytes: proof, name: "sample-signed-form.png" });
    await advanceBooking(db, by, bookingId, { toStage: "agreement_pending", proofFileId: (await uploadBookingProof(db, by, bookingId, { bytes: proof, name: "sample-receipt.png" })).id, amount: String(Math.round(price * 0.3)) });
    await uploadSignedBookingForm(db, by, bookingId, { bytes: proof, name: "sample-signed-form.png" });
    await recordPayment(db, admin, { bookingId, type: "down_payment", amount: String(Math.round(price * 0.5)), receivedOn: businessToday(), methodId: cash.id });
    await advanceBooking(db, admin, bookingId, { toStage: "confirmed" });
  });
}

// ---- The scenarios ----
let id;
await add(1, "Hamid Raza", { hours: 1, priority: "high", size: "2 bed" });
await add(2, "Nadia Qureshi", { hours: 3, source: "Website" });
if ((id = await add(3, "Fahad Sheikh", { hours: 50, source: "Google" }))) {
  await call(47, id, "no_answer", "Rang twice, no answer", { stage: "contact_attempted" });
  await followUp(id, pkt(-1, 11), "Call back");
}
if ((id = await add(4, "Sana Malik", { hours: 72, size: "3 bed", priority: "high" }))) {
  await call(70, id, "talked", "Wants a corner unit, asked for the price list", { stage: "contacted", minutes: 5 });
  await followUp(id, dueToday(), "Share price list and payment plan");
}
if ((id = await add(5, "Imran Baig", { hours: 60, source: "WhatsApp" }))) {
  await stage(58, id, "contacted", "Replied on WhatsApp");
  await chat(57, id, "Imran Baig", ["< Is the 2 bed still available?", "> Yes, 780 sq ft, 1st floor", "< Please send the payment plan", "> Sending it now"]);
  await followUp(id, pkt(1, 12), "Send project details / brochure");
}
if ((id = await add(6, "Rabia Anwar", { hours: 120, priority: "high", size: "900 sq ft", budget: "PKR 20–30 million" }))) {
  await call(118, id, "talked", "Investor, looking for rental income", { stage: "qualified_lead", minutes: 9 });
  await recording(117, id);
  await followUp(id, pkt(2, 15), "Arrange a site visit");
}
if ((id = await add(7, "Tariq Mehmood", { hours: 96, source: "Reference" }))) {
  await call(94, id, "talked", "Will visit with family", { stage: "contacted", minutes: 6 });
  await meeting(id, "Site visit with Tariq Mehmood", pkt(1, 16), { hours: 90 });
  await followUp(id, pkt(1, 10), "Confirm the meeting");
}
if ((id = await add(8, "Saima Javed", { hours: 150, size: "2 bed" }))) {
  await call(148, id, "talked", "Happy with the location", { stage: "contacted", minutes: 7 });
  await meeting(id, "Site visit with Saima Javed", pkt(-1, 16), { hours: 100, done: "Liked unit CC-104, wants to think about it" });
  await followUp(id, pkt(1, 17), "Ask for their decision");
}
if ((id = await add(9, "Omar Farooq", { hours: 240, priority: "high", budget: "PKR 10–20 million" }))) {
  await call(238, id, "talked", "Ready to pay the token", { stage: "qualified_lead", minutes: 12 });
  await meeting(id, "Office meeting with Omar Farooq", pkt(-5, 14), { hours: 200, done: "Chose CC-102" });
  await book(90, id, cedar, "CC-102");
}
if ((id = await add(10, "Kiran Shah", { hours: 500, source: "Walk in" }))) {
  await call(498, id, "talked", "Buying to live in", { stage: "qualified_lead", minutes: 10 });
  const b = await book(300, id, cedar, "CC-101");
  await closeWon(100, b.bookingId, b.price);
  await repeat(20, id, "WhatsApp", "Asked about a second unit for her brother");
}
if ((id = await add(11, "Adeel Iqbal", { hours: 200, source: "Email" }))) {
  await call(198, id, "talked", "Moving back from Dubai next year", { stage: "future_opportunity", minutes: 4 });
  await followUp(id, pkt(90, 11), "Call back");
}
if ((id = await add(12, "Zainab Hussain", { hours: 700 }))) {
  await call(698, id, "talked", "Liked the 2 bed, over budget", { stage: "qualified_lead", minutes: 8 });
  await lose(600, id, "Budget mismatch", "Could not stretch to the price");
  await repeat(5, id, "Facebook", "Asked again after seeing the new payment plan", admin);
}
if ((id = await add(13, "Kamran Yousaf", { hours: 400, source: "Google" }))) {
  await call(398, id, "talked", "Only comparing prices", { stage: "contacted", minutes: 3 });
  await lose(300, id, "Not interested", "Not buying this year");
}
if ((id = await add(14, "Faisal Rehman", { hours: 800 }))) {
  await call(798, id, "talked", "Interested in a 3 bed", { stage: "qualified_lead", minutes: 6 });
  await lose(500, id, "Not responding");
  await repeat(60, id, "Walk in", "Came to the office, loan is approved");
  await stage(58, id, "qualified_lead", "Loan approved, reopened");
  await call(57, id, "talked", "Wants a meeting next week", { minutes: 5 });
  await followUp(id, pkt(1, 13), "Arrange a site visit");
}
if ((id = await add(15, "Bushra Aslam", { hours: 350, size: "1 bed" }))) {
  await call(348, id, "talked", "Collecting information", { stage: "contacted", minutes: 4 });
  await repeat(150, id, "Walk in", "Visited the stall, asked for the floor plan");
  await repeat(10, id, "WhatsApp", "Asked if the 1 bed is still available", admin);
  await followUp(id, dueToday(), "Call back");
}
if ((id = await add(16, "Shahid Latif", { hours: 450, priority: "high", budget: "PKR 20–30 million" }))) {
  await call(448, id, "talked", "Wants one apartment to rent out", { stage: "qualified_lead", minutes: 9 });
  await repeat(40, id, "Email", "Asked for the updated price list");
  await followUp(id, pkt(1, 11), "Share price list and payment plan");
}
if ((id = await add(16, "Shahid Latif", { projectId: palm, source: "Walk in", hours: 200, budget: "Above PKR 50 million" }))) {
  await call(198, id, "talked", "Also looking at a villa for family", { stage: "contacted", minutes: 6 });
  await meeting(id, "Villa visit with Shahid Latif", pkt(2, 15), { hours: 100 });
}
await add(16, "Shahid Latif", { projectId: garden, source: "WhatsApp", hours: 6, budget: "Above PKR 50 million" });
if ((id = await add(17, "Asma Khalid", { hours: 14 * 24 }))) await call(12 * 24, id, "talked", "Asked to call after salary", { stage: "contacted", minutes: 2 });
if ((id = await add(18, "Waqas Ahmed", { hours: 24 * 24, source: "Dealers" }))) await call(20 * 24, id, "talked", "Waiting for a property to sell", { stage: "qualified_lead", minutes: 7 });
await add(19, "Mehwish Tariq", { by: agent, hours: 2, source: "Personal", note: "Met at a family function" });
if ((id = await add(20, "Junaid Akram", { hours: 160 }))) {
  await call(158, id, "wrong_number", "Number belongs to someone else", { stage: "contact_attempted" });
  await ago(20, () => markLost(db, agent, id, { lostReasonId: need(reasons, "Invalid number"), note: "Wrong number, no other contact" }));
}
if ((id = await add(21, "Nouman Saeed", { hours: 110, source: "Billboard" }))) await stage(100, id, "qualified_lead");
if ((id = await add(22, "Danish Ali", { by: agent, hours: 70, source: "Personal" }))) await ago(60, () => verifyLead(db, admin, id, { approve: false, note: "Please add the customer's full name and budget" }));
if ((id = await add(23, "Hira Nawaz", { hours: 130, source: "TikTok" }))) {
  await call(128, id, "talked", "Will come on Sunday", { stage: "contacted", minutes: 3 });
  await meeting(id, "Site visit with Hira Nawaz", pkt(-2, 12), { hours: 120, cancelled: "Customer was out of the city" });
  await followUp(id, pkt(-2, 18), "Arrange a site visit");
}
// Straight to a booking with nothing logged: a booking is not contact, so it says "No contact logged".
if ((id = await add(24, "Ghazala Parveen", { hours: 140, source: "Dealers" }))) await book(70, id, cedar, "CC-103");
// Another agent's leads, to show that agents see only their own.
if ((id = await add(30, "Usama Ghani", { owner: agent2, hours: 30 }))) await call(28, id, "talked", "Interested in 3 bed", { stage: "contacted", minutes: 4 }, agent2);
await add(31, "Laiba Noor", { owner: agent2, hours: 4, source: "Website" });
if ((id = await add(32, "Rizwan Haider", { owner: agent2, projectId: palm, hours: 100 }))) await call(98, id, "no_answer", "", { stage: "contact_attempted" }, agent2);

// Volume, so search and filters have something to work on.
const FIRST = ["Ahsan", "Maria", "Salman", "Iqra", "Yasir", "Amna", "Khurram", "Sadia", "Arslan", "Noreen"];
const LAST = ["Butt", "Chaudhry", "Siddiqui", "Abbasi", "Mirza", "Kiyani"];
const SOURCES = ["Facebook", "Website", "WhatsApp", "Google", "Walk in", "Reference", "TikTok"];
const CITIES = ["Islamabad", "Rawalpindi", "Lahore", "Peshawar"];
const BUDGETS = ["Under PKR 10 million", "PKR 10–20 million", "PKR 20–30 million"];
for (let i = 0; i < 30; i += 1) {
  const hours = 10 + i * 5;
  const lead = await add(100 + i, `${FIRST[i % 10]} ${LAST[(i * 5 + Math.floor(i / 10)) % 6]}`, { projectId: i % 3 === 2 ? palm : cedar, hours, source: SOURCES[i % 7], city: CITIES[i % 4], budget: BUDGETS[i % 3], priority: ["low", "medium", "high"][i % 3], size: i % 2 ? undefined : ["1 bed", "2 bed", "3 bed"][i % 3] });
  if (!lead || i % 5 === 0) continue;
  if (i % 5 === 1) await call(hours - 2, lead, "no_answer", "", { stage: "contact_attempted" });
  else {
    await call(hours - 2, lead, "talked", ["Asked for the brochure", "Comparing two projects", "Wants easy instalments"][i % 3], { stage: i % 5 === 4 ? "qualified_lead" : "contacted", minutes: 2 + (i % 6) });
    if (i % 2 === 0) await followUp(lead, pkt(1 + (i % 5), 10 + (i % 7)), "Call back");
  }
}

// ---- Five agents in the team. New logins' passwords go only into .dev-credentials (git-ignored), never to the screen. ----
const extraAgents = [["Demo Agent Three", "agent3@mz.local"], ["Demo Agent Four", "agent4@mz.local"], ["Demo Agent Five", "agent5@mz.local"]];
for (const [name, email] of extraAgents) {
  if (await one("select 1 from users where email=$1", [email])) continue;
  const password = randomBytes(12).toString("base64url");
  await createAccount(db, admin, { name, email, role: "agent", password });
  appendFileSync(".dev-credentials", `\nagent        ${email}        ${password}   # demo data\n`);
}
const team = await one("select id from teams where name='Demo Sales Team'");
if (team) {
  const now = (await q("select user_id from team_members where team_id=$1", [team.id])).map((x) => x.user_id);
  const five = (await q("select id from users where email = any($1)", [["agent1@mz.local", "agent2@mz.local", ...extraAgents.map((x) => x[1])]])).map((x) => x.id);
  await setTeamMembers(db, admin, team.id, { userIds: [...new Set([...now, ...five])] });
}

// ---- Campaigns: the sheets a campaign form would give, through the real import and approval ----
const C_FIRST = ["Ahmed", "Ayesha", "Bilal", "Farah", "Haris", "Hina", "Jawad", "Komal", "Moiz", "Nida", "Omer", "Rida", "Saad", "Tania", "Umer", "Zoya", "Adnan", "Beenish", "Danial", "Erum"];
const C_LAST = ["Awan", "Bhatti", "Cheema", "Dar", "Gillani", "Hashmi", "Janjua", "Khan"];
const customer = (n) => ({ first: C_FIRST[n % 20], last: C_LAST[(Math.floor(n / 20) + n) % 8], phone: `3000003${String(n).padStart(3, "0")}` });
const HEAD = ["first_name", "last_name", "phone_country_code", "phone", "email", "source", "campaign", "city", "budget", "property_type", "size", "priority", "note"];
const csvOf = (rows) => [HEAD, ...rows].map((x) => x.map((v) => (/[",]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n") + "\r\n";
const campaignRow = (n, campaign, source, [type, size], i) => {
  const c = customer(n);
  return [c.first, c.last, "+92", c.phone, `${c.first}.${c.last}${n}@example.com`.toLowerCase(), source, campaign, CITIES[n % 4], [...BUDGETS, "PKR 30–50 million"][i % 4], type, size, ["high", "medium", "low"][i % 3], ["Wants easy instalments", "Call after 6 PM", "", "Overseas, replies on WhatsApp", ""][i % 5]];
};
const HOUSES = [["House", "5 marla"], ["House", "10 marla"], ["House", "1 kanal"], ["House", "20 marla"], ["House", "7 marla"], ["House", "Other / not sure"]];
const PLOTS = [["Plot", "5 marla"], ["Plot", "1 kanal"], ["Plot", "10 marla"], ["Plot", "5,000 sq ft"], ["Plot", "3 marla"]];
const FLATS = [["Apartment", "900 sq ft"], ["Apartment", "640 sq ft"], ["Apartment", "2 bed"], ["Apartment", "1,150 sq ft"]];
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const campaigns = [
  // The second and third reach some of the first's customers again: one client, several leads.
  { file: "campaign-1-houses.csv", name: "Nov Houses Launch", source: "Facebook", projectId: palm, kinds: HOUSES, who: range(0, 55), hours: 9 * 24 },
  { file: "campaign-2-plots.csv", name: "1 Kanal Plots", source: "Google", projectId: plots, kinds: PLOTS, who: [...range(0, 15), ...range(55, 95)], hours: 6 * 24 },
  { file: "campaign-3-apartments.csv", name: "Property Expo", source: "Walk in", projectId: cedar, kinds: FLATS, who: [...range(5, 15), ...range(95, 130)], hours: 3 * 24 },
];
mkdirSync("docs/demo", { recursive: true });
const worked = new Map();
const ownerActor = async (id) => worked.get(id) ?? (worked.set(id, await loadActor(db, await one("select id,name,email,role from users where id=$1", [id]))), worked.get(id));
for (const c of campaigns) {
  const csv = csvOf(c.who.map((n, i) => campaignRow(n, c.name, c.source, c.kinds[i % c.kinds.length], i)));
  writeFileSync("docs/demo/" + c.file, csv);
  if (await one("select 1 from leads where campaign=$1 and project_id=$2", [c.name, c.projectId])) continue;
  await ago(c.hours, async () => {
    const b = await submitImport(db, admin, { projectId: c.projectId, fileName: c.file, csv });
    const d = await decideImportBatch(db, admin, b.batchId, { approve: true });
    console.log(c.file, { rows: b.totalRows, created: d.created, skipped: d.skipped, repeats: d.repeats });
    made += d.created;
  });
  const list = await q("select id, owner_id, name from leads where campaign=$1 and project_id=$2 order by phone_e164", [c.name, c.projectId]);
  for (const [i, l] of list.entries()) {
    if (!l.owner_id) continue;
    const by = await ownerActor(l.owner_id);
    const h = c.hours - 3 - (i % 10);
    const k = i % 10;
    if (k < 2) continue;
    if (k < 4) await call(h, l.id, ["no_answer", "busy"][k - 2], "", { stage: "contact_attempted" }, by);
    else if (k < 7) {
      await call(h, l.id, "talked", ["Asked for the payment plan", "Comparing with another project", "Will decide with family"][k - 4], { stage: k === 6 ? "qualified_lead" : "contacted", minutes: 2 + k }, by);
      await followUp(l.id, pkt(1 + (i % 4), 10 + k), "Call back", by);
    } else if (k === 7) {
      await call(h, l.id, "talked", "Wants to see it", { stage: "qualified_lead", minutes: 8 }, by);
      await meeting(l.id, `Site visit with ${l.name}`, pkt(1 + (i % 3), 15), { hours: h - 1, by });
    } else if (k === 8) {
      await call(h, l.id, "talked", "Interested, visited the site", { stage: "contacted", minutes: 6 }, by);
      await meeting(l.id, `Site visit with ${l.name}`, pkt(-1, 15), { hours: h - 1, by, done: "Liked it, discussing price" });
      await followUp(l.id, pkt(1, 17), "Ask for their decision", by);
    } else {
      await call(h, l.id, "talked", "Not buying now", { stage: "contacted", minutes: 2 }, by);
      await lose(h - 2, l.id, ["Budget mismatch", "Bought elsewhere", "Not interested"][Math.floor(i / 10) % 3], "");
    }
  }
}
// One campaign customer from the sheet to Closed Won: imported, assigned, called, met, booked a 1 kanal house, paid.
const done = await one("select id, owner_id from leads where campaign=$1 and project_id=$2 and size_sqft=4500 and stage='meeting_done' and not exists (select 1 from bookings b where b.lead_id=leads.id) order by phone_e164 limit 1", [campaigns[0].name, palm]);
if (done && !(await one("select 1 from bookings b join leads l on l.id=b.lead_id where l.campaign=$1", [campaigns[0].name]))) {
  const by = await ownerActor(done.owner_id);
  const b = await book(20, done.id, palm, "PC-210", by);
  await closeWon(4, b.bookingId, b.price, by);
}
// For the live import: new customers, a known one, a repeated number, an unclear size and a wrong number.
writeFileSync("docs/demo/campaign-4-live.csv", csvOf([
  ...range(200, 212).map((n, i) => campaignRow(n, "Farmhouse Weekend", "TikTok", [["Farmhouse", "1 kanal"], ["Farmhouse", "2 kanal"], ["Farmhouse", "4 kanal"]][i % 3], i)),
  campaignRow(0, "Farmhouse Weekend", "TikTok", ["Farmhouse", "1 kanal farmhouse"], 0),
  campaignRow(212, "Farmhouse Weekend", "TikTok", ["", "1 kanal house"], 1),
  campaignRow(213, "Farmhouse Weekend", "TikTok", ["Farmhouse", "big one"], 2),
  campaignRow(200, "Farmhouse Weekend", "TikTok", ["Farmhouse", "2 kanal"], 3),
  campaignRow(214, "Farmhouse Weekend", "TikTok", ["Farmhouse", "1 kanal"], 4).map((v, i) => (i === 3 ? "12" : v)),
]));

// Sizes the earlier demo customers gave as bedrooms, put as real sizes.
const { updateLead } = await imp("modules/leads/commands.ts");
for (const [was, size] of [["1 bed", "520 sq ft"], ["2 bed", "780 sq ft"], ["3 bed", "1,150 sq ft"]])
  for (const l of await q("select id from leads where desired_size=$1 and stage not in ('booked') and phone_e164 like '+923000002%' and phone_e164 <> '+923000002008'", [was])) await updateLead(db, admin, l.id, { desiredSize: size, propertyType: "apartment" });

// Only the repeat enquiries and decisions stay unread: 50 assignments would bury them.
await q("update notifications set read_at=now() where type='lead_assigned' and read_at is null and link in (select '/dashboard/leads/'||id from leads where phone_e164 like '+923000002%')");

// ---- Dates that must stay "overdue", "today" and "tomorrow" on the day of the demo ----
const leadOf = (n, projectId = cedar) => one("select id from leads where project_id=$1 and phone_e164=$2", [projectId, `+92${phoneOf(n).slice(1)}`]);
for (const [n, due] of [[3, pkt(-1, 11)], [4, dueToday()], [5, pkt(1, 12)], [6, pkt(2, 15)], [7, pkt(1, 10)], [8, pkt(1, 17)], [14, pkt(1, 13)], [15, dueToday()], [16, pkt(1, 11)], [23, pkt(-2, 18)]]) {
  const l = await leadOf(n);
  await q("update follow_ups set due_at=$2 where lead_id=$1 and status='pending'", [l.id, due]);
  await refreshNext(l.id);
}
await q("update meetings set starts_at=$2 where lead_id=$1 and status='scheduled'", [(await leadOf(7)).id, pkt(1, 16)]);
await q("update meetings set starts_at=$2 where lead_id=$1 and status='scheduled'", [(await leadOf(16, palm)).id, pkt(2, 15)]);

console.log(`Added ${made} leads. Dates refreshed.`);
console.table(await q("select p.name project, l.stage, count(*)::int n from leads l join projects p on p.id=l.project_id where l.phone_e164 like '+923000002%' group by 1,2 order by 1,2"));
await pool.end();
