import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { CityManager } from "@/features/cities/components/city-manager";
import { TypedOtherCities } from "@/features/cities/components/typed-other";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { canViewBackups } from "@/modules/backups/policy";
import { canManageCities } from "@/modules/cities/policy";
import { listCities, typedOtherCities } from "@/modules/cities/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Cities" };

/** Admin-only managed city list (S-22, FR-042). */
export default async function CitiesSettingsPage() {
  const actor = await requirePageUser();
  if (!canManageCities(actor)) return <RestrictedState />;
  const db = getDb();
  const cities = await listCities(db, actor);
  const typed = await typedOtherCities(db, actor);

  return (
    <PageStack>
      <PageHeader
        title="Cities"
        description="The cities offered on lead and client forms. Only Admins and Super Admins can change them, and every change is recorded in the audit log."
        icon={MapPin}
      />
      <SettingsTabs active="cities" showBackups={canViewBackups(actor)} />
      <PanelCard title="City list" className="min-w-0">
        <p className="mb-4 text-xs text-zinc-600">
          Cities are never deleted. Deactivating one removes it from new selections, and records that use it keep it. Renaming changes the name on every
          lead and client that uses it. &quot;Other&quot; is always offered on the forms.
        </p>
        <CityManager cities={cities} />
      </PanelCard>
      <PanelCard title={`Typed under "Other" · ${typed.length}`} className="min-w-0">
        <p className="mb-4 text-xs text-zinc-600">
          City names people typed by hand because they weren&apos;t on the list, most used first. Add a common one to the list and its leads and clients move
          onto it.
        </p>
        <TypedOtherCities rows={typed} />
      </PanelCard>
    </PageStack>
  );
}
