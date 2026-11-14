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

/**
 * Bookings (14 Nov 2026): each down payment move needs the amount and a new payment proof, and leaving
 * Partial or Complete Down Payment needs the booking form signed in that stage. Tests written before
 * those rules move bookings without them, so the moves get placeholder rows (no stored files).
 * tests/integration/booking-steps.test.ts sets `requirePaperwork` to test the rules themselves.
 */
export const bookingMode = { requirePaperwork: false };

vi.mock("@/modules/bookings/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/bookings/commands")>();
  const { bookings, files } = await import("@/server/db/schema");
  return {
    ...actual,
    advanceBooking: async (...args: Parameters<typeof actual.advanceBooking>) => {
      const [db, actor, bookingId, input] = args;
      const move = { ...((input ?? {}) as Record<string, unknown>) } as { toStage?: string; proofFileId?: string | null; amount?: unknown };
      if (bookingMode.requirePaperwork) return actual.advanceBooking(...args);
      const [b] = await db.select({ leadId: bookings.leadId, stage: bookings.stage }).from(bookings).where(eq(bookings.id, bookingId));
      if (!b) return actual.advanceBooking(...args);
      const row = (kind: "document" | "receipt") => ({
        bookingId,
        leadId: b.leadId,
        kind,
        storageKey: `test-placeholder/${crypto.randomUUID()}.pdf`,
        originalName: kind === "document" ? "signed-form.pdf" : "proof.pdf",
        mime: "application/pdf",
        sizeBytes: 1,
        sha256: "test",
        uploadedById: actor.id,
      });
      if ((b.stage === "down_payment" || b.stage === "agreement_pending") && move.toStage !== "cancelled") await db.insert(files).values(row("document"));
      if ((move.toStage === "down_payment" || move.toStage === "agreement_pending") && !move.proofFileId) {
        const [proof] = await db.insert(files).values(row("receipt")).returning({ id: files.id });
        move.proofFileId = proof.id;
        move.amount ??= 1;
      }
      return actual.advanceBooking(db, actor, bookingId, move);
    },
  };
});
