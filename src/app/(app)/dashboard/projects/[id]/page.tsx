import { ArrowLeft, Boxes } from "lucide-react";
import { PaymentPlanPanel } from "@/features/projects/components/payment-plan-panel";
import { resolvePaymentPlan } from "@/modules/projects/payment-plan";
import { getProposalSettings } from "@/modules/tasks/settings";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RestrictedState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { DimensionsPanel } from "@/features/inventory/components/dimensions-panel";
import { ProjectForm } from "@/features/projects/components/project-form";
import { ProjectLinks } from "@/features/projects/components/project-links";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "@/modules/projects/constants";
import { canDoProject } from "@/modules/projects/policy";
import { getProjectDetail } from "@/modules/projects/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getProjectScope } from "@/server/project-scope";

export const metadata: Metadata = { title: "Project" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{label}</p>
      <div className="mt-0.5 truncate text-sm font-bold">{children}</div>
    </div>
  );
}

export default async function ProjectDetailPage({ params }: PageProps<"/dashboard/projects/[id]">) {
  const actor = await requirePageUser();
  if (!canDoProject(actor, "view")) return <RestrictedState />;
  const { id } = await params;
  let detail;
  try {
    detail = await getProjectDetail(getDb(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { project, links, permissions } = detail;
  const { projects: selectable } = await getProjectScope();

  return (
    <section className="space-y-6" aria-label={project.name}>
      <PageHeader
        as="h2"
        title={project.name}
        description={[project.developer, project.city].filter(Boolean).join(" · ") || "No developer or city recorded"}
        actions={
          <>
            <Badge tone="brand">{PROJECT_TYPE_LABELS[project.type]}</Badge>
            <Badge tone={project.status === "active" ? "brand" : "neutral"}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
            <Link href="/dashboard/projects" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
          </>
        }
      />

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Type">{PROJECT_TYPE_LABELS[project.type]}</Fact>
          <Fact label="Status">{PROJECT_STATUS_LABELS[project.status]}</Fact>
          <Fact label="Developer">{project.developer ?? "—"}</Fact>
          <Fact label="City">{project.city ?? "—"}</Fact>
          <Fact label="Units tracked">{links.unitsTracked}</Fact>
          <Fact label="Updated">{formatDateTime(project.updatedAt)}</Fact>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {permissions.manage ? null : (
            <p className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-hairline">
              <span className="font-semibold">Read-only.</span> Only admins can edit projects.
            </p>
          )}
          <ProjectForm
            projectId={project.id}
            disabled={!permissions.manage}
            initial={{
              name: project.name,
              type: project.type,
              status: project.status,
              developer: project.developer ?? "",
              city: project.city ?? "",
              address: project.address ?? "",
              description: project.description ?? "",
            }}
          />
        </div>
        <div className="space-y-6">
          <PanelCard title="Linked records">
            <ProjectLinks
              projectId={project.id}
              leads={links.leads}
              clients={links.clients}
              canOpenLeads={selectable.some((p) => p.id === project.id)}
            />
          </PanelCard>
          <PanelCard title="Payment plan">
            <p className="mb-3 text-[11px] text-zinc-500">Used for this project&apos;s bookings: the New booking page and the booking form.</p>
            <PaymentPlanPanel projectId={project.id} plan={resolvePaymentPlan(project.paymentPlan, await getProposalSettings(getDb()))} canManage={permissions.manage} />
          </PanelCard>
          <PanelCard title="Inventory dimensions">
            <DimensionsPanel projectId={project.id} dimensions={project.dimensionConfig} canManage={permissions.manage} />
            <Link
              href={`/dashboard/inventory?project=${project.id}`}
              className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-4" })}
            >
              <Boxes aria-hidden="true" className="size-4" />
              View inventory →
            </Link>
          </PanelCard>
          <PanelCard title="Record">
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Created</dt>
                <dd className="font-semibold">{formatDateTime(project.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Last updated</dt>
                <dd className="font-semibold">{formatDateTime(project.updatedAt)}</dd>
              </div>
            </dl>
          </PanelCard>
        </div>
      </div>
    </section>
  );
}
