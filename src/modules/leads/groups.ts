import { and, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { leads } from "@/server/db/schema";
import { IN_PROGRESS_STAGES } from "./constants";

/**
 * The client's groups of stages (25 Nov 2026). New: not opened by its agent yet. Open: opened, plus Contact
 * Attempted and Contacted. In progress: Qualified up to Booking in Process. Future Opportunity, Won and Lost
 * stand alone, so the groups add up to the total.
 */
export const unopenedLeads = (): SQL => and(eq(leads.stage, "new_lead"), isNull(leads.openedAt))!;
export const openLeads = (): SQL => or(and(eq(leads.stage, "new_lead"), isNotNull(leads.openedAt)), inArray(leads.stage, ["contact_attempted", "contacted"]))!;
export const inProgressLeads = (): SQL => inArray(leads.stage, [...IN_PROGRESS_STAGES]);
