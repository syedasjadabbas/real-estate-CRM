import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { mzPool?: Pool };

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see docs/LEADS_MODULE_PLAN.md §9).");
  }
  return new Pool({ connectionString, max: 10 });
}

/** Lazily created pool, reused across hot reloads in development. */
function pool() {
  globalForDb.mzPool ??= createPool();
  return globalForDb.mzPool;
}

let instance: Database | undefined;

export function getDb(): Database {
  instance ??= drizzle(pool(), { schema });
  return instance;
}

export { schema };
