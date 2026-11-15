import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** "Download CSV" for an HR list, carrying the page's current filters (15 Nov 2026). */
export function CsvDownload({ kind, params = {}, label = "Download CSV" }: { kind: string; params?: Record<string, string | undefined>; label?: string }) {
  const query = new URLSearchParams({ kind });
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") query.set(k, v);
  return (
    <a href={`/api/v1/hr/export?${query}`} download className={buttonClasses({ variant: "secondary", size: "md" })}>
      <Download aria-hidden="true" className="size-4" />
      {label}
    </a>
  );
}
