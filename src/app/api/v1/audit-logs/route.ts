import { listAuditLogs } from "@/modules/audit/service";
import { apiRoute } from "@/server/http";

/** GET ?q=&actor=&entity=&action=&from=&to=&sort=&dir=&page= — audit log, Super Admin and Admin only (read-only: no other method). */
export const GET = apiRoute(async ({ req, db, actor }) => listAuditLogs(db, actor, Object.fromEntries(req.nextUrl.searchParams)));
