import { User } from "lucide-react";
import { cn } from "@/lib/cn";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Green gradient avatar with optional presence dot (sidebar footer and header chip).
 * Without a name it shows a neutral person icon — no invented identity.
 */
export function Avatar({
  name,
  size = "md",
  presence = false,
  className,
}: {
  name?: string | null;
  size?: "sm" | "md";
  presence?: boolean;
  className?: string;
}) {
  const text = name ? (size === "sm" ? initials(name) : initials(name).slice(0, 1)) : null;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center font-black text-white uppercase shadow-hairline",
          size === "sm"
            ? "size-[30px] rounded-lg text-[11px] ring-2 ring-brand/20"
            : "size-[38px] rounded-xl text-sm",
          text
            ? "bg-linear-to-br from-brand via-brand to-brand-700"
            : "bg-zinc-100 text-zinc-400 ring-zinc-200",
        )}
      >
        {text ?? <User aria-hidden="true" className={size === "sm" ? "size-4" : "size-5"} />}
      </span>
      {presence ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-brand ring-2 ring-white" />
      ) : null}
    </span>
  );
}

/** Square tinted letter tile used in table rows (lead name column). */
export function LetterTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[11px] font-black text-brand",
        className,
      )}
    >
      {initials(name).slice(0, 1)}
    </span>
  );
}
