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

/**
 * FR-081 hold chip. "expired": the Reserved-until date has passed with no payment, so the hourly
 * release job will cancel the booking and free the unit. "overdue": the date has passed but a payment
 * is recorded, so it is not released automatically.
 */
export function HoldChip({ state }: { state: "expired" | "overdue" | null }) {
  if (!state) return null;
  const expired = state === "expired";
  return (
    <span
      title={expired ? "No payment recorded: the unit is released automatically within the hour." : "A payment is recorded, so this hold is not released automatically."}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black tracking-[0.05em] whitespace-nowrap uppercase",
        expired ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800",
      )}
    >
      {expired ? "Hold expired · releasing" : "Hold overdue"}
    </span>
  );
}
