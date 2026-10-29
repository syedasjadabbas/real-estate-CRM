import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Applies migrations to the test database once per run (skipped when it isn't configured). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("\n[tests] TEST_DATABASE_URL not set — database integration tests will be skipped.\n");
    return;
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must point to a separate database (tests truncate all tables).");
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
