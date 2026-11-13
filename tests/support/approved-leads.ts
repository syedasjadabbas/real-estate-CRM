import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import { leads, notifications } from "@/server/db/schema";

/**
 * Lead verification (13 Nov 2026) holds an agent's new lead until an Admin or Super Admin approves it.
 * Tests written before that rule exercise what happens after approval, so their agent-created leads
 * start approved. tests/integration/lead-verification.test.ts sets `keepLeadsPending` to test the rule.
 */
export const verificationMode = { keepLeadsPending: false };

vi.mock("@/modules/leads/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/leads/commands")>();
  return {
    ...actual,
    createLead: async (...args: Parameters<typeof actual.createLead>) => {
      const out = await actual.createLead(...args);
      if (out.outcome === "created" && out.verification === "pending" && !verificationMode.keepLeadsPending) {
        await args[0].update(leads).set({ verification: "approved" }).where(eq(leads.id, out.leadId));
        // ...and without the "lead to verify" notices its creation sent to Admins.
        await args[0].delete(notifications).where(and(eq(notifications.type, "lead_verification_requested"), eq(notifications.link, `/dashboard/leads/${out.leadId}`)));
        return { ...out, verification: "approved" as const };
      }
      return out;
    },
  };
});
