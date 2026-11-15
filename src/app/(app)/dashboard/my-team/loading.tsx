import { LeadsSkeleton } from "@/features/leads/components/leads-skeleton";

/** Placeholder while the page reads the signed-in user and its data (instant navigation). */
export default function Loading() {
  return <LeadsSkeleton />;
}
