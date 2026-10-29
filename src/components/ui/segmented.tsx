"use client";

import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * Bordered chip group used for team tabs and date ranges (24h · 7d · 30d · MTD · 6m · Custom).
 * `compact` matches the smaller in-widget variant.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  compact = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center rounded-2xl border border-zinc-200/80 bg-white shadow-hairline",
        compact ? "gap-1 p-1" : "gap-1.5 p-1.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-xl font-bold whitespace-nowrap transition-colors",
              compact ? "px-3 py-1.5 text-[11px] leading-4" : "px-3.5 py-2 text-xs leading-4",
              selected ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
