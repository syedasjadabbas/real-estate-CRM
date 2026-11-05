"use client";

import { OTHER_CITY } from "@/modules/cities/constants";
import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { FollowUpForm, textareaClass } from "@/features/leads/components/follow-up-dialog";
import { selectClass } from "@/features/leads/components/lead-fields";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import type { ClientDetail } from "@/modules/clients/queries";
import {
  addClientNoteAction,
  assignClientAction,
  completeClientFollowUpAction,
  scheduleClientFollowUpAction,
  updateClientAction,
} from "../actions";
import { ClientFields, type ClientFormValues } from "./client-fields";

function Status({ message, ok }: { message: string | null; ok?: boolean }) {
  if (!message) return null;
  return (
    <p role={ok ? "status" : "alert"} className={cn("text-xs font-semibold", ok ? "text-brand" : "text-rose-600")}>
      {message}
    </p>
  );
}

export function EditClientForm({ detail, cities }: { detail: ClientDetail; cities: { id: string; name: string }[] }) {
  const { client } = detail;
  const initial: ClientFormValues = {
    name: client.name,
    phoneCountryCode: client.phoneCountryCode,
    phoneNumber: client.phoneNumber,
    email: client.email ?? "",
    cityId: client.cityOther ? OTHER_CITY : (client.cityId ?? ""),
    cityOther: client.cityOther ?? "",
    relationship: client.relationship ?? "",
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  return (
    <form
      noValidate
      aria-label="Client details"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateClientAction(client.id, values);
          if (result.ok) {
            setErrors({});
            setMsg({ text: result.data.changed.length ? "Changes saved." : "Nothing changed.", ok: true });
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.message, ok: false });
          }
        });
      }}
      className="space-y-4"
    >
      <ClientFields
        values={values}
        onChange={(p) => setValues((v) => ({ ...v, ...p }))}
        errors={errors}
        cities={cities}
        currentCity={client.cityId ? { id: client.cityId, name: client.cityName } : null}
        disabled={pending || !detail.permissions.edit}
      />
      {detail.permissions.edit ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Status message={msg?.text ?? null} ok={msg?.ok} />
          <Button
            variant="secondary"
            size="lg"
            disabled={!dirty || pending}
            onClick={() => {
              setValues(initial);
              setErrors({});
              setMsg(null);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function AssignClientPanel({ clientId, ownerId, owners }: { clientId: string; ownerId: string | null; owners: { id: string; name: string }[] }) {
  const [value, setValue] = useState(ownerId ?? "");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PanelCard title="Assignment">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Owner" className="min-w-0 flex-1">
          {(id) => (
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)} className={selectClass} disabled={pending}>
              {ownerId ? null : <option value="">Unassigned</option>}
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          variant="primary"
          size="lg"
          disabled={!value || value === ownerId || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await assignClientAction(clientId, value);
              setMsg(result.ok ? { text: "Client reassigned.", ok: true } : { text: result.message, ok: false });
            })
          }
        >
          Reassign
        </Button>
      </div>
      <div className="mt-2">
        <Status message={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </PanelCard>
  );
}

export function ClientFollowUpsPanel({ detail }: { detail: ClientDetail }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = detail.generatedAt;
  const clientId = detail.client.id;
  return (
    <PanelCard title="Follow-ups">
      <div className="space-y-4">
        {detail.followUps.length === 0 ? (
          <EmptyState size="sm">No follow-ups yet.</EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {detail.followUps.map((f) => {
              const overdue = f.status === "pending" && new Date(f.dueAt).getTime() < now;
              return (
                <li key={f.id} className="flex items-start justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                  <div className="min-w-0">
                    <p className={cn("font-bold", overdue ? "text-rose-600" : f.status === "pending" ? "text-zinc-900" : "text-zinc-400 line-through")}>
                      {formatDateTime(f.dueAt)}
                      {overdue ? " · overdue" : ""}
                    </p>
                    {f.note ? <p className="text-zinc-600">{f.note}</p> : null}
                    {f.status === "done" ? <p className="text-[11px] text-zinc-500">Done {formatDateTime(f.doneAt)}</p> : null}
                  </div>
                  {f.status === "pending" && detail.permissions.edit ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await completeClientFollowUpAction(f.id);
                          setError(result.ok ? null : result.message);
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200/80 bg-white px-2 py-1 text-[10px] font-black text-zinc-700 uppercase hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <Check aria-hidden="true" className="size-3" /> Done
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Status message={error} />
        {detail.permissions.scheduleFollowUp ? (
          <div className="border-t border-zinc-100 pt-4">
            <FollowUpForm schedule={(input) => scheduleClientFollowUpAction(clientId, input)} />
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

export function ClientNotePanel({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canEdit) return null;
  return (
    <PanelCard title="Notes">
      <div className="space-y-2">
        <label className="sr-only" htmlFor="new-client-note">
          New note
        </label>
        <textarea
          id="new-client-note"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Call outcome, payment question, next step…"
          className={textareaClass}
          disabled={pending}
        />
        <Button
          variant="primary"
          size="lg"
          disabled={!body.trim() || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addClientNoteAction(clientId, body);
              if (result.ok) {
                setBody("");
                setMsg({ text: "Note added.", ok: true });
              } else setMsg({ text: result.message, ok: false });
            })
          }
        >
          Add note
        </Button>
        <Status message={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </PanelCard>
  );
}
