import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Loading placeholder block — zinc-100/90 at half opacity, 12px radius, as in the reference. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-xl bg-zinc-100/90 opacity-50", className)}
      {...props}
    />
  );
}
