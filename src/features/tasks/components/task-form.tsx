"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SummaryTile } from "@/components/ui/stat";
import { formatArea, formatPrice } from "@/features/inventory/format";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { fromLocalInputValue } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import type { TaskProposal } from "@/server/db/schema";
import { DEFAULT_RECURRING_LABEL, TASK_TYPES, TASK_TYPE_LABELS, hasPlan, type TaskType } from "@/modules/tasks/constants";
import { buildRows, computeFigures, rowsTotal, unitPricePerSqft } from "@/modules/tasks/plan";
import type { TaskFormOptions } from "@/modules/tasks/queries";
import { createTaskAction, updateTaskAction } from "../actions";

export type TaskFormInitial = {
  title: string;
  type: TaskType;
  dueLocal: string;
  assigneeId: string;
  leadId: string;
  bookingId: string;
  description: string;
  proposal: TaskProposal | null;
  rows: { label: string; description: string | null; progress: string | null; amount: number; dueOn?: string | null }[];
};

type RowState = { label: string; description: string; progress: string; amount: string; dueOn: string };
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")));
const toRowState = (r: { label: string; description: string | null; progress: string | null; amount: number; dueOn?: string | null }): RowState => ({
  label: r.label,
  description: str(r.description),
  progress: str(r.progress),
  amount: str(r.amount),
  dueOn: str(r.dueOn),
});

/** Numbered builder card ("01 Cover page"), FormSection layout with the reference's step number. */
function Step({ n, title, hint, children, wide }: { n: string; title: string; hint: string; children: ReactNode; wide?: boolean }) {
  return (
    <fieldset className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-hairline">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true" className="mb-3 flex items-baseline gap-2">
        <span className="text-[10px] font-black tracking-[0.2em] text-zinc-400">{n}</span>
        <span className="text-[10px] font-black tracking-[0.2em] text-brand uppercase">{title}</span>
      </div>
      <p className="-mt-2 mb-3 text-[11px] text-zinc-500">{hint}</p>
      <div className={cn("grid grid-cols-1 gap-4", wide ? "" : "sm:grid-cols-2")}>{children}</div>
    </fieldset>
  );
}

/**
 * FR-090 / FR-091 create & edit form. The live figures and rows use the same arithmetic as the server,
 * which recomputes everything and enforces the discount cap and the agents' down-payment lock.
 */
