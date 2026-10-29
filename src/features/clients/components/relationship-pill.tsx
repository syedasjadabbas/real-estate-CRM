import { RELATIONSHIP_LABELS, type Relationship } from "@/modules/clients/constants";

/** Uppercase pill in the Leads table style; "—" when not set. */
export function RelationshipPill({ value }: { value: Relationship | null }) {
  if (!value) return <span className="text-zinc-400">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] leading-[13px] font-black tracking-[0.025em] whitespace-nowrap text-brand-700 uppercase">
      {RELATIONSHIP_LABELS[value]}
    </span>
  );
}
