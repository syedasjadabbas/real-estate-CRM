import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RestrictedState } from "@/components/ui/empty-state";
import { BookingsMiniList } from "@/features/bookings/components/bookings-table";
import { formatArea, formatListedOn, formatPrice } from "@/features/inventory/format";
import { UnitStatusPanel } from "@/features/inventory/components/status-panel";
import { UnitStatusPill } from "@/features/inventory/components/status-pill";
import { UnitForm } from "@/features/inventory/components/unit-form";
import { UnitHistory } from "@/features/inventory/components/unit-history";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { bookingsFor } from "@/modules/bookings/queries";
import { SALE_MODEL_LABELS } from "@/modules/inventory/constants";
import { canDoInventory } from "@/modules/inventory/policy";
import { getUnitDetail } from "@/modules/inventory/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Unit" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default async function UnitDetailPage({ params }: PageProps<"/dashboard/inventory/[id]">) {
  const actor = await requirePageUser();
  if (!canDoInventory(actor, "view")) return <RestrictedState />;
  const { id } = await params;
  let detail;
  try {
    detail = await getUnitDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { unit, permissions } = detail;
  const unitBookings = await bookingsFor(getDb(), actor, { unitId: unit.id });
  const str = (v: string | number | null) => (v == null ? "" : String(v));

  return (
    <section className="space-y-6" aria-label={`Unit ${unit.unitNo}`}>
      <PageHeader
        as="h2"
        title={`Unit ${unit.unitNo}`}
        description={
          <>
            <Link href={`/dashboard/projects/${unit.projectId}`} className="font-bold text-brand hover:underline">
              {unit.projectName}
            </Link>
            {unit.floor ? ` · ${unit.floor}` : ""}
            {unit.block ? ` · Block ${unit.block}` : ""}
          </>
        }
        actions={
          <Link href="/dashboard/inventory" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Status">
            <UnitStatusPill status={unit.status} />
          </Fact>
          <Fact label="Sale model">{SALE_MODEL_LABELS[unit.saleModel]}</Fact>
          <Fact label="Area">{formatArea(unit.areaSqft)}</Fact>
          <Fact label="Base price">{formatPrice(unit.basePrice)}</Fact>
          <Fact label="Bedrooms">{unit.bedrooms ?? "—"}</Fact>
          <Fact label="Listed on">{formatListedOn(unit.listedOn)}</Fact>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {permissions.manage ? null : (
            <p className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-hairline">
              <span className="font-semibold">Read-only.</span> Only admins can edit units.
            </p>
          )}
          <UnitForm
            unitId={unit.id}
            disabled={!permissions.manage}
            projects={[{ id: unit.projectId, label: unit.projectName, dimensionConfig: detail.dimensions }]}
            initial={{
              projectId: unit.projectId,
              unitNo: unit.unitNo,
              floor: str(unit.floor),
              block: str(unit.block),
              saleModel: unit.saleModel,
              areaSqft: str(unit.areaSqft),
              basePrice: str(unit.basePrice),
              nature: str(unit.nature),
              category: str(unit.category),
              type: str(unit.type),
              bedrooms: str(unit.bedrooms),
              premium: str(unit.premium),
              listedOn: str(unit.listedOn),
              comment: str(unit.comment),
            }}
          />
          <UnitHistory history={detail.history} />
        </div>
        <div className="space-y-6">
          <UnitStatusPanel unitId={unit.id} status={unit.status} saleModel={unit.saleModel} canManage={permissions.manage} />
          <PanelCard title="Booking history">
            <BookingsMiniList rows={unitBookings} empty="No bookings for this unit (within your access)." />
          </PanelCard>
          {unit.saleModel !== "whole" ? (
            <PanelCard title="Shares">
              <p className="text-xs text-zinc-600">
                {SALE_MODEL_LABELS[unit.saleModel]} share sizes, pricing and booking rules are not confirmed yet (Q-B1), so shares are not tracked
                individually.
              </p>
            </PanelCard>
          ) : null}
        </div>
      </div>
    </section>
  );
}