export function TaskForm({
  mode,
  taskId,
  options,
  initial,
  today,
}: {
  mode: "create" | "edit";
  taskId?: string;
  options: TaskFormOptions;
  initial: TaskFormInitial;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { settings, limits } = options;
  const existing = initial.proposal;

  const [v, setV] = useState({
    title: initial.title,
    type: initial.type,
    dueLocal: initial.dueLocal,
    assigneeId: initial.assigneeId,
    leadId: initial.leadId,
    bookingId: initial.bookingId,
    description: initial.description,
  });
  const [p, setP] = useState({
    customerName: str(existing?.customerName),
    preparedDate: existing ? str(existing.preparedDate) : today,
    preparedByName: str(existing?.preparedByName),
    preparedByTitle: str(existing?.preparedByTitle),
    projectId: str(existing?.projectId),
    printTitle: str(existing?.printTitle),
    clientName: str(existing?.clientName),
    customHeader: str(existing?.customHeader),
    unitId: str(existing?.unitId),
    discountPct: existing ? str(existing.discountPct) : "0",
    downPaymentPct: str(existing?.downPaymentPct ?? settings.downPaymentPct),
    installmentCount: str(existing?.installmentCount ?? settings.installmentCount),
    recurringLabel: existing?.recurringLabel ?? DEFAULT_RECURRING_LABEL,
    firstInstallmentMonth: str(existing?.firstInstallmentMonth),
    freeNightVouchers: str(existing?.freeNightVouchers),
    bonuses: str(existing?.bonuses),
    whyActNow: str(existing?.whyActNow),
    nextSteps: str(existing?.nextSteps),
  });
  const [rows, setRows] = useState<RowState[]>(initial.rows.map(toRowState));
  // Saved rows that differ from the generated schedule were edited by hand: keep showing them.
  const [rowsEdited, setRowsEdited] = useState(() => {
    if (!existing || initial.rows.length === 0) return false;
    const regenerated = buildRows(existing, existing.installmentCount, existing.recurringLabel, existing.firstInstallmentMonth ?? null).map(toRowState);
    return JSON.stringify(regenerated) !== JSON.stringify(initial.rows.map(toRowState));
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((s) => ({ ...s, ...patch }));

  const plan = hasPlan(v.type);
  const unit = options.units.find((u) => u.id === p.unitId);
  // Q48: only Available units can be quoted in a Proposal; its existing unit stays listed so it can be kept.
  const projectUnits = options.units.filter((u) => u.projectId === p.projectId && (v.type !== "proposal" || u.status === "available" || u.id === existing?.unitId));
  // Q47: the unit's current price and area, also for a proposal saved earlier.
  const pricePerSqft = unit ? unitPricePerSqft(unit, settings) : null;
  const areaSqft = unit ? unit.areaSqft : null;
  const roiPerSqft = existing ? existing.roiPerSqft : settings.roiPerSqft;
  const count = Math.trunc(num(p.installmentCount));
  const inputsValid = [num(p.discountPct), num(p.downPaymentPct)].every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && count >= 1 && count <= 360;
  const figures = inputsValid
    ? computeFigures({ areaSqft, pricePerSqft, discountPct: num(p.discountPct), downPaymentPct: num(p.downPaymentPct), installmentCount: count, roiPerSqft })
    : { totalList: null, afterDiscount: null, downPayment: null, eachInstallment: null, roiAnnual: null };
  const generated = inputsValid ? buildRows(figures, count, p.recurringLabel, /^\d{4}-\d{2}$/.test(p.firstInstallmentMonth) ? p.firstInstallmentMonth : null) : [];
  // Rows follow the figures automatically until someone edits them; "Rebuild" brings them back in line.
  const shownRows = rowsEdited ? rows : generated.map(toRowState);
  const shownTotal = rowsTotal(shownRows.map((r) => ({ amount: Number.isFinite(num(r.amount)) ? num(r.amount) : 0 })));
  const mismatch = figures.afterDiscount !== null && shownRows.length > 0 && Math.round(shownTotal * 100) !== Math.round(figures.afterDiscount * 100);

  const setProposal = (patch: Partial<typeof p>) => setP((s) => ({ ...s, ...patch }));
  const editRow = (i: number, patch: Partial<RowState>) => {
    const base = rowsEdited ? rows : generated.map(toRowState);
    setRows(base.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setRowsEdited(true);
  };
  const rebuild = () => {
    setRows([]);
    setRowsEdited(false);
  };

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      const payload: Record<string, unknown> = {
        title: v.title,
        type: v.type,
        dueAt: v.dueLocal ? fromLocalInputValue(v.dueLocal) : null,
        assigneeId: v.assigneeId || null,
        leadId: v.leadId || null,
        bookingId: v.bookingId || null,
        description: v.description,
      };
      // Unchanged links are not sent, so a link outside the editor's access is kept rather than cleared.
      if (mode === "edit") {
        if (v.leadId === initial.leadId) delete payload.leadId;
        if (v.bookingId === initial.bookingId) delete payload.bookingId;
      }
      if (plan) {
        const { downPaymentPct, ...rest } = p;
        payload.proposal = limits.canEditDownPayment ? { ...rest, downPaymentPct } : rest;
        if (rowsEdited) payload.rows = rows;
      }
      const result = mode === "create" ? await createTaskAction(payload) : await updateTaskAction(taskId!, payload);
      if (result.ok) {
        const id = mode === "create" ? (result.data as { taskId: string }).taskId : taskId!;
        return router.push(`/dashboard/tasks/${id}?saved=1`);
      }
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

  const text = (key: keyof typeof p, label: string, opts: { required?: boolean; type?: string; placeholder?: string; readOnly?: boolean; hint?: string; inputMode?: "decimal" | "numeric" } = {}) => (
    <Field label={label} required={opts.required} error={errors[`proposal.${key}`]} hint={opts.hint}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[`proposal.${key}`])}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          value={p[key]}
          placeholder={opts.placeholder}
          readOnly={opts.readOnly}
          autoComplete="off"
          disabled={pending}
          onChange={(e) => setProposal({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const readOnly = (label: string, value: string) => (
    <Field label={label}>
      {(id) => <Input id={id} value={value} readOnly tabIndex={-1} className="bg-zinc-100 text-zinc-700" />}
    </Field>
  );
  const area = (key: "bonuses" | "whyActNow" | "nextSteps", label: string) => (
    <Field label={label} error={errors[`proposal.${key}`]} hint="Optional. Printed only when filled in.">
      {(id, describedBy) => (
        <textarea id={id} aria-describedby={describedBy} rows={3} value={p[key]} onChange={(e) => setProposal({ [key]: e.target.value })} className={textareaClass} disabled={pending} />
      )}
    </Field>
  );

  return (
    <form
      noValidate
      aria-label={mode === "create" ? "Create task" : "Edit task"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      <FormSection title="Task">
        <Field label="Title" required error={errors.title} className="sm:col-span-2">
          {(id, describedBy) => (
            <Input id={id} aria-describedby={describedBy} invalid={Boolean(errors.title)} value={v.title} maxLength={200} disabled={pending} onChange={(e) => set({ title: e.target.value })} />
          )}
        </Field>
        <Field label="Type" required error={errors.type}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.type} onChange={(e) => set({ type: e.target.value as TaskType })} className={selectClass} disabled={pending}>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Due (Pakistan time)" error={errors.dueAt}>
          {(id, describedBy) => (
            <Input id={id} aria-describedby={describedBy} type="datetime-local" value={v.dueLocal} disabled={pending} onChange={(e) => set({ dueLocal: e.target.value })} />
          )}
        </Field>
        <Field label="Assignee" required error={errors.assigneeId}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })} className={selectClass} disabled={pending}>
              {options.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Lead" error={errors.leadId}>
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.leadId} onChange={(e) => set({ leadId: e.target.value })} className={selectClass} disabled={pending}>
              <option value="">No lead</option>
              {options.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Booking" error={errors.bookingId} className="sm:col-span-2">
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} value={v.bookingId} onChange={(e) => set({ bookingId: e.target.value })} className={selectClass} disabled={pending}>
              <option value="">No booking</option>
              {options.bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.leadName} ({b.leadCode}) · Unit {b.unitNo} · {b.projectName}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Description" error={errors.description} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea id={id} aria-describedby={describedBy} rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} className={textareaClass} disabled={pending} />
          )}
        </Field>
      </FormSection>

      {plan ? (
        <section aria-label="Proposal template" className="space-y-4">
          <p className="text-[10px] font-black tracking-[0.2em] text-zinc-500 uppercase">Proposal template</p>
          <Step n="01" title="Cover page" hint="Printed on the proposal face sheet">
            {text("customerName", "Customer name", { required: true })}
            {text("preparedDate", "Prepared date", { type: "date" })}
            {text("preparedByName", "Prepared by (name)")}
            {text("preparedByTitle", "Prepared by (title)")}
          </Step>
          <Step n="01" title="Project & client" hint="Names appear on the printed proposal header">
            <Field label="Project" error={errors["proposal.projectId"]}>
              {(id, describedBy) => (
                <select
                  id={id}
                  aria-describedby={describedBy}
                  value={p.projectId}
                  onChange={(e) => {
                    const name = options.projects.find((x) => x.id === e.target.value)?.name ?? "";
                    setProposal({ projectId: e.target.value, unitId: "", printTitle: p.printTitle || name.replace(/ \(inactive\)$/, "") });
                  }}
                  className={selectClass}
                  disabled={pending}
                >
                  <option value="">Select a project…</option>
                  {options.projects.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {text("printTitle", "Project name (print title)")}
            {text("clientName", "Client name (print header)")}
            {text("customHeader", "Custom header (optional)")}
          </Step>
          <Step n="02" title="Unit" hint="Pick inventory to auto-fill area, apartment, and list price">
            <Field label="Unit" error={errors["proposal.unitId"]} className="sm:col-span-2">
              {(id, describedBy) => (
                <select id={id} aria-describedby={describedBy} value={p.unitId} onChange={(e) => setProposal({ unitId: e.target.value })} className={selectClass} disabled={pending || !p.projectId}>
                  <option value="">{p.projectId ? (projectUnits.length ? "Pick unit…" : "No available units in this project") : "Pick a project first"}</option>
                  {projectUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unitNo} · {formatArea(u.areaSqft)} · {u.status.replace("_", " ")}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {readOnly("Unit description", unit ? [unit.type, unit.category, unit.bedrooms ? `${unit.bedrooms} bed` : null].filter(Boolean).join(" · ") || "—" : "—")}
            {readOnly("Apartment no", unit?.unitNo ?? "—")}
            {readOnly("Area sq ft", areaSqft ? formatArea(areaSqft) : "—")}
            {readOnly("Price / sq ft (PKR)", pricePerSqft ? formatPrice(pricePerSqft) : unit ? "No list price, floor rate or default rate set" : "—")}
            {readOnly("Total sale value (list)", formatPrice(figures.totalList))}
            <p className="text-[11px] text-zinc-500 sm:col-span-2">
              Total sale value = area × price per sq ft. When the unit has no list price, the rate for its floor (GF, FF, SF) or the default rate in settings is used. Your discount limit is {limits.discountCap}%.
            </p>
          </Step>
          <Step n="03" title="Discount & payments" hint="Summary figures feed the printed schedule">
            {/* One column on phones so amounts are never cut off. */}
            <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
              <SummaryTile label="After discount" value={formatPrice(figures.afterDiscount)} />
              <SummaryTile label="Down payment" value={formatPrice(figures.downPayment)} />
              <SummaryTile label="Each installment" value={formatPrice(figures.eachInstallment)} />
              <SummaryTile label="Installments" value={Number.isFinite(count) ? count : "—"} />
            </div>
            {text("discountPct", "Discount %", { inputMode: "decimal", hint: `0 to ${limits.discountCap}%` })}
            {readOnly("Sale value after discount", formatPrice(figures.afterDiscount))}
            {limits.canEditDownPayment ? text("downPaymentPct", "Down payment %", { inputMode: "decimal" }) : readOnly("Down payment %", `${p.downPaymentPct}%`)}
            {readOnly("Down payment (PKR)", formatPrice(figures.downPayment))}
            {text("installmentCount", "No. of installments", { inputMode: "numeric" })}
            {readOnly("Each installment (PKR)", formatPrice(figures.eachInstallment))}
            {text("recurringLabel", "Recurring row label")}
            {text("firstInstallmentMonth", "First installment month", { type: "month", required: true, hint: "Installments are due on the 10th of each month from this month." })}
          </Step>
          <Step n="04" title="ROI & vouchers" hint="Optional extras printed with the investment summary">
            {text("freeNightVouchers", "Free night vouchers", { inputMode: "numeric" })}
            {readOnly("Expected ROI annually (auto)", figures.roiAnnual !== null ? formatPrice(figures.roiAnnual) : roiPerSqft ? "Pick a unit" : "ROI per sq ft not set")}
          </Step>
          <Step n="05" title="Installment schedule" hint={`${shownRows.length} rows · ready for print. A proposed plan only: it does not record or change payments.`} wide>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cn("text-[11px] font-semibold", mismatch ? "text-amber-700" : "text-zinc-500")} aria-live="polite">
                {rowsEdited ? "Rows edited by hand. " : ""}
                Schedule total {formatPrice(shownTotal)}
                {mismatch ? ` differs from the sale value after discount (${formatPrice(figures.afterDiscount)}).` : ""}
              </p>
              <Button type="button" variant="secondary" className="h-[33px] px-3 text-xs" onClick={rebuild} disabled={pending || !rowsEdited}>
                <RotateCcw aria-hidden="true" className="size-3.5" />
                Rebuild installment rows
              </Button>
            </div>
            {shownRows.length === 0 ? (
              <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">Pick a unit or set sale totals — installment rows generate automatically.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-xl border border-zinc-200/80">
                <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-zinc-100">
                    <tr className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                      <th scope="col" className="w-10 px-2 py-2.5">#</th>
                      <th scope="col" className="px-2 py-2.5">Installment</th>
                      <th scope="col" className="px-2 py-2.5">Description</th>
                      <th scope="col" className="px-2 py-2.5">Progress</th>
                      <th scope="col" className="px-2 py-2.5">Due date</th>
                      <th scope="col" className="px-2 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((r, i) => {
                      const cell = (key: keyof RowState, label: string, className?: string) => (
                        <td className="px-1 py-1">
                          <input
                            aria-label={`Row ${i + 1} ${label}`}
                            aria-invalid={Boolean(errors[`rows.${i}.${key}`]) || undefined}
                            title={errors[`rows.${i}.${key}`]}
                            value={r[key]}
                            disabled={pending}
                            onChange={(e) => editRow(i, { [key]: e.target.value })}
                            className={cn(
                              "h-8 w-full rounded-lg border border-transparent bg-transparent px-1.5 text-xs font-medium hover:border-zinc-200 focus:border-brand/50 focus:bg-white focus:outline-none",
                              errors[`rows.${i}.${key}`] && "border-rose-300 bg-rose-50",
                              className,
                            )}
                          />
                        </td>
                      );
                      return (
                        <tr key={i} className="border-t border-zinc-100">
                          <td className="px-2 py-1 font-bold text-zinc-500 tabular-nums">{i + 1}</td>
                          {cell("label", "installment")}
                          {cell("description", "description")}
                          {cell("progress", "progress")}
                          {i === 0 ? <td className="px-2 py-1 text-zinc-400">—</td> : cell("dueOn", "due date", "tabular-nums")}
                          {cell("amount", "amount", "text-right tabular-nums")}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {Object.keys(errors).some((k) => k.startsWith("rows")) ? <p className="text-xs font-semibold text-rose-600">Check the highlighted schedule rows.</p> : null}
          </Step>
          <Step n="06" title="Print sections" hint="Sections with no fixed content: write them for this customer, or leave blank to omit" wide>
            {area("bonuses", "Exclusive bonuses & incentives")}
            {area("whyActNow", "Why act now")}
            {area("nextSteps", "Next steps")}
          </Step>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Link href={mode === "create" ? "/dashboard/tasks" : `/dashboard/tasks/${taskId}`} className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
