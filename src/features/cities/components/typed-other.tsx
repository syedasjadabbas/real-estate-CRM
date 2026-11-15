"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import type { TypedOtherCity } from "@/modules/cities/service";
import { addTypedCityAction } from "../actions";

const plural = (n: number, word: string) => `${formatInt(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * "Typed under Other" (owner review, 16 Nov 2026): city names people typed by hand, most used first.
 * "Add to list" adds the city and moves those leads and clients onto it in one step.
 */
export function TypedOtherCities({ rows }: { rows: TypedOtherCity[] }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return <p className="text-xs text-zinc-500">Nobody has typed a city under &quot;Other&quot; yet.</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" aria-label="Cities typed under Other">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
            <span className="min-w-0">
              <span className="font-bold break-words">{r.name}</span>
              <span className="block text-[11px] text-zinc-500">
                {plural(r.leads, "lead")} · {plural(r.clients, "client")}
              </span>
            </span>
            <button
              type="button"
              disabled={pending}
              aria-label={`Add ${r.name} to the list`}
              className="rounded-lg border border-brand/40 bg-brand-50 px-2 py-1 text-[10px] font-black text-brand-700 uppercase hover:bg-brand-50/60 disabled:opacity-50"
              onClick={() => {
                setBusy(r.name);
                startTransition(async () => {
                  const res = await addTypedCityAction(r.name);
                  setBusy(null);
                  setMsg(
                    res.ok
                      ? { text: `${r.name} added. ${plural(res.data.linkedLeads, "lead")} and ${plural(res.data.linkedClients, "client")} now use it.`, ok: true }
                      : { text: res.fields?.name ? `${r.name}: ${res.fields.name}` : res.message, ok: false },
                  );
                });
              }}
            >
              {busy === r.name ? "Adding…" : "Add to list"}
            </button>
          </li>
        ))}
      </ul>
      {msg ? (
        <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
      <p className="text-[11px] text-zinc-500">
        Spellings that differ only in capitals or spaces count as one. A name that doesn&apos;t look like a city (numbers, a phone number) can&apos;t be added; fix it on the{" "}
        <Link href="/dashboard/leads?city=other" className="font-semibold text-brand hover:underline">
          leads that typed it
        </Link>
        .
      </p>
    </div>
  );
}
