import { cn } from "@/lib/cn";
import { UNIT_STATUS_LABELS, type UnitStatus } from "@/modules/inventory/constants";

const tones: Record<UnitStatus, string> = {
  available: "bg-brand-50 text-brand-700",
  partially_booked: "bg-sky-50 text-sky-700",
  reserved: "bg-amber-50 text-amber-800",
  booked: "bg-zinc-100 text-zinc-800",
  sold: "bg-zinc-100 text-zinc-800",
};

/** Uppercase unit status pill in the Leads stage-pill style. */
export function UnitStatusPill({ status, className }: { status: UnitStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] whitespace-nowrap uppercase",
        tones[status],
        className,
      )}
    >
      {UNIT_STATUS_LABELS[status]}
    </span>
  );
}
