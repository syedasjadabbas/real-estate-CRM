import { TrendingUp } from "lucide-react";
import { brand } from "@/config/brand";
import type { SessionUser } from "@/lib/session";

/** "Analytics Dashboard" hero card with brand pill, role pill and data-source status. */
export function DashboardHero({ user, isSample, live }: { user: SessionUser | null; isSample: boolean; live?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-linear-to-br from-white via-brand-50/40 to-brand-50/50 p-6 shadow-hairline md:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute -top-12 -right-16 size-64 rounded-full bg-brand/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-8 -left-12 size-64 rounded-full bg-brand/10 blur-3xl" />

      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-white px-3 py-1 text-[11px] leading-[16.5px] font-black tracking-[0.1em] text-brand uppercase shadow-hairline">
              <span className="size-2 animate-pulse-soft rounded-full bg-brand" />
              {brand.productLabel}
            </span>
            {user ? (
              <span className="inline-flex items-center rounded-full border border-zinc-200/80 bg-zinc-950 px-3 py-1 text-[11px] leading-[16.5px] font-bold text-white shadow-hairline">
                {user.roleLabel}
              </span>
            ) : null}
          </div>
          <h1 className="mt-2 text-3xl leading-none font-black tracking-[-0.025em] md:text-5xl">
            Analytics <span className="text-brand">Dashboard</span>
          </h1>
          <p className="mt-2 font-medium text-zinc-700">
            {user ? (
              <>
                Signed in as <span className="font-bold text-zinc-950">{user.email}</span> ·{" "}
                <span className="font-semibold text-brand">{user.name}</span>
              </>
            ) : (
              "Not signed in. Your workspace data appears here once authentication is connected."
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 self-start rounded-2xl border border-zinc-200/80 bg-white/80 p-3.5 shadow-hairline md:self-auto">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
            <TrendingUp aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-[10px] leading-[15px] font-black tracking-[0.1em] text-zinc-400 uppercase">
              Real-time data
            </p>
            <p className="text-xs leading-4 font-bold">
              {isSample ? "Sample data (development)" : live ? "Live · active project" : "No lead analytics for your role"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
