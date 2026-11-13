import Link from "next/link";
import { PanelCard } from "@/features/leads/components/detail-panels";
import type { LeadClientStatus } from "@/modules/clients/queries";

/**
 * Client panel on a lead page. Every lead belongs to a client, the person (since 13 Nov 2026), so
 * there is nothing to convert: the panel links to the person's profile and their other projects.
 */
export function LeadClientPanel({ status }: { leadId?: string; status: NonNullable<LeadClientStatus> }) {
  return (
    <PanelCard title="Client">
      {status.client ? (
        <p className="text-xs text-zinc-700">
          This lead is one of{" "}
          <Link href={`/dashboard/clients/${status.client.id}`} className="font-bold text-brand hover:underline">
            {status.client.name}
          </Link>
          &rsquo;s inquiries. Open the profile to see every project they are interested in.
        </p>
      ) : (
        <p className="text-xs text-zinc-600">This person&rsquo;s client profile is handled by another team.</p>
      )}
    </PanelCard>
  );
}
