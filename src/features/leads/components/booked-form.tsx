"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatSqft } from "@/modules/leads/size";
import { bookedFormOptionsAction } from "../actions";
import { textareaClass } from "./follow-up-dialog";
import { selectClass } from "./lead-fields";

type Options = { waiting: boolean; bookings: { id: string; unitNo: string }[]; units: { id: string; unitNo: string; areaSqft: number; floor: string | null; block: string | null }[] };

/** Successfully Booked (client, 25 Nov 2026): the unit, what was received and the screenshots; an Admin approves it. */
export function BookedForm({ leadId, onBack, onSaved }: { leadId: string; onBack: () => void; onSaved?: (text: string) => void }) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [search, setSearch] = useState("");
  const [unitId, setUnitId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    bookedFormOptionsAction(leadId).then((r) => {
      if (!live) return;
      if (r.ok) setOptions(r.data);
      else setMsg({ text: r.message, ok: false });
    });
    return () => {
      live = false;
    };
  }, [leadId]);

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const units = (options?.units ?? []).filter((u) => u.id === unitId || words.every((w) => `${u.unitNo} ${u.floor ?? ""} ${u.block ?? ""} ${u.areaSqft}`.toLowerCase().includes(w)));

  const submit = async () => {
    setPending(true);
    setMsg(null);
    setErrors({});
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (bookingId) form.set("bookingId", bookingId);
    if (unitId) form.set("unitId", unitId);
    if (amount) form.set("tokenAmount", amount);
    if (note) form.set("note", note);
    const res = await fetch(`/api/v1/leads/${leadId}/booked`, { method: "POST", body: form }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
    setPending(false);
    if (!res?.ok) {
      setErrors(json?.error?.fields ?? {});
      setMsg({ text: json?.error?.message ?? "It couldn't be sent. Try again.", ok: false });
      return;
    }
    setMsg({ text: "Sent. An Admin approves it.", ok: true });
    router.refresh();
    onSaved?.("Sent to an Admin.");
  };

  return (
    <div className="space-y-4 rounded-2xl border border-brand/30 bg-white p-5 shadow-hairline">
      <div>
        <h3 className="text-sm font-black">Successfully booked</h3>
        <p className="text-[11px] text-zinc-500">The unit is held now. The lead becomes Booked when an Admin approves it and the down payment is posted in Finance.</p>
      </div>
      {options?.waiting ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">This sale is already waiting for an Admin.</p>
      ) : options ? (
        <>
          {options.bookings.length === 1 ? <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">For the open booking of unit {options.bookings[0].unitNo}.</p> : null}
          {options.bookings.length > 1 ? (
            <Field label="Booking" required error={errors.bookingId}>
              {(id) => (
                <select id={id} value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={selectClass} disabled={pending}>
                  <option value="">Select…</option>
                  {options.bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      Unit {b.unitNo}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {options.bookings.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Search units">{(id) => <Input id={id} type="search" value={search} placeholder="Unit, block, floor or size" onChange={(e) => setSearch(e.target.value)} disabled={pending} />}</Field>
              <Field label="Unit" required error={errors.unitId}>
                {(id) => (
                  <select id={id} value={unitId} onChange={(e) => setUnitId(e.target.value)} className={selectClass} disabled={pending}>
                    <option value="">{units.length ? `Select… (${units.length})` : "No available unit"}</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {[u.unitNo, u.block && `Block ${u.block}`, u.floor, formatSqft(u.areaSqft)].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Amount received (PKR)" required error={errors.tokenAmount}>
                {(id) => <Input id={id} inputMode="numeric" value={amount} placeholder="e.g. 500,000" onChange={(e) => setAmount(e.target.value)} disabled={pending} />}
              </Field>
            </div>
          ) : null}
          <Field label="Screenshots" required hint="JPG, PNG or PDF, up to 5 files of 10 MB" error={errors.files ?? errors.file}>
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                disabled={pending}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800"
              />
            )}
          </Field>
          <Field label="Note" error={errors.note}>
            {(id) => <textarea id={id} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} disabled={pending} />}
          </Field>
        </>
      ) : msg ? null : (
        <p role="status" className="text-xs text-zinc-500">
          Loading units…
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={`mr-auto text-xs font-semibold ${msg.ok ? "text-brand" : "text-rose-600"}`}>
            {msg.text}
          </p>
        ) : null}
        <Button variant="secondary" size="lg" disabled={pending} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" size="lg" disabled={pending || !options || options.waiting || Boolean(msg?.ok)} onClick={submit}>
          {pending ? "Sending…" : "Send to Admin"}
        </Button>
      </div>
    </div>
  );
}
