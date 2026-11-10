import Link from "next/link";
import { cn } from "@/lib/cn";
import { withParams } from "../url";

const chip = "rounded-xl px-3.5 py-2 text-xs font-bold whitespace-nowrap transition-colors";
const RESET = { period: null, from: null, to: null, dateField: null, page: null };

/**
 * Won / Lost reporting range, by the date the lead was won or lost: all time, this month, this
 * quarter (Pakistan time) or custom dates. A plain link bar and GET form, so it works before hydration.
 */
export function DecidedRange({ pathname, params, view }: { pathname: string; params: Record<string, string>; view: "won" | "lost" }) {
  const custom = params.dateField === "decided" && !params.period && (params.from || params.to);
  const active = params.dateField === "decided" ? (params.period ?? (custom ? "custom" : "all")) : "all";
  const keep = Object.entries(params).filter(([k]) => !["period", "from", "to", "dateField", "page"].includes(k));
  const items = [
    { key: "all", label: "All time", href: withParams(pathname, params, RESET) },
    { key: "month", label: "This month", href: withParams(pathname, params, { ...RESET, dateField: "decided", period: "month" }) },
    { key: "quarter", label: "This quarter", href: withParams(pathname, params, { ...RESET, dateField: "decided", period: "quarter" }) },
  ];
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-hairline">
      <nav aria-label={`${view === "won" ? "Won" : "Lost"} in`} className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Link key={i.key} href={i.href} aria-current={active === i.key ? "page" : undefined} className={cn(chip, active === i.key ? "bg-brand text-white" : "text-zinc-700 hover:bg-zinc-100")}>
            {i.label}
          </Link>
        ))}
      </nav>
      <form method="get" action={pathname} className="flex flex-wrap items-end gap-2" aria-label="Custom dates">
        {keep.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="dateField" value="decided" />
        <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
          {view === "won" ? "Won" : "Lost"} from
          <input type="date" name="from" defaultValue={custom ? params.from : ""} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold" />
        </label>
        <label className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">
          To
          <input type="date" name="to" defaultValue={custom ? params.to : ""} className="mt-1 block h-9 rounded-xl border border-zinc-200/80 px-2 text-xs font-semibold" />
        </label>
        <button type="submit" className={cn(chip, active === "custom" ? "bg-brand text-white" : "border border-zinc-200/80 text-zinc-700 hover:bg-zinc-100")}>
          Apply dates
        </button>
      </form>
    </div>
  );
}
