// Demo data: made-up customers covering every Leads scenario, through the app's own commands so the
// timelines, notifications and rules are the real ones. Local database only, unless DEMO_DATA_DB names another.
//   node --experimental-transform-types --no-warnings scripts/demo/demo-data.mjs
// Run it again on the day of the demo: nobody is added twice, the "today" and "tomorrow" dates move to today.
// Numbers are +92 300 0002xxx and emails example.com, so nobody real is contacted.
import { createRequire, registerHooks } from "node:module";
import { existsSync } from "node:fs";
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
const { createProject } = await imp("modules/projects/commands.ts");
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
  leads: ["created_at", "stage_changed_at", "first_touch_at", "last_activity_at", "last_contact_at", "regenerated_at", "updated_at"],
  lead_activities: ["created_at"], lead_enquiries: ["created_at", "enquired_at"], lead_assignments: ["created_at"], follow_ups: ["created_at", "done_at"],
  meetings: ["created_at", "completed_at"], files: ["created_at"], clients: ["created_at", "last_activity_at"], client_activities: ["created_at"],
  bookings: ["created_at", "stage_changed_at", "confirmed_at"], booking_stage_history: ["created_at"], approvals: ["created_at"], notifications: ["created_at"],
};
const columns = new Set((await q("select table_name||'.'||column_name c from information_schema.columns where table_schema='public'")).map((r) => r.c));
async function ago(hours, step) {
  const t0 = new Date(Date.now() - 20);
  const out = await step();
  const back = `${Math.round(hours * 3600)} seconds`;
  for (const [table, cols] of Object.entries(STAMPS))
    for (const c of cols) if (columns.has(`${table}.${c}`)) await q(`update ${table} set ${c}=${c}-$2::interval where ${c}>=$1 and ${c}<=now()`, [t0, back]);
  return out;
}

async function project(name, type, city, prefix) {
  let p = await one("select id from projects where name=$1", [name]);
  if (!p) p = { id: (await createProject(db, admin, { name, type, city, developer: "Demo Developer", description: "Made-up project for demonstration" })).projectId };
  for (let i = 1; i <= 6; i += 1) {
    const unitNo = `${prefix}-${100 + i}`;
    if (await one("select 1 from units where project_id=$1 and unit_no=$2", [p.id, unitNo])) continue;
    const area = [520, 640, 780, 900, 1150, 1400][i - 1];
    await createUnit(db, admin, { projectId: p.id, unitNo, floor: i < 4 ? "1st Floor" : "2nd Floor", areaSqft: String(area), basePrice: String(area * 18_000), nature: "Apartment", bedrooms: String(1 + Math.floor(i / 3)) });
  }
  return p.id;
}
const cedar = await project("Cedar Court Residences", "building", "Islamabad", "CC");
const palm = await project("Palm Court Villas", "society", "Rawalpindi", "PC");
const garden = await project("Garden Court Farmhouses", "farmhouse", "Islamabad", "GC");

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
async function closeWon(hours, bookingId, price) {
  const cash = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash");
  const proof = await screenshot("Sample payment proof", ["> Sample document"]);
  await ago(hours, async () => {
    await advanceBooking(db, agent, bookingId, { toStage: "down_payment", proofFileId: (await uploadBookingProof(db, agent, bookingId, { bytes: proof, name: "sample-receipt.png" })).id, amount: String(Math.round(price * 0.1)) });
    await uploadSignedBookingForm(db, agent, bookingId, { bytes: proof, name: "sample-signed-form.png" });
    await advanceBooking(db, agent, bookingId, { toStage: "agreement_pending", proofFileId: (await uploadBookingProof(db, agent, bookingId, { bytes: proof, name: "sample-receipt.png" })).id, amount: String(Math.round(price * 0.3)) });
    await uploadSignedBookingForm(db, agent, bookingId, { bytes: proof, name: "sample-signed-form.png" });
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
