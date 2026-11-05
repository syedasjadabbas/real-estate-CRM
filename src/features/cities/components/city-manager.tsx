"use client";

import { useState, useTransition } from "react";
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

/** Add, rename, deactivate and reactivate cities. There is no delete: records keep the city they have. */
export function CityManager({ cities }: { cities: CityRow[] }) {
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

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
      <ul className="space-y-1.5" aria-label="Cities">
        {cities.length === 0 ? <li className="text-xs text-zinc-500">No cities yet.</li> : null}
        {cities.map((c) => (
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
                    {plural(c.leads, "lead")} · {plural(c.clients, "client")}
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
        <Field label="New city" error={addError} className="min-w-0 flex-1">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              invalid={Boolean(addError)}
              value={name}
              maxLength={CITY_NAME_MAX}
              disabled={pending}
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
