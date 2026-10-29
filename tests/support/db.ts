import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Database } from "@/server/db";
import * as schema from "@/server/db/schema";
import { loadActor } from "@/server/auth/session-store";
import { hashPassword } from "@/server/auth/password";
import type { Actor, Role } from "@/server/auth/types";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export function connectTestDb() {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema }) as unknown as Database;
  return { db, close: () => pool.end() };
}

const TABLES = [
  "audit_logs",
  "task_history",
  "task_installment_rows",
  "tasks",
  "app_settings",
  "payment_reversal_requests",
  "booking_payments",
  "finance_settings",
  "booking_stage_history",
  "bookings",
  "units",
  "client_follow_ups",
  "client_activities",
  "clients",
  "approvals",
  "lead_reviews",
  "lead_favorites",
  "follow_ups",
  "lead_activities",
  "leads",
  "rotation_state",
  "team_members",
  "teams",
  "signin_logs",
  "sessions",
  "users",
  "projects",
  "lead_sources",
  "cities",
  "lost_reasons",
  "budget_ranges",
];

export async function resetDb(db: Database) {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

export type Fixture = {
  projectId: string;
  otherProjectId: string;
  sourceId: string;
  cityId: string;
  lostReasonId: string;
  actors: Record<"superAdmin" | "manager" | "agent1" | "agent2" | "outsideAgent" | "hr", Actor>;
  passwords: { agent1: string };
};

/** Two-agent team with a manager, an agent outside the team, an HR user, one project. */
export async function seedFixture(db: Database): Promise<Fixture> {
  const [project] = await db.insert(schema.projects).values({ name: "Test Project" }).returning();
  const [otherProject] = await db.insert(schema.projects).values({ name: "Other Project" }).returning();
  const [source] = await db.insert(schema.leadSources).values({ name: "Facebook" }).returning();
  const [city] = await db.insert(schema.cities).values({ name: "Islamabad" }).returning();
  const [reason] = await db.insert(schema.lostReasons).values({ name: "Not interested" }).returning();

  const passwordHash = await hashPassword("correct-horse-battery");
  const make = async (name: string, email: string, role: Role) => {
    const [u] = await db.insert(schema.users).values({ name, email, role, passwordHash }).returning();
    return u;
  };
  const superAdmin = await make("Super Admin", "sa@test.local", "super_admin");
  const manager = await make("Manager", "manager@test.local", "manager");
  const agent1 = await make("Agent A", "agent1@test.local", "agent");
  const agent2 = await make("Agent B", "agent2@test.local", "agent");
  const outside = await make("Agent Outside", "outside@test.local", "agent");
  const hr = await make("HR", "hr@test.local", "hr");

  const [team] = await db.insert(schema.teams).values({ name: "Team 1", managerId: manager.id }).returning();
  const [otherTeam] = await db.insert(schema.teams).values({ name: "Team 2" }).returning();
  await db.insert(schema.teamMembers).values([
    { teamId: team.id, userId: manager.id },
    { teamId: team.id, userId: agent1.id },
    { teamId: team.id, userId: agent2.id },
    { teamId: otherTeam.id, userId: outside.id },
  ]);

  const actor = (u: typeof superAdmin) => loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  return {
    projectId: project.id,
    otherProjectId: otherProject.id,
    sourceId: source.id,
    cityId: city.id,
    lostReasonId: reason.id,
    actors: {
      superAdmin: await actor(superAdmin),
      manager: await actor(manager),
      agent1: await actor(agent1),
      agent2: await actor(agent2),
      outsideAgent: await actor(outside),
      hr: await actor(hr),
    },
    passwords: { agent1: "correct-horse-battery" },
  };
}

let phoneCounter = 1_000_000;
export function leadInput(f: Fixture, overrides: Record<string, unknown> = {}) {
  phoneCounter += 1;
  return {
    projectId: f.projectId,
    name: "Test Lead",
    phoneCountryCode: "+92",
    phoneNumber: `0300${phoneCounter}`,
    sourceId: f.sourceId,
    cityId: f.cityId,
    ...overrides,
  };
}
