"use client";

import { Download, ExternalLink, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { DOCUMENT_ACCEPT, documentFormatOf, MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import type { LeadFileRow } from "@/modules/files/lead-files";
import { extensionOf, formatBytes } from "@/modules/recordings/validation";

type FileRow = Pick<LeadFileRow, "id" | "name" | "mime" | "sizeBytes" | "createdAt" | "uploadedBy"> & { /** Where it came from, when the list mixes sources. */ origin?: string | null };

/** Wording and endpoints; the defaults are the lead documents panel. */
type PanelText = { title: string; empty: string; field: string; button: string; uploaded: string; noun: string };
const LEAD_DOCUMENTS: PanelText = { title: "Documents", empty: "No documents yet.", field: "Upload a document", button: "Upload document", uploaded: "Document uploaded.", noun: "Documents" };

/**
 * Lead documents (FR-038): private files, opened through the authenticated `/api/v1/documents/:id`
 * route. Also used for payment proofs (Q33) with their own endpoints and wording.
 */
export function DocumentsPanel({
  leadId,
  documents,
  canUpload,
  uploadUrl = `/api/v1/leads/${leadId}/documents`,
  fileBase = "/api/v1/documents",
  text = LEAD_DOCUMENTS,
}: {
  leadId?: string;
  documents: FileRow[];
  canUpload: boolean;
  uploadUrl?: string;
  /** Files are served at `${fileBase}/:id` (a string: props from server pages must be serialisable). */
  fileBase?: string;
  text?: PanelText;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const choose = (f: File | null) => {
    setMsg(null);
    setFile(null);
    if (!f) return;
    if (!documentFormatOf(extensionOf(f.name))) return setMsg({ text: "Upload a PDF, JPG, PNG, DOCX or XLSX file.", ok: false });
    if (f.size > MAX_DOCUMENT_BYTES) return setMsg({ text: `${text.noun} can be at most 10 MB.`, ok: false });
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setPending(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(uploadUrl, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) return setMsg({ text: json?.error?.message ?? "Upload failed. Try again.", ok: false });
      setFile(null);
      if (input.current) input.current.value = "";
      setMsg({ text: text.uploaded, ok: true });
      router.refresh();
    } catch {
      setMsg({ text: "Upload failed. Check your connection and try again.", ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <PanelCard title={`${text.title} · ${documents.length}`}>
      {documents.length === 0 ? (
        <EmptyState size="sm">{text.empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {documents.map((d) => {
            const image = d.mime.startsWith("image/");
            return (
              <li key={d.id} className="flex items-start justify-between gap-2 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <p className="text-xs font-bold break-words text-zinc-900">{d.name}</p>
                  <p className="text-[11px] text-zinc-500">
                    {d.origin ? `${d.origin} · ` : ""}
                    {d.uploadedBy ?? "—"} · {formatDateTime(d.createdAt)} · {formatBytes(d.sizeBytes)}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  {image ? (
                    <a href={`${fileBase}/${d.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline" aria-label={`Open ${d.name}`}>
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                      Open
                    </a>
                  ) : null}
                  <a href={`${fileBase}/${d.id}?download=1`} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline" aria-label={`Download ${d.name}`}>
                    <Download aria-hidden="true" className="size-3.5" />
                    Save
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload ? (
        <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
          <label htmlFor={inputId} className="block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
            {text.field}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={DOCUMENT_ACCEPT}
            disabled={pending}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800"
          />
          <p className="text-[11px] text-zinc-500">PDF, JPG, PNG, DOCX or XLSX, up to 10 MB.</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {msg ? (
              <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                {msg.text}
              </p>
            ) : null}
            <Button variant="primary" size="lg" disabled={!file || pending} onClick={upload}>
              <Upload aria-hidden="true" className="size-4" />
              {pending ? "Uploading…" : text.button}
            </Button>
          </div>
        </div>
      ) : null}
    </PanelCard>
  );
}
