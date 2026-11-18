"use client";

import { MessageCircle, Phone, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { formatClock } from "@/modules/recordings/validation";

type Row = { id: string; kind: "whatsapp_call" | "whatsapp_chat"; name: string; durationSec: number | null; createdAt: string; uploadedBy: string | null };

const MAX_BYTES = 10 * 1024 * 1024;
const fieldClass = "h-10 w-full rounded-xl border border-zinc-200/80 bg-white px-3 text-sm font-semibold shadow-hairline focus:border-brand/50 focus:outline-none";

/**
 * WhatsApp proof (owner, 18 Nov 2026): a screenshot of a WhatsApp call counts as a call (with the length
 * read off it); chat screenshots are proof of the conversation. Images open full size.
 */
export function WhatsappPanel({ leadId, rows, canUpload }: { leadId: string; rows: Row[]; canUpload: boolean }) {
  const router = useRouter();
  const fileId = useId();
  const lengthId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"whatsapp_call" | "whatsapp_chat">("whatsapp_call");
  const [files, setFiles] = useState<File[]>([]);
  const [length, setLength] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const calls = rows.filter((r) => r.kind === "whatsapp_call");
  const chats = rows.filter((r) => r.kind === "whatsapp_chat");

  const choose = (list: FileList | null) => {
    setMsg(null);
    const all = Array.from(list ?? []);
    const bad = all.find((f) => !/^image\/(jpeg|png|webp)$/.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name));
    if (bad) return setFiles([]), setMsg({ text: `${bad.name}: upload a JPG, PNG or WebP screenshot.`, ok: false });
    const big = all.find((f) => f.size > MAX_BYTES);
    if (big) return setFiles([]), setMsg({ text: `${big.name} is over 10 MB.`, ok: false });
    setFiles(kind === "whatsapp_call" ? all.slice(0, 1) : all);
  };

  const upload = async () => {
    if (files.length === 0) return;
    if (kind === "whatsapp_call" && !length.trim()) return setMsg({ text: "Enter the call length shown in the screenshot, e.g. 3:25.", ok: false });
    setPending(true);
    setMsg(null);
    let done = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        form.set("kind", kind);
        if (kind === "whatsapp_call") form.set("length", length);
        const res = await fetch(`/api/v1/leads/${leadId}/whatsapp`, { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) {
          setMsg({ text: json?.error?.message ?? "Upload failed. Try again.", ok: false });
          break;
        }
        done += 1;
      }
      if (done === files.length) setMsg({ text: kind === "whatsapp_call" ? "WhatsApp call added; it counts as a call." : done === 1 ? "Chat screenshot added." : `${done} chat screenshots added.`, ok: true });
      setFiles([]);
      setLength("");
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setMsg({ text: "Upload failed. Check your connection and try again.", ok: false });
    } finally {
      setPending(false);
    }
  };

  const tile = (r: Row) => (
    <li key={r.id} className="overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50">
      <a href={`/api/v1/whatsapp/${r.id}`} target="_blank" rel="noopener" aria-label={`Open ${r.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated screenshot */}
        <img src={`/api/v1/whatsapp/${r.id}`} alt={r.name} loading="lazy" className="aspect-[3/4] w-full object-cover object-top" />
      </a>
      <p className="truncate px-2 py-1 text-[10px] text-zinc-600" title={`${r.uploadedBy ?? "—"} · ${formatDateTime(r.createdAt)}`}>
        {r.kind === "whatsapp_call" && r.durationSec !== null ? <b className="text-zinc-900">{formatClock(r.durationSec)} · </b> : null}
        {r.uploadedBy ?? "—"} · {formatDateTime(r.createdAt)}
      </p>
    </li>
  );

  return (
    <PanelCard title={`WhatsApp · ${calls.length} call${calls.length === 1 ? "" : "s"}, ${chats.length} chat${chats.length === 1 ? "" : "s"}`}>
      {rows.length === 0 ? (
        <EmptyState size="sm">No WhatsApp screenshots yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {calls.length ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
                <Phone aria-hidden="true" className="size-3" /> Calls (each counts as a call)
              </p>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{calls.map(tile)}</ul>
            </div>
          ) : null}
          {chats.length ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
                <MessageCircle aria-hidden="true" className="size-3" /> Chats
              </p>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{chats.map(tile)}</ul>
            </div>
          ) : null}
        </div>
      )}

      {canUpload ? (
        <div className="mt-4 space-y-2.5 border-t border-zinc-100 pt-4">
          <div role="radiogroup" aria-label="Screenshot of" className="flex gap-1.5">
            {(
              [
                ["whatsapp_call", "WhatsApp call"],
                ["whatsapp_chat", "WhatsApp chat"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setFiles([]);
                  setMsg(null);
                  if (input.current) input.current.value = "";
                }}
                className={cn("rounded-xl px-3 py-1.5 text-xs font-bold ring-1", kind === k ? "bg-brand text-white ring-brand" : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50")}
              >
                {label}
              </button>
            ))}
          </div>
          <label htmlFor={fileId} className="block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
            {kind === "whatsapp_call" ? "Screenshot of the call (from the WhatsApp call log)" : "Chat screenshots (you can pick several)"}
          </label>
          <input
            ref={input}
            id={fileId}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple={kind === "whatsapp_chat"}
            disabled={pending}
            onChange={(e) => choose(e.target.files)}
            className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800"
          />
          {kind === "whatsapp_call" ? (
            <div className="max-w-[12rem]">
              <label htmlFor={lengthId} className="block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
                Call length
              </label>
              <input id={lengthId} value={length} onChange={(e) => setLength(e.target.value)} placeholder="e.g. 3:25" inputMode="numeric" disabled={pending} className={fieldClass} />
            </div>
          ) : null}
          <p className="text-[11px] text-zinc-500">
            JPG, PNG or WebP, up to 10 MB.{" "}
            {kind === "whatsapp_call" ? "A WhatsApp call counts as one call in Performance, Targets and the daily report." : "Chats are kept as proof and mark the lead as contacted; they don't count as calls."}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {msg ? (
              <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                {msg.text}
              </p>
            ) : null}
            <Button variant="primary" size="lg" disabled={files.length === 0 || pending} onClick={upload}>
              <Upload aria-hidden="true" className="size-4" />
              {pending ? "Uploading…" : kind === "whatsapp_call" ? "Add WhatsApp call" : files.length > 1 ? `Add ${files.length} chats` : "Add chat"}
            </Button>
          </div>
        </div>
      ) : null}
    </PanelCard>
  );
}
