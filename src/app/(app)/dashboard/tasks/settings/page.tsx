import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { ProposalSettingsForm } from "@/features/tasks/components/settings-form";
import { canDoTask } from "@/modules/tasks/policy";
import { getProposalSettings } from "@/modules/tasks/settings";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Proposal settings" };

export default async function ProposalSettingsPage() {
  const actor = await requirePageUser();
  if (!canDoTask(actor, "settings")) return <RestrictedState />;
  const settings = await getProposalSettings(getDb());
  return (
    <section className="space-y-6" aria-label="Proposal settings">
      <PageHeader
        as="h2"
        title="Proposal settings"
        description="App settings for the proposal / payment-plan builder. Proposed defaults pending client confirmation; changes apply to proposals saved afterwards."
        actions={
          <Link href="/dashboard/tasks" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      <ProposalSettingsForm initial={settings} canEdit />
    </section>
  );
}
