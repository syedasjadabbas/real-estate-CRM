import { ArrowRight, Building2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatInt } from "@/lib/format";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "@/modules/projects/constants";
import type { ProjectCard as ProjectCardData } from "@/modules/projects/queries";

/** Reference project card: name, type badge, status badge, company label, units tracked, Open →. */
export function ProjectCard({ project }: { project: ProjectCardData }) {
  return (
    <article className="flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline transition-shadow hover:shadow-md hover:shadow-zinc-950/5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand-50 text-brand shadow-hairline">
            <Building2 aria-hidden="true" className="size-4" />
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            <Badge tone="brand">{PROJECT_TYPE_LABELS[project.type]}</Badge>
            {project.status === "inactive" ? <Badge tone="neutral">{PROJECT_STATUS_LABELS.inactive}</Badge> : null}
          </div>
        </div>
        <h3 className="mt-3 truncate text-base leading-6 font-black tracking-[-0.015em]">{project.name}</h3>
        <p className="truncate text-xs font-medium text-zinc-600">{[project.developer, project.city].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2 border-t border-zinc-100 pt-3">
        <div>
          <p className="text-[9px] leading-[13.5px] font-black tracking-[0.05em] text-zinc-400 uppercase">Units tracked</p>
          <p className="text-lg leading-[18px] font-black tabular-nums">{formatInt(project.unitsTracked)}</p>
        </div>
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"
          aria-label={`Open ${project.name}`}
        >
          Open <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
