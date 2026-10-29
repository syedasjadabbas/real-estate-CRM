import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder with the dashboard's hero + KPI row proportions, shown while request data streams in. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-[179px] rounded-3xl" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[167px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
