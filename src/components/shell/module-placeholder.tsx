import { Construction } from "lucide-react";
import { notFound } from "next/navigation";
import { findNavItem } from "@/config/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader, PageStack } from "./page-header";

/**
 * Honest placeholder for modules whose screens are built in later stages.
 * Uses the real page title and description so navigation and layout can be reviewed.
 */
export function ModulePlaceholder({ href }: { href: string }) {
  const item = findNavItem(href);
  if (!item) notFound();
  const Icon = item.icon;

  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      <Card className="flex flex-col items-center px-6 py-14 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand-50 text-brand shadow-hairline">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-4 text-lg font-black tracking-[-0.025em]">{item.label} module is not built yet</p>
        <p className="mt-1 max-w-md text-sm text-zinc-600">
          The shared UI foundation is in place. This module&apos;s screens, data and actions are delivered in a
          later stage, after the foundation is reviewed.
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-50 px-3 py-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
          <Construction aria-hidden="true" className="size-3.5" />
          Planned
        </span>
      </Card>
    </PageStack>
  );
}
