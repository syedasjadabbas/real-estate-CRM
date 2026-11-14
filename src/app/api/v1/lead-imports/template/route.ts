import { NextResponse } from "next/server";
import { canSubmitImport, LEAD_IMPORT_COLUMNS } from "@/modules/leads/imports";
import { requireActor } from "@/server/auth/current-user";
import { errorResponse } from "@/server/http";
import { forbidden } from "@/server/errors";

/** Sample rows only: made-up names and numbers (the repository is public). */
const EXAMPLES: Record<(typeof LEAD_IMPORT_COLUMNS)[number], string>[] = [
  { name: "Sample Buyer", phone_country_code: "+92", phone: "3001234567", phone2: "", phone3: "", phone4: "", phone5: "", email: "buyer@example.com", source: "Facebook", city: "Islamabad", budget: "", priority: "high", size: "500 sq ft", gender: "male", note: "Wants a 1-bed apartment" },
  { name: "Second Sample", phone_country_code: "+92", phone: "3217654321", phone2: "3331112222", phone3: "", phone4: "", phone5: "", email: "", source: "Walk in", city: "Lahore", budget: "", priority: "", size: "", gender: "female", note: "" },
];

/** GET: the lead import template, the exact columns the import expects plus two sample rows (Admin and Super Admin). */
export async function GET() {
  try {
    const actor = await requireActor();
    if (!canSubmitImport(actor)) throw forbidden();
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [LEAD_IMPORT_COLUMNS.join(","), ...EXAMPLES.map((r) => LEAD_IMPORT_COLUMNS.map((c) => esc(r[c])).join(","))];
    return new NextResponse(lines.join("\r\n") + "\r\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="lead-import-template.csv"' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
