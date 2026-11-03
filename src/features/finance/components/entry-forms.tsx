"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { cn } from "@/lib/cn";
import { ENTRY_KIND_LABELS, ENTRY_KINDS, type EntryKind } from "@/modules/finance/entry-constants";
import { addCategoryAction, createEntryAction, setCategoryActiveAction, updateEntryAction, voidEntryAction } from "../actions";

type Option = { id: string; name: string };
type Category = { id: string; kind: EntryKind; name: string; isActive: boolean };
type Msg = { text: string; ok: boolean } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

type Values = { kind: EntryKind; categoryId: string; amount: string; entryDate: string; methodId: string; reference: string; payee: string; note: string };

/** FR-200 / FR-201 income or expense entry: create (with a kind) or edit an existing entry. */
export function EntryForm({ categories, methods, initial, entryId }: { categories: Category[]; methods: Option[]; initial: Values; entryId?: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const kindCategories = categories.filter((c) => c.kind === v.kind && (c.isActive || c.id === initial.categoryId));

  return (
    <form
      noValidate
      aria-label={entryId ? "Edit entry" : "New income or expense"}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const { kind, payee, ...rest } = v;
          const fields = { ...rest, payee: v.kind === "expense" ? payee : "" };
          const r = entryId ? await updateEntryAction(entryId, fields) : await createEntryAction({ kind, ...fields });
          if (!r.ok) {
            setErrors(r.fields ?? {});
            setMsg({ text: r.message, ok: false });
            return;
          }
          setErrors({});
          if (!entryId) return router.push(`/dashboard/finance/entries/${(r.data as { entryId: string }).entryId}`);
          setMsg({ text: (r.data as { changed: string[] }).changed.length ? "Entry saved." : "No changes to save.", ok: true });
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {entryId ? null : (
          <Field label="Kind" error={errors.kind}>
            {(id, d) => (
              <select id={id} aria-describedby={d} className={selectClass} value={v.kind} disabled={pending} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value as EntryKind, categoryId: "" }))}>
                {ENTRY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ENTRY_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Category" error={errors.categoryId} hint={kindCategories.length ? undefined : "No categories yet: a Super Admin adds them in Finance settings."}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={v.categoryId} disabled={pending} onChange={set("categoryId")}>
              <option value="">Choose…</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Amount (PKR)" error={errors.amount}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" invalid={Boolean(errors.amount)} value={v.amount} disabled={pending} onChange={set("amount")} />}
        </Field>
        <Field label="Date" error={errors.entryDate}>
          {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={Boolean(errors.entryDate)} value={v.entryDate} disabled={pending} onChange={set("entryDate")} />}
        </Field>
        <Field label="Method" error={errors.methodId}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={v.methodId} disabled={pending} onChange={set("methodId")}>
              <option value="">Not recorded</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Reference" error={errors.reference}>
          {(id, d) => <Input id={id} aria-describedby={d} maxLength={120} value={v.reference} disabled={pending} onChange={set("reference")} />}
        </Field>
        {v.kind === "expense" ? (
          <Field label="Payee" error={errors.payee}>
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={120} value={v.payee} disabled={pending} onChange={set("payee")} />}
          </Field>
        ) : null}
      </div>
      <Field label="Note" error={errors.note}>
        {(id, d) => <Input id={id} aria-describedby={d} maxLength={1000} value={v.note} disabled={pending} onChange={set("note")} />}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Status msg={msg} />
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {entryId ? "Save entry" : "Record entry"}
        </Button>
      </div>
    </form>
  );
}

/** Void with a reason; the entry stays on record and leaves the totals. */
export function VoidEntryForm({ entryId }: { entryId: string }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Field label="Reason for voiding">
        {(id) => <Input id={id} value={reason} maxLength={500} disabled={pending} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Status msg={msg} />
        <Button
          variant="secondary"
          size="lg"
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            startTransition(async () => {
              const r = await voidEntryAction(entryId, { reason });
              setMsg(r.ok ? { text: "Entry voided. It stays on record and is left out of totals.", ok: true } : { text: r.message, ok: false });
            })
          }
        >
          Void entry
        </Button>
      </div>
    </div>
  );
}

/** Q-F4: income and expense categories (Super Admin). Deactivate instead of delete. */
export function CategoriesPanel({ categories, canEdit }: { categories: Category[]; canEdit: boolean }) {
  const [v, setV] = useState({ kind: "income" as EntryKind, name: "" });
  const [error, setError] = useState<string | undefined>();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PanelCard title="Income and expense categories">
      <div className="space-y-3">
        {ENTRY_KINDS.map((k) => (
          <div key={k}>
            <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{ENTRY_KIND_LABELS[k]}</p>
            <ul className="mt-1 space-y-1.5" aria-label={`${ENTRY_KIND_LABELS[k]} categories`}>
              {categories.filter((c) => c.kind === k).length === 0 ? <li className="text-xs text-zinc-500">None yet.</li> : null}
              {categories
                .filter((c) => c.kind === k)
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                    <span className={cn("font-bold", c.isActive ? "text-zinc-900" : "text-zinc-400 line-through")}>{c.name}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={pending}
                        className="rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
                        onClick={() =>
                          startTransition(async () => {
                            const r = await setCategoryActiveAction(c.id, !c.isActive);
                            setMsg(r.ok ? { text: `${c.name} ${c.isActive ? "deactivated" : "activated"}.`, ok: true } : { text: r.message, ok: false });
                          })
                        }
                      >
                        {c.isActive ? "Deactivate" : "Activate"}
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
            <Field label="Kind">
              {(id) => (
                <select id={id} className={selectClass} value={v.kind} disabled={pending} onChange={(e) => setV((s) => ({ ...s, kind: e.target.value as EntryKind }))}>
                  {ENTRY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ENTRY_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="New category" error={error} className="min-w-0 flex-1">
              {(id, d) => <Input id={id} aria-describedby={d} value={v.name} maxLength={80} disabled={pending} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} />}
            </Field>
            <Button
              variant="primary"
              size="lg"
              disabled={!v.name.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await addCategoryAction(v);
                  if (r.ok) {
                    setV((s) => ({ ...s, name: "" }));
                    setError(undefined);
                    setMsg({ text: "Category added.", ok: true });
                  } else {
                    setError(r.fields?.name);
                    setMsg({ text: r.message, ok: false });
                  }
                })
              }
            >
              Add
            </Button>
          </div>
        ) : null}
        <Status msg={msg} />
      </div>
    </PanelCard>
  );
}
