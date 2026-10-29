import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for a Leads sub-page (section header, toolbar, table) below the tab bar. */
export function LeadsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-[106px] rounded-3xl" />
      <Skeleton className="h-[68px] rounded-2xl" />
      <Skeleton className="h-[360px] rounded-2xl" />
    </div>
  );
}
