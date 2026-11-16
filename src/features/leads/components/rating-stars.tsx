import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

/** A call review score shown as five stars plus "4/5" (16 Nov 2026). */
export function RatingStars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={`Call scored ${rating} out of 5`}>
      <span aria-hidden="true" className="inline-flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className={cn("size-3.5", n <= rating ? "fill-amber-400 text-amber-400" : "text-zinc-300")} />
        ))}
      </span>
      <span aria-hidden="true" className="text-[11px] font-bold text-zinc-700">
        {rating}/5
      </span>
    </span>
  );
}
