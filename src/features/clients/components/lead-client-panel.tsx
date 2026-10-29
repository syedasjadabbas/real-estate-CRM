"use client";

import { UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import type { LeadClientStatus } from "@/modules/clients/queries";
import { convertLeadAction } from "../actions";

/**
 * Client panel on a lead page: the linked client, or "Convert to client" for managers and admins.
 * When the phone already belongs to a visible client, the lead is linked to it instead.
 */
export function LeadClientPanel({ leadId, status }: { leadId: string; status: NonNullable<LeadClientStatus> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const convert = (onExisting: "reject" | "link") =>
    startTransition(async () => {
      const result = await convertLeadAction(leadId, onExisting);
      if (result.ok) router.push(`/dashboard/clients/${result.data.clientId}`);
      else setMsg({ text: result.message, ok: false });
    });

  let body: React.ReactNode;
  switch (status.status) {
    case "linked":
      body = status.client ? (
        <p className="text-xs text-zinc-700">
          Linked to client{" "}
          <Link href={`/dashboard/clients/${status.client.id}`} className="font-bold text-brand hover:underline">
            {status.client.name}
          </Link>
          .
        </p>
      ) : (
        <p className="text-xs text-zinc-600">Linked to a client managed by another team.</p>
      );
      break;
    case "match":
      body = (
        <div className="space-y-3">
          <p className="text-xs text-zinc-700">
            This phone number already belongs to client{" "}
            <Link href={`/dashboard/clients/${status.client.id}`} className="font-bold text-brand hover:underline">
              {status.client.name}
            </Link>
            . Link this lead to that client instead of creating a second profile.
          </p>
          <Button variant="primary" size="lg" disabled={pending} onClick={() => convert("link")}>
            <UserRoundCheck aria-hidden="true" className="size-4" />
            Link to existing client
          </Button>
        </div>
      );
      break;
    case "hiddenMatch":
      body = <p className="text-xs text-zinc-600">This phone number already belongs to a client in another team. Ask an admin to link this lead.</p>;
      break;
    case "convertible":
      body = (
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">Create a long-term client profile from this lead. The lead stays in Leads and is linked to the client.</p>
          <Button variant="primary" size="lg" disabled={pending} onClick={() => convert("reject")}>
            <UserRoundCheck aria-hidden="true" className="size-4" />
            Convert to client
          </Button>
        </div>
      );
      break;
  }

  return (
    <PanelCard title="Client">
      <div className="space-y-2">
        {body}
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
