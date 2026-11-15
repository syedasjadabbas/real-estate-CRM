"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { StatusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import type { CityRow } from "@/modules/cities/service";
import { CITY_NAME_MAX } from "@/modules/cities/constants";
import { addCityAction, updateCityAction } from "../actions";

const smallButton =
  "rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50";
const plural = (n: number, word: string) => `${formatInt(n)} ${word}${n === 1 ? "" : "s"}`;
const chip = (on: boolean) =>
  cn("rounded-lg border px-2.5 py-1.5 text-xs font-bold", on ? "border-brand bg-brand text-white" : "border-zinc-200/80 bg-white text-zinc-700 hover:bg-zinc-50");
type Show = "active" | "inactive" | "all";
type Sort = "list" | "az" | "used";

/** Add, rename, deactivate and reactivate cities. There is no delete: records keep the city they have. */
export function CityManager({ cities }: { cities: CityRow[] }) {
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  // Finding and ordering cities (owner review, 16 Nov 2026).
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("active");
  const [sort, setSort] = useState<Sort>("list");
  const counts = { active: cities.filter((c) => c.isActive).length, inactive: cities.filter((c) => !c.isActive).length, all: cities.length };
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = cities.filter((c) => (show === "all" || (show === "active") === c.isActive) && (!term || c.name.toLowerCase().includes(term)));
    if (sort === "az") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "used") return [...list].sort((a, b) => b.leads + b.clients - (a.leads + a.clients) || a.name.localeCompare(b.name));
    return list;
  }, [cities, q, show, sort]);

  const add = () =>
    startTransition(async () => {
      const r = await addCityAction({ name });
      if (r.ok) {
        setName("");
        setAddError(undefined);
        setMsg({ text: "City added.", ok: true });
      } else {
        setAddError(r.fields?.name);
        setMsg({ text: r.message, ok: false });
      }
    });
  const rename = (city: CityRow, next: string) =>
    startTransition(async () => {
      const r = await updateCityAction(city.id, { name: next });
      if (r.ok) {
        setEditing(null);
        setMsg({ text: r.data.changed ? "City renamed." : "Nothing changed.", ok: true });
      } else {
        setEditing({ id: city.id, name: next, error: r.fields?.name ?? r.message });
        setMsg(null);
      }
    });
  const toggle = (city: CityRow) =>
    startTransition(async () => {
      const r = await updateCityAction(city.id, { isActive: !city.isActive });
      setMsg(r.ok ? { text: `${city.name} ${city.isActive ? "deactivated" : "activated"}.`, ok: true } : { text: r.message, ok: false });
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
          <span className="sr-only">Find a city</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a city"
            className="h-9 w-full rounded-xl border border-zinc-200/80 bg-white pr-3 pl-8 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none"
          />
        </label>
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {(["active", "inactive", "all"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={show === v} className={chip(show === v)} onClick={() => setShow(v)}>
              {v === "active" ? "Active" : v === "inactive" ? "Inactive" : "All"} · {counts[v]}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs font-bold text-zinc-500">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-xl border border-zinc-200/80 bg-white px-2 text-xs font-semibold text-zinc-800">
            <option value="list">List order</option>
            <option value="az">A–Z</option>
            <option value="used">Most used</option>
          </select>
        </label>
      </div>
      <ul className="space-y-1.5" aria-label="Cities">
        {visible.length === 0 ? (
          <li className="text-xs text-zinc-500">
            {cities.length === 0 ? "No cities yet." : q.trim() ? `No ${show === "all" ? "" : `${show} `}city matches “${q.trim()}”.` : show === "inactive" ? "No inactive cities." : "No cities here."}
          </li>
        ) : null}
        {visible.map((c) => (
          <li key={c.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
            {editing?.id === c.id ? (
              <form
                noValidate
                aria-label={`Rename ${c.name}`}
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(c, editing.name);
                }}
              >
                <Field label="City name" error={editing.error} className="min-w-0 flex-1">
                  {(id, d) => (
                    <Input
                      id={id}
                      aria-describedby={d}
                      invalid={Boolean(editing.error)}
                      value={editing.name}
                      maxLength={CITY_NAME_MAX}
                      disabled={pending}
                      onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" size="lg" disabled={pending}>
                  Save
                </Button>
                <Button variant="secondary" size="lg" disabled={pending} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className={cn("font-bold break-words", c.isActive ? "text-zinc-900" : "text-zinc-500")}>{c.name}</span>
                  {c.isActive ? null : (
                    <span className="ml-2">
                      <StatusTag tone="neutral">Inactive</StatusTag>
                    </span>
                  )}
                  <p className="text-[11px] text-zinc-500">
                    {c.leads ? (
                      <Link href={`/dashboard/leads?city=${c.id}`} className="font-semibold text-brand hover:underline">
                        {plural(c.leads, "lead")}
                      </Link>
                    ) : (
                      plural(c.leads, "lead")
                    )}
                    {" · "}
                    {c.clients ? (
                      <Link href={`/dashboard/clients?city=${c.id}`} className="font-semibold text-brand hover:underline">
                        {plural(c.clients, "client")}
                      </Link>
                    ) : (
                      plural(c.clients, "client")
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" disabled={pending} aria-label={`Rename ${c.name}`} className={smallButton} onClick={() => setEditing({ id: c.id, name: c.name })}>
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`${c.isActive ? "Deactivate" : "Activate"} ${c.name}`}
                    className={smallButton}
                    onClick={() => toggle(c)}
                  >
                    {c.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        noValidate
        aria-label="Add a city"
        className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="New city" hint="Letters only. It's added as active and appears on lead and client forms straight away." error={addError} className="min-w-0 flex-1">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              invalid={Boolean(addError)}
              value={name}
              maxLength={CITY_NAME_MAX}
              disabled={pending}
              placeholder="e.g. Murree"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={!name.trim() || pending}>
          Add
        </Button>
      </form>
      {msg ? (
        <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
