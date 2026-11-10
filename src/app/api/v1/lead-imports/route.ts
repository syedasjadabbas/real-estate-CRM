import { listImportBatches, submitImport } from "@/modules/leads/imports";
import { apiRoute, readJson } from "@/server/http";

/** GET — your batches (Super Admin: all). POST { projectId, fileName?, csv } — submit a batch for approval. */
export const GET = apiRoute(async ({ db, actor }) => listImportBatches(db, actor));
export const POST = apiRoute(async ({ req, db, actor }) => submitImport(db, actor, await readJson(req)), 201);
