// Applies versioned SQL migrations from ./drizzle.
// Usage: npm run db:migrate            (DATABASE_URL)
//        npm run db:migrate -- --test  (TEST_DATABASE_URL)
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on shell environment
}

const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(`${useTest ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set (see docs/LEADS_MODULE_PLAN.md §9).`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log(`Migrations applied to ${useTest ? "test" : "development"} database.`);
} finally {
  await pool.end();
}
