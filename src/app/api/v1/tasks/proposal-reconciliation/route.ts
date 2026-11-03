import { applyProposalReconciliation, proposalReconciliationReport } from "@/modules/tasks/price-sync";
import { apiRoute } from "@/server/http";

/** GET — dry-run report of saved plans whose unit price changed (Q47). POST — apply it (Admin / Super Admin; idempotent). */
export const GET = apiRoute(async ({ db, actor }) => proposalReconciliationReport(db, actor));
export const POST = apiRoute(async ({ db, actor }) => applyProposalReconciliation(db, actor));
