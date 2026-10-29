import { STAGE_LABELS, type LeadStage } from "@/modules/leads/constants";
import { cn } from "@/lib/cn";

/** Uppercase stage pill (reference table: zinc-100 bg, 10px/900). Lost and Booked are tinted. */
export function StagePill({ stage, className }: { stage: LeadStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] whitespace-nowrap uppercase",
        stage === "lost_lead"
          ? "bg-rose-50 text-rose-700"
          : stage === "booked"
            ? "bg-brand-50 text-brand-700"
            : "bg-zinc-100 text-zinc-800",
        className,
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

/** Green uppercase source pill (reference). */
export function SourcePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] whitespace-nowrap text-brand-700 uppercase">
      {children}
    </span>
  );
}
