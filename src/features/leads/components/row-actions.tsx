"use client";

import { Star } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { setFavoriteAction } from "../actions";

export function FavoriteButton({ leadId, initial, size = "sm" }: { leadId: string; initial: boolean; size?: "sm" | "md" }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const result = await setFavoriteAction(leadId, next);
      if (!result.ok) setOn(!next);
    });
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "inline-flex items-center justify-center rounded-lg transition-colors hover:bg-zinc-100",
        size === "sm" ? "size-6 p-1" : "size-9 border border-zinc-200/80 bg-white shadow-hairline",
      )}
    >
      <Star aria-hidden="true" className={cn("size-4", on ? "fill-amber-400 text-amber-500" : "text-zinc-300")} />
    </button>
  );
}
