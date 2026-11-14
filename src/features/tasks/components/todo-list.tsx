"use client";

import { Plus } from "lucide-react";
import { DateTimeInput } from "@/components/ui/date-time-input";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { LeadPicker } from "@/features/leads/components/lead-picker";
import { selectClass } from "@/features/leads/components/lead-fields";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import type { TodoRow } from "@/modules/tasks/queries";
import { createTaskAction, setTaskStatusAction } from "../actions";

/** Quick "when" choices, in Pakistan time on the user's clock. */
const WHEN = [
  { key: "today", label: "Today (6 PM)" },
  { key: "tomorrow", label: "Tomorrow (10 AM)" },
  { key: "3d", label: "In 3 days" },
  { key: "week", label: "Next week" },
  { key: "none", label: "No due date" },
  { key: "custom", label: "Pick a date and time" },
] as const;
type When = (typeof WHEN)[number]["key"];

function dueFor(when: When, now = new Date()): string {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return toLocalInputValue(d);
  };
  if (when === "today") return now.getHours() < 18 ? at(0, 18) : toLocalInputValue(new Date(now.getTime() + 3_600_000));
  if (when === "tomorrow") return at(1, 10);
  if (when === "3d") return at(3, 10);
  if (when === "week") return at(7, 10);
  return "";
}

/**
 * Add a to-do (owner, 14 Nov 2026): a plain task for today, tomorrow or any date, optionally about a
 * lead. Agents add their own; Admins and Super Admins can give one to anyone (HR and Accountants see
 * theirs in My workplace).
 */
export function AddTodoForm({
  meId,
  assignees,
  leads,
}: {
  meId: string;
  assignees: { id: string; name: string; role: string }[];
  leads: { id: string; name: string; code: string }[];
}) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<When>("today");
  const [due, setDue] = useState(() => dueFor("today"));
  const [leadId, setLeadId] = useState("");
  const [assigneeId, setAssigneeId] = useState(meId);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      const r = await createTaskAction({
        title,
        type: "general",
        dueAt: due ? fromLocalInputValue(due) : null,
        assigneeId,
        leadId: leadId || null,
        bookingId: null,
        description: note,
      });
      if (r.ok) {
        setTitle("");
        setNote("");
        setLeadId("");
        setErrors({});
        setMsg({ text: assigneeId === meId ? "To-do added." : "To-do added and given.", ok: true });
      } else {
        setErrors(r.fields ?? {});
        setMsg({ text: r.message, ok: false });
      }
    });

  return (
    <form
      noValidate
      aria-label="Add a to-do"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-hairline"
    >
      <p className="text-[10px] font-black tracking-[0.2em] text-brand uppercase">Add a to-do</p>
      <Field label="What needs doing" required error={errors.title}>
        {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.title)} value={title} maxLength={200} placeholder="e.g. Send the price list to Mr Ali" onChange={(e) => setTitle(e.target.value)} disabled={pending} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="When">
          {(id) => (
            <select
              id={id}
              value={when}
              onChange={(e) => {
                const w = e.target.value as When;
                setWhen(w);
                if (w !== "custom") setDue(dueFor(w));
              }}
              className={selectClass}
              disabled={pending}
            >
              {WHEN.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Due (Pakistan time)" error={errors.dueAt}>
          {(id, d) => (
            <DateTimeInput
              id={id}
              describedBy={d}
              invalid={Boolean(errors.dueAt)}
              value={due}
              quick={false}
              clearable
              disabled={pending}
              onChange={(value) => {
                setDue(value);
                setWhen(value ? "custom" : "none");
              }}
            />
          )}
        </Field>
      </div>
      <div className={cn("grid grid-cols-1 gap-3", assignees.length > 1 && "sm:grid-cols-2")}>
        <Field label="Lead (optional)" error={errors.leadId}>
          {(id, d) => (
            <LeadPicker id={id} describedBy={d} value={leadId} onChange={setLeadId} options={leads.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))} empty="No lead" disabled={pending} />
          )}
        </Field>
        {assignees.length > 1 ? (
          <Field label="For" error={errors.assigneeId}>
            {(id, d) => (
              <select id={id} aria-describedby={d} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectClass} disabled={pending}>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id === meId ? `Me (${a.name})` : a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
      <Field label="Note (optional)" error={errors.description}>
        {(id, d) => <textarea id={id} aria-describedby={d} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} disabled={pending} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          <Plus aria-hidden="true" className="size-4" />
          {pending ? "Adding…" : "Add to-do"}
        </Button>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function DoneButton({ taskId }: { taskId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await setTaskStatusAction(taskId, "done");
            setError(r.ok ? null : r.message);
          })
        }
        className="rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-[10px] font-black tracking-[0.025em] text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "…" : "Done"}
      </button>
      {error ? (
        <span role="alert" className="text-[10px] font-semibold text-rose-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Open to-dos, soonest first, with a Done button. `now` keeps "overdue" stable between server and client. */
export function TodoList({ rows, meId, now, showLeads = true }: { rows: TodoRow[]; meId: string; now: number; showLeads?: boolean }) {
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-xs text-zinc-500">Nothing on your to-do list.</p>;
  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200/80 bg-white shadow-hairline">
      {rows.map((r) => {
        const late = r.dueAt !== null && new Date(r.dueAt).getTime() < now;
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold break-words">{r.title}</p>
              <p className="text-[11px] text-zinc-500">
                <span className={cn(late && "font-bold text-rose-600")}>{r.dueAt ? `${late ? "Overdue · " : "Due "}${formatDateTime(r.dueAt)}` : "No due date"}</span>
                {r.assigneeId !== meId ? ` · for ${r.assigneeName}` : r.creatorName && r.creatorName !== r.assigneeName ? ` · from ${r.creatorName}` : ""}
                {showLeads && r.leadId ? (
                  <>
                    {" · "}
                    <Link href={`/dashboard/leads/${r.leadId}`} className="font-semibold text-brand hover:underline">
                      {r.leadName} ({r.leadCode})
                    </Link>
                  </>
                ) : null}
              </p>
              {r.description ? <p className="mt-1 text-xs whitespace-pre-line text-zinc-700">{r.description}</p> : null}
            </div>
            <DoneButton taskId={r.id} />
          </li>
        );
      })}
    </ul>
  );
}
