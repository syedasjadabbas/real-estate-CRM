import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "./badge";

const iconTones: Record<Tone, string> = {
  brand: "border-brand/30 bg-brand-50 text-brand",
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-600",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-600",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  dark: "border-zinc-950 bg-zinc-950 text-white",
};

const labelTones: Record<Tone, string> = {
  brand: "text-brand",
  neutral: "text-zinc-500",
  amber: "text-amber-700",
  rose: "text-rose-600",
  sky: "text-sky-700",
  dark: "text-zinc-950",
};

/**
 * Executive-essentials KPI card: icon box + category pill, coloured caption,
 * 30px value, sub-caption, optional footer (e.g. stacked bar). With `href` the card opens that list.
 */
export function KpiCard({
  icon: Icon,
  tone = "brand",
  category,
  label,
  value,
  caption,
  footer,
  className,
  href,
  linkLabel,
}: {
  href?: string;
  linkLabel?: string;
  icon: LucideIcon;
  tone?: Tone;
  category: string;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const content = (
    <div
      data-kpi={label}
      className={cn(
        "flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline transition-shadow hover:shadow-md hover:shadow-zinc-950/5",
        className,
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-xl border shadow-hairline",
              iconTones[tone],
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <Badge tone={tone}>{category}</Badge>
        </div>
        <p
          className={cn(
            "mt-3 text-[10px] leading-[15px] font-black tracking-[0.14em] uppercase",
            labelTones[tone],
          )}
        >
          {label}
        </p>
        <div className="mt-1.5">
          <div data-kpi-value className="text-3xl leading-9 font-black tracking-[-0.025em] tabular-nums">{value}</div>
          {caption ? <div className="text-xs leading-4 font-medium text-zinc-600">{caption}</div> : null}
        </div>
      </div>
      {footer ? <div className="pt-3">{footer}</div> : null}
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block rounded-2xl focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none [&>div]:h-full">
      {content}
      <span className="sr-only">{linkLabel ?? `Open ${label}`}</span>
    </Link>
  );
}

/** Small white stat card ("TEAMS 0 · Avg score 0"). */
export function MiniStat({
  label,
  value,
  caption,
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200/80 bg-white px-3 py-2.5 shadow-hairline",
        className,
      )}
    >
      <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">
        {label}
      </p>
      <p className="text-lg leading-[18px] font-black tabular-nums">{value}</p>
      {caption ? (
        <p className="text-[10px] leading-[15px] font-semibold text-zinc-600">{caption}</p>
      ) : null}
    </div>
  );
}

/** Flat grey summary tile inside widgets ("TOTAL 2,680", "TOP Old CRM (Meta)"). */
export function SummaryTile({
  label,
  value,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg bg-zinc-50 px-2.5 py-2", className)}>
      <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">
        {label}
      </p>
      <p
        className={cn(
          "truncate",
          accent
            ? "text-sm leading-[17.5px] font-bold text-brand"
            : "text-lg leading-[18px] font-black tabular-nums",
        )}
      >
        {value}
      </p>
    </div>
  );
}
