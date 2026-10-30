"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Field } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";

/** URL-driven controls (team, date, month, view) shared by the Daily Report and Duty Roster tabs. */
export function useParamNav(params: Record<string, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (overrides: Record<string, string | null>) => startTransition(() => router.replace(withParams(pathname, params, overrides)));
  return { go, pending };
}

export function TeamSelect({
  params,
  teams,
  label = "Team",
  name = "team",
  emptyLabel = "Select team",
}: {
  params: Record<string, string>;
  teams: { id: string; name: string; isActive: boolean }[];
  label?: string;
  name?: string;
  emptyLabel?: string;
}) {
  const { go, pending } = useParamNav(params);
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={params[name] ?? ""} onChange={(e) => go({ [name]: e.target.value || null })} className={selectClass} disabled={pending}>
          <option value="">{emptyLabel}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function DateParam({ params, name, label, type = "date", value }: { params: Record<string, string>; name: string; label: string; type?: "date" | "month"; value: string }) {
  const { go, pending } = useParamNav(params);
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          disabled={pending}
          onChange={(e) => e.target.value && go({ [name]: e.target.value })}
          className="h-10 w-full rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 text-sm font-medium shadow-hairline focus:border-brand/50 focus:bg-white focus:outline-none"
        />
      )}
    </Field>
  );
}

/** Segmented Day / Month (or Daily / Weekly / Monthly) switch written to a URL param. */
export function SegmentParam({ params, name, options, value, label }: { params: Record<string, string>; name: string; options: { value: string; label: string }[]; value: string; label: string }) {
  const { go, pending } = useParamNav(params);
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</p>
      <div role="group" aria-label={label} className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            disabled={pending}
            onClick={() => go({ [name]: o.value })}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition-colors", o.value === value ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
