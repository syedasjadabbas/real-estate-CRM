import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Bordered empty box used inside widgets ("No team scores."). */
export function EmptyState({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200/80 px-4 text-center text-xs leading-4 font-bold text-zinc-600",
        size === "sm" ? "py-8" : "py-12",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Restricted-section card shown when the user lacks permission. */
export function RestrictedState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-zinc-200/80 bg-white px-6 py-10 text-center shadow-hairline",
        className,
      )}
    >
      <p className="text-[10px] font-black tracking-[0.2em] text-rose-600 uppercase">Restricted</p>
      <p className="mt-1 text-lg font-black tracking-[-0.025em]">Access denied</p>
      <p className="mt-1 text-sm text-zinc-600">
        You do not have permission to view this section. Ask an admin if you need access.
      </p>
    </div>
  );
}
