import { cn } from "@/lib/cn";
import type { InterestStatus } from "@/modules/clients/queries";

const STYLE: Record<InterestStatus, string> = {
  booked: "bg-brand/10 text-brand",
  interested: "bg-zinc-100 text-zinc-800",
  lost: "bg-zinc-50 text-zinc-400 line-through decoration-zinc-300",
};
export const INTEREST_LABEL: Record<InterestStatus, string> = { booked: "Booked", interested: "Interested", lost: "Lost interest" };

/** One project a client enquired in: booked (green), still interested, or lost interest (greyed). */
export function InterestChip({ projectName, status }: { projectName: string; status: InterestStatus }) {
  return (
    <span
      title={`${INTEREST_LABEL[status]} · ${projectName}`}
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", STYLE[status])}
    >
      {status === "booked" ? "Booked · " : null}
      {projectName}
      <span className="sr-only"> ({INTEREST_LABEL[status]})</span>
    </span>
  );
}

/** Status tag for a project group on the client page. */
export function InterestStatusTag({ status }: { status: InterestStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.05em] uppercase",
        status === "booked" ? "bg-brand/10 text-brand" : status === "lost" ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-800",
      )}
    >
      {INTEREST_LABEL[status]}
    </span>
  );
}
