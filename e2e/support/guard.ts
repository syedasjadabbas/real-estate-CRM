import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The end-to-end suite only ever touches the separate test database. It refuses to run when
 * TEST_DATABASE_URL is missing, equals DATABASE_URL, or names a database without "test" in it,
 * because setup and teardown truncate every table there.
 */
export function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // CI: rely on the shell environment
  }
}

export function testDatabaseUrl() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("[e2e] TEST_DATABASE_URL is not set; the end-to-end suite needs the separate test database.");
  if (url === process.env.DATABASE_URL) throw new Error("[e2e] TEST_DATABASE_URL must not be the development database.");
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/test/i.test(name)) throw new Error(`[e2e] Refusing to use database "${name}": its name must contain "test".`);
  return url;
}

/** Private upload folder for the e2e server, outside the project and outside public/. */
export const E2E_STORAGE_DIR = path.join(tmpdir(), "mz-crm-e2e-storage");
export const E2E_PORT = 3300;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
