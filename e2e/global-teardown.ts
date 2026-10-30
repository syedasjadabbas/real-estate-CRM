import { rm } from "node:fs/promises";
import { connectTestDb, resetDb } from "../tests/support/db";
import { E2E_STORAGE_DIR, testDatabaseUrl } from "./support/guard";

/** Removes everything the run created: the TEST database rows and the temporary upload folder. */
export default async function globalTeardown() {
  testDatabaseUrl(); // same guard: never the development database
  const { db, close } = connectTestDb();
  try {
    await resetDb(db);
  } finally {
    await close();
  }
  await rm(E2E_STORAGE_DIR, { recursive: true, force: true });
}
