"use client";

import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import type { RecordingRow } from "@/modules/recordings/service";
import {
  extensionOf,
  formatBytes,
  formatClock,
  MAX_RECORDING_BYTES,
  RECORDING_ACCEPT,
  RECORDING_EXTENSIONS,
} from "@/modules/recordings/validation";

/** Reads the duration from the file's audio metadata in the browser; null when the browser can't. */
function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    audio.src = url;
  });
}

/**
 * Call recordings on a lead (FR-038). Agents record calls on their company Android phones with the
 * phone's built-in recorder, then upload the file here. Playback streams from the authenticated
 * `/api/v1/recordings/:id` route; nothing is public.
 */
export function RecordingsPanel({ leadId, recordings, canUpload }: { leadId: string; recordings: RecordingRow[]; canUpload: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  // Measured when the file is chosen; the upload never waits for it (null = not known).
  const duration = useRef<{ file: File; seconds: number | null } | null>(null);

  const choose = (f: File | null) => {
    setMsg(null);
    duration.current = null;
    if (!f) return setFile(null);
    if (!(RECORDING_EXTENSIONS as string[]).includes(extensionOf(f.name))) {
      setFile(null);
      setMsg({ text: "Upload an MP3, M4A, AAC, OGG or WAV recording.", ok: false });
      return;
    }
    if (f.size > MAX_RECORDING_BYTES) {
      setFile(null);
      setMsg({ text: "Recordings can be at most 25 MB.", ok: false });
      return;
    }
    setFile(f);
    void measureDuration(f).then((seconds) => {
      duration.current = { file: f, seconds };
    });
  };

  const upload = async () => {
    if (!file) return;
    setPending(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const measured = duration.current?.file === file ? duration.current.seconds : null;
      if (measured !== null) form.set("durationSec", String(measured));
      const res = await fetch(`/api/v1/leads/${leadId}/recordings`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setMsg({ text: json?.error?.message ?? "Upload failed. Try again.", ok: false });
        return;
      }
      setFile(null);
      if (input.current) input.current.value = "";
      setMsg({ text: "Recording uploaded.", ok: true });
      router.refresh();
    } catch {
      setMsg({ text: "Upload failed. Check your connection and try again.", ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <PanelCard title={`Call recordings · ${recordings.length}`}>
      {recordings.length === 0 ? (
        <EmptyState size="sm">No call recordings yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {recordings.map((r) => (
            <li key={r.id} className="rounded-xl border border-zinc-200/80 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-xs font-bold break-words text-zinc-900">{r.name}</p>
                <a
                  href={`/api/v1/recordings/${r.id}?download=1`}
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-brand hover:underline"
                  aria-label={`Download ${r.name}`}
                >
                  <Download aria-hidden="true" className="size-3.5" />
                  Save
                </a>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {r.uploadedBy ?? "—"} · {formatDateTime(r.createdAt)} · {formatBytes(r.sizeBytes)} · {formatClock(r.durationSec)}
              </p>
              <audio controls preload="none" src={`/api/v1/recordings/${r.id}`} className="mt-2 h-9 w-full" aria-label={`Play ${r.name}`}>
                Your browser cannot play this recording. Use Save to download it.
              </audio>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
          <label htmlFor={inputId} className="block text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
            Upload a recording
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={`${RECORDING_ACCEPT},audio/*`}
            disabled={pending}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800"
          />
          <p className="text-[11px] text-zinc-500">MP3, M4A, AAC, OGG or WAV, up to 25 MB. Record the call with the phone&apos;s built-in recorder, then upload it here.</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {msg ? (
              <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                {msg.text}
              </p>
            ) : null}
            <Button variant="primary" size="lg" disabled={!file || pending} onClick={upload}>
              <Upload aria-hidden="true" className="size-4" />
              {pending ? "Uploading…" : "Upload recording"}
            </Button>
          </div>
        </div>
      ) : msg ? (
        <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">
          {msg.text}
        </p>
      ) : null}
    </PanelCard>
  );
}
