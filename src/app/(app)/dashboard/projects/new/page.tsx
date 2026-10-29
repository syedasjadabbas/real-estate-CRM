import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { RestrictedState } from "@/components/ui/empty-state";
import { ProjectForm } from "@/features/projects/components/project-form";
import { EMPTY_PROJECT } from "@/features/projects/defaults";
import { canDoProject } from "@/modules/projects/policy";
import { requirePageUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Add project" };

export default async function NewProjectPage() {
  const actor = await requirePageUser();
  if (!canDoProject(actor, "manage")) return <RestrictedState />;
  return (
    <section className="space-y-6" aria-label="Add project">
      <PageHeader
        as="h2"
        title="Add project"
        description="After saving, set the project's inventory dimensions on its page, then add units in Inventory."
        actions={
          <Link href="/dashboard/projects" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to list
          </Link>
        }
      />
      <ProjectForm initial={EMPTY_PROJECT} />
    </section>
  );
}
