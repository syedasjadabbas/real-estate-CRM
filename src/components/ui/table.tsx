import type {
  HTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
  TableHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/** Horizontally scrollable table wrapper; tables never force page-level overflow. */
export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-xs", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-zinc-50/80", className)} {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-zinc-100 last:border-b-0 [tbody_&]:hover:bg-zinc-50/60", className)}
      {...props}
    />
  );
}

export function TH({
  className,
  align = "left",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 text-[10px] leading-[13px] font-bold tracking-[0.05em] whitespace-nowrap text-zinc-400 uppercase first:pl-4 last:pr-4",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  align = "left",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 text-xs leading-4 first:pl-4 last:pr-4",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}
