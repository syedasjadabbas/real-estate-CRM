"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { decideImportAction, submitImportAction } from "../import-actions";
import { selectClass } from "./lead-fields";
import { textareaClass } from "./follow-up-dialog";

/** Upload a CSV as a batch. It stays pending until a Super Admin approves it. */
export function ImportUploadForm({ projects, defaultProjectId }: { projects: { id: string; name: string }[]; defaultProjectId: string }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      aria-label="Submit an import batch"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return setMsg({ text: "Choose a CSV file.", ok: false });
        startTransition(async () => {
          const r = await submitImportAction({ projectId, fileName: file.name, csv: file.text });
          if (r.ok) router.push(`/dashboard/leads/import/${r.data.batchId}`);
          else setMsg({ text: r.fields?.csv ?? r.message, ok: false });
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Project" required>
          {(id) => (
            <select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectClass} disabled={pending}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="CSV file" required>
          {(id) => (
            <input
              id={id}
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              className="block w-full text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setFile(f ? { name: f.name, text: await f.text() } : null);
              }}
            />
          )}
        </Field>
      </div>
      <p className="text-[11px] text-zinc-500">
        Columns: <code>name, phone, source</code> (required), then any of <code>phone_country_code, phone2–phone5, email, city, budget, priority, size, gender, note</code>. Up to 2,000 rows.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending || !file}>
          {pending ? "Checking…" : "Submit for approval"}
        </Button>
      </div>
    </form>
  );
}

/** Super Admin decision on a pending batch. Rejecting needs a reason. */
export function ImportDecision({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const r = await decideImportAction(batchId, approve, note);
      if (r.ok) {
        setMsg({ text: r.data.status === "approved" ? `Approved: ${r.data.created} lead${r.data.created === 1 ? "" : "s"} created${r.data.skipped ? `, ${r.data.skipped} skipped` : ""}.` : "Rejected.", ok: true });
        router.refresh();
      } else setMsg({ text: r.fields?.note ?? r.message, ok: false });
    });
  return (
    <div className="space-y-3">
      <Field label="Note (required to reject)">
        {(id) => <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} disabled={pending} />}
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {msg ? (
          <p role="status" className={cn("text-xs font-semibold", msg.ok ? "text-emerald-700" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button variant="secondary" size="lg" disabled={pending} onClick={() => decide(false)}>
          Reject batch
        </Button>
        <Button variant="primary" size="lg" disabled={pending} onClick={() => decide(true)}>
          {pending ? "Working…" : "Approve batch"}
        </Button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Approving creates the valid rows as leads through the normal assignment. <Link href="/dashboard/leads/import" className="font-bold text-brand hover:underline">Back to batches</Link>
      </p>
    </div>
  );
}
