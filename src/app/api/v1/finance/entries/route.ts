import { createEntry, listEntries } from "@/modules/finance/entries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET ?kind&categoryId&from&to&voided — income / expense entries (finance view roles). POST — record one (FR-200 / FR-201). */
export const GET = apiRoute(async ({ req, db, actor }) => listEntries(db, actor, queryObject(req)));
export const POST = apiRoute(async ({ req, db, actor }) => createEntry(db, actor, await readJson(req)), 201);
