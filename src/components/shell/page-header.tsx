import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Module page header card, measured from the reference module pages:
 * white 24px-radius card, 32px green icon box, 20px title, 12px description, actions on the right.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  as: Heading = "h1",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  /** Section headers inside a module page use h2 with the same card styling. */
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-hairline",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon aria-hidden="true" className="size-4" />
            </span>
          ) : null}
          <Heading className="text-xl leading-7 font-black tracking-[-0.025em]">{title}</Heading>
        </div>
        {description ? <p className="mt-1 max-w-3xl text-xs font-medium text-zinc-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Vertical rhythm for page content (24px between blocks, as on the dashboard). */
export function PageStack({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}
