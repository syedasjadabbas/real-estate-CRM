import { cn } from "@/lib/cn";
import { BOOKING_STAGE_LABELS, type BookingStage } from "@/modules/bookings/constants";

/** Uppercase booking stage pill in the Leads stage-pill style; Confirmed green, Cancelled rose. */
export function BookingStagePill({ stage, className }: { stage: BookingStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] whitespace-nowrap uppercase",
        stage === "confirmed" ? "bg-brand-50 text-brand-700" : stage === "cancelled" ? "bg-rose-50 text-rose-700" : "bg-zinc-100 text-zinc-800",
        className,
      )}
    >
      {BOOKING_STAGE_LABELS[stage]}
    </span>
  );
}

/** Amber "hold overdue" chip: the entered Reserved-until date has passed while the token is still pending. */
export function HoldOverdueChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black tracking-[0.05em] whitespace-nowrap text-amber-800 uppercase">
      Hold overdue
    </span>
  );
}
