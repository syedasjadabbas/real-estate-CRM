import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { CityManager } from "@/features/cities/components/city-manager";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { canManageCities } from "@/modules/cities/policy";
import { listCities } from "@/modules/cities/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Cities" };

/** Admin-only managed city list (S-22, FR-042). */
export default async function CitiesSettingsPage() {
  const actor = await requirePageUser();
  if (!canManageCities(actor)) return <RestrictedState />;
  const cities = await listCities(getDb(), actor);

  return (
    <PageStack>
      <PageHeader
        title="Cities"
        description="The list offered on lead and client forms. Super admins and admins only; every change is recorded in the audit log."
        icon={MapPin}
      />
      <SettingsTabs active="cities" />
      <PanelCard title="City list" className="min-w-0">
        <p className="mb-4 text-xs text-zinc-600">
          Cities are never deleted. Deactivating one removes it from new selections, and records that use it keep it. Renaming changes the name on every
          lead and client that uses it. &quot;Other&quot; is always offered on the forms.
        </p>
        <CityManager cities={cities} />
      </PanelCard>
    </PageStack>
  );
}
