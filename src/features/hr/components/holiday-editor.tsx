"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { createContext, useContext, useId, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatListedOn } from "@/features/inventory/format";
import { cn } from "@/lib/cn";
import { HOLIDAY_SCOPES, HOLIDAY_SCOPE_LABELS, MAX_YEAR, MIN_YEAR, type HolidayScope } from "@/modules/holidays/validation";
import { createHolidayAction, deleteHolidayAction, updateHolidayAction } from "../actions";

type Holiday = { id: string; date: string; name: string; scope: HolidayScope; region: string | null };
type Msg = { text: string; ok: boolean } | null;

/** Page-level outcome line, so a message survives the row that triggered it (e.g. after a delete). */
const NoticeContext = createContext<(msg: Msg) => void>(() => {});

export function HolidayNotices({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <NoticeContext value={setMsg}>
      {msg ? (
        <p
          role={msg.ok ? "status" : "alert"}
          className={cn(
            "rounded-xl border px-3 py-2 text-xs font-semibold",
            msg.ok ? "border-brand/25 bg-brand-50 text-brand-700" : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {msg.text}
        </p>
      ) : null}
      {children}
    </NoticeContext>
  );
}

function HolidayForm({ holiday, regions, defaultDate, onDone }: { holiday?: Holiday; regions: string[]; defaultDate: string; onDone: () => void }) {
  const notify = useContext(NoticeContext);
  const listId = useId();
  const [date, setDate] = useState(holiday?.date ?? defaultDate);
  const [name, setName] = useState(holiday?.name ?? "");
  const [scope, setScope] = useState<HolidayScope>(holiday?.scope ?? "company");
  const [region, setRegion] = useState(holiday?.region ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      aria-label={holiday ? "Edit holiday" : "New holiday"}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const input = { date, name, scope, region: scope === "regional" ? region : null };
          const result = holiday ? await updateHolidayAction(holiday.id, input) : await createHolidayAction(input);
          if (result.ok) {
            notify({ text: holiday ? `Holiday "${name.trim()}" saved.` : `Holiday "${name.trim()}" added for ${formatListedOn(date)}.`, ok: true });
            onDone();
          } else {
            setErrors(result.fields ?? {});
            setError(result.message);
          }
        });
      }}
    >
      <Field label="Date" required error={errors.date}>
        {(id, d) => (
          <Input
            id={id}
            type="date"
            aria-describedby={d}
            invalid={Boolean(errors.date)}
            min={`${MIN_YEAR}-01-01`}
            max={`${MAX_YEAR}-12-31`}
            value={date}
            disabled={pending}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
      </Field>
      <Field label="Holiday name" required error={errors.name}>
        {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.name)} value={name} maxLength={100} disabled={pending} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
          Scope<span className="text-rose-600"> *</span>
        </legend>
        <div className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-1 shadow-hairline">
          {HOLIDAY_SCOPES.map((s) => (
            <label
              key={s}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/30",
                scope === s ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-white",
              )}
            >
              <input type="radio" name="scope" value={s} className="sr-only" checked={scope === s} disabled={pending} onChange={() => setScope(s)} />
              {HOLIDAY_SCOPE_LABELS[s]}
            </label>
          ))}
        </div>
        {errors.scope ? <p className="mt-1.5 text-xs font-semibold text-rose-600">{errors.scope}</p> : null}
      </fieldset>
      {scope === "regional" ? (
        <Field label="Region" required error={errors.region} hint="Type the region (e.g. a city or office). Existing regions are suggested.">
          {(id, d) => (
            <>
              <Input id={id} aria-describedby={d} invalid={Boolean(errors.region)} list={listId} value={region} maxLength={80} disabled={pending} onChange={(e) => setRegion(e.target.value)} />
              <datalist id={listId}>
                {regions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Saving…" : holiday ? "Save holiday" : "Add holiday"}
        </Button>
      </div>
    </form>
  );
}

export function AddHolidayButton({ regions, defaultDate }: { regions: string[]; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="lg" className="h-10 px-4 text-xs" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" className="size-3.5" />
        Add holiday
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add holiday" description="Company-wide holidays apply to everyone; regional ones to one region.">
        {open ? <HolidayForm regions={regions} defaultDate={defaultDate} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}

export function HolidayRowActions({ holiday, regions }: { holiday: Holiday; regions: string[] }) {
  const notify = useContext(NoticeContext);
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => {
    setMode(null);
    setError(null);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => setMode("edit")} aria-label={`Edit ${holiday.name}`}>
        <Pencil aria-hidden="true" className="size-3" />
        Edit
      </Button>
      <Button size="sm" variant="secondary" className="text-rose-700" onClick={() => setMode("delete")} aria-label={`Delete ${holiday.name}`}>
        <Trash2 aria-hidden="true" className="size-3" />
        Delete
      </Button>
      <Modal open={mode === "edit"} onClose={close} title="Edit holiday" description={`${holiday.name} · ${formatListedOn(holiday.date)}`}>
        {mode === "edit" ? <HolidayForm holiday={holiday} regions={regions} defaultDate={holiday.date} onDone={close} /> : null}
      </Modal>
      <Modal
        open={mode === "delete"}
        onClose={close}
        title="Delete holiday?"
        description="It is removed from the calendar. The change is kept in the audit log."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="bg-rose-600 hover:bg-rose-700"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteHolidayAction(holiday.id);
                  if (result.ok) {
                    notify({ text: `Holiday "${holiday.name}" deleted.`, ok: true });
                    close();
                  } else setError(result.message);
                })
              }
            >
              {pending ? "Deleting…" : "Delete holiday"}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <span className="font-bold">{holiday.name}</span> — {formatListedOn(holiday.date)} · {HOLIDAY_SCOPE_LABELS[holiday.scope]}
          {holiday.region ? ` (${holiday.region})` : ""}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
