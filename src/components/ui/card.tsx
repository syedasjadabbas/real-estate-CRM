import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Base white surface: 16px radius, hairline border and shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-zinc-200/80 bg-white shadow-hairline", className)}
      {...props}
    />
  );
}

type HeaderProps = {
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Compact widget header (14px title) — "Recent leads", "Lead sources". */
export function CardHeader({ title, badge, description, actions, className }: HeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm leading-5 font-black">{title}</h3>
          {badge}
        </div>
        {description ? (
          <p className="text-[11px] leading-[16.5px] text-zinc-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Large section card (24px radius, 18px title) — "Team performance scores". */
export function Panel({
  title,
  badge,
  description,
  actions,
  className,
  bodyClassName,
  children,
}: HeaderProps & { bodyClassName?: string; children?: ReactNode }) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-hairline",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-6 py-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg leading-7 font-black tracking-[-0.025em]">
            <span>{title}</span>
            {badge}
          </h2>
          {description ? <p className="text-sm text-zinc-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("flex-1 px-6 py-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small uppercase green section caption ("ORGANIZATION HEALTH", "MY TARGETS"). */
export function Eyebrow({
  className,
  tone = "brand",
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: "brand" | "muted" }) {
  return (
    <p
      className={cn(
        "text-[10px] leading-[15px] font-black tracking-[0.2em] uppercase",
        tone === "brand" ? "text-brand" : "text-zinc-600",
        className,
      )}
      {...props}
    />
  );
}
