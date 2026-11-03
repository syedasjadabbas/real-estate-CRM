import { createAccount } from "@/modules/accounts/service";
import { apiRoute, readJson } from "@/server/http";

/** POST { name, email, role, password } — create a CRM account (Admin, Super Admin; Q2). */
export const POST = apiRoute(async ({ req, db, actor }) => createAccount(db, actor, await readJson(req)), 201);
