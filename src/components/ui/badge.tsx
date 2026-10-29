import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Tone = "brand" | "neutral" | "amber" | "rose" | "sky" | "dark";

/** Uppercase pill used beside widget titles and on KPI cards ("PIPELINE", "LIVE"). */
const pillTones: Record<Tone, string> = {
  brand: "border-brand/20 bg-brand-50 text-brand-700",
  neutral: "border-zinc-200/80 bg-zinc-100 text-zinc-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  dark: "border-zinc-950 bg-zinc-950 text-white",
};

export function Badge({
  tone = "brand",
  bordered = true,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; bordered?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] leading-[13.5px] font-black tracking-[0.05em] whitespace-nowrap uppercase",
        bordered ? "border" : "border border-transparent",
        pillTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Sentence-case status chip used in tables ("Contact Attempted"). */
const tagTones: Record<Tone, string> = {
  brand: "border-brand/25 bg-brand-50 text-brand",
  neutral: "border-zinc-200/80 bg-zinc-50 text-zinc-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  dark: "border-zinc-950 bg-zinc-950 text-white",
};

export function StatusTag({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] leading-[13.5px] font-bold whitespace-nowrap",
        tagTones[tone],
        className,
      )}
      {...props}
    />
  );
}
