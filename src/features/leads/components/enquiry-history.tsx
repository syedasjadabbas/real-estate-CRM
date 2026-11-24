"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-time-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { recordRepeatEnquiryAction } from "../actions";
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from "../format";
import { textareaClass } from "./follow-up-dialog";
import { selectClass } from "./lead-fields";

export type EnquiryItem = {
  id: string;
  leadCode: string | null;
  projectName: string;
  isRepeat: boolean;
  enquiredAt: Date | string;
  channel: string | null;
  agentName: string | null;
  recordedBy: string | null;
  note: string | null;
};

/** Every enquiry, newest first. `showLead` on the client page, where they span projects. */
export function EnquiryList({ rows, showLead = false }: { rows: EnquiryItem[]; showLead?: boolean }) {
  if (rows.length === 0) return <EmptyState size="sm">No enquiries recorded.</EmptyState>;
  return (
    <ol className="max-h-[420px] space-y-2 overflow-y-auto">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-zinc-200/80 px-3 py-2.5 text-xs shadow-hairline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold">{formatDateTime(r.enquiredAt)}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] leading-4 font-black uppercase", r.isRepeat ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-600")}>
              {r.isRepeat ? "Repeat enquiry" : "First enquiry"}
            </span>
          </div>
          <p className="mt-1 text-zinc-700">
            <b>{r.channel ?? "Channel not recorded"}</b> · {r.projectName}
            {showLead && r.leadCode ? ` · ${r.leadCode}` : ""}
          </p>
          {r.agentName || r.recordedBy ? (
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {r.agentName ? `Agent ${r.agentName}` : ""}
              {r.agentName && r.recordedBy ? " · " : ""}
              {r.recordedBy ? `recorded by ${r.recordedBy}` : ""}
            </p>
          ) : null}
          {r.note ? <p className="mt-1 whitespace-pre-line text-zinc-600">{r.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/** Channel dropdown with Other, shared by the lead page and the Add lead conflict dialog. */
export function ChannelFields({
  sources,
  channel,
  other,
  errors,
  disabled,
  onChange,
}: {
  sources: { id: string; name: string }[];
  channel: string;
  other: string;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (patch: { channel?: string; other?: string }) => void;
}) {
  return (
    <>
      <Field label="Channel" required error={errors.channel}>
        {(id, d) => (
          <select id={id} aria-describedby={d} value={channel} onChange={(e) => onChange({ channel: e.target.value })} className={selectClass} disabled={disabled}>
            <option value="">Select…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
        )}
      </Field>
      {channel === "other" ? (
        <Field label="Other channel" required error={errors.channelOther}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.channelOther)} maxLength={80} value={other} disabled={disabled} onChange={(e) => onChange({ other: e.target.value })} />}
        </Field>
      ) : null}
    </>
  );
}

export function RecordEnquiryForm({ leadId, sources }: { leadId: string; sources: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState("");
  const [other, setOther] = useState("");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await recordRepeatEnquiryAction(leadId, { channel, channelOther: other, at: at ? fromLocalInputValue(at) : "", note });
      if (result.ok) {
        setOpen(false);
        setChannel("");
        setOther("");
        setNote("");
        setErrors({});
        setMsg({ text: "Repeat enquiry recorded.", ok: true });
      } else {
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
      }
    });

  return (
    <div className="mb-3 space-y-3">
      {open ? (
        <form
          noValidate
          aria-label="Record repeat enquiry"
          className="space-y-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <ChannelFields
            sources={sources}
            channel={channel}
            other={other}
            errors={errors}
            disabled={pending}
            onChange={(p) => {
              if (p.channel !== undefined) setChannel(p.channel);
              if (p.other !== undefined) setOther(p.other);
            }}
          />
          <Field label="When (Pakistan time)" required error={errors.at}>
            {(id, d) => <DateTimeInput id={id} describedBy={d} invalid={Boolean(errors.at)} value={at} quick={false} disabled={pending} onChange={setAt} />}
          </Field>
          <Field label="Notes" error={errors.note}>
            {(id, d) => <textarea id={id} aria-describedby={d} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} disabled={pending} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="lg" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={pending || !channel}>
              {pending ? "Saving…" : "Save enquiry"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            setAt(toLocalInputValue(new Date()));
            setMsg(null);
            setOpen(true);
          }}
        >
          Record repeat enquiry
        </Button>
      )}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
