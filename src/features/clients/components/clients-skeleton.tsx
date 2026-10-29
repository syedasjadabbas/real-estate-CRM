import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for a Clients page below the module header (section header, toolbar, table). */
export function ClientsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-[106px] rounded-3xl" />
      <Skeleton className="h-[82px] rounded-2xl" />
      <Skeleton className="h-[360px] rounded-2xl" />
    </div>
  );
}
