"use client";

import { Camera, Download, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { extensionOf } from "@/modules/recordings/validation";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 20;
const OK_EXT = ["jpg", "jpeg", "png", "webp"];

type Photo = { id: string; name: string; createdAt: string; uploadedBy: string | null; canRemove: boolean };

/**
 * Meeting photos (owner, 16 Nov 2026): pictures taken at the meeting, kept with it so Admins and
 * Super Admins can see them later. Several can be picked at once (phones offer the camera).
 */
export function MeetingPhotos({ meetingId, photos, canUpload }: { meetingId: string; photos: Photo[]; canUpload: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const room = MAX_PHOTOS - photos.length;

  const choose = (list: FileList | null) => {
    setMsg(null);
    const all = Array.from(list ?? []);
    const bad = all.find((f) => !OK_EXT.includes(extensionOf(f.name).toLowerCase()) && !/^image\/(jpeg|png|webp)$/.test(f.type));
    if (bad) return setPicked([]), setMsg({ text: `${bad.name}: upload JPG, PNG or WebP photos.`, ok: false });
    const big = all.find((f) => f.size > MAX_BYTES);
    if (big) return setPicked([]), setMsg({ text: `${big.name} is over 10 MB.`, ok: false });
    if (all.length > room) return setPicked([]), setMsg({ text: `You can add ${room} more photo${room === 1 ? "" : "s"} to this meeting.`, ok: false });
    setPicked(all);
  };

  const upload = async () => {
    if (picked.length === 0) return;
    setPending(true);
    setMsg(null);
    let done = 0;
    try {
      for (const file of picked) {
        const form = new FormData();
        form.set("file", file);
        const res = await fetch(`/api/v1/meetings/${meetingId}/photos`, { method: "POST", body: form });
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) {
          setMsg({ text: `${file.name}: ${json?.error?.message ?? "upload failed"}${done ? ` (${done} added before it)` : ""}`, ok: false });
          break;
        }
        done += 1;
      }
      if (done === picked.length) setMsg({ text: done === 1 ? "Photo added." : `${done} photos added.`, ok: true });
      setPicked([]);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setMsg({ text: "Upload failed. Check your connection and try again.", ok: false });
    } finally {
      setPending(false);
    }
  };

  const remove = async (p: Photo) => {
    if (!window.confirm(`Remove ${p.name} from this meeting?`)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/v1/meeting-photos/${p.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMsg(res.ok ? { text: "Photo removed.", ok: true } : { text: json?.error?.message ?? "Couldn't remove the photo.", ok: false });
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <PanelCard title={`Meeting photos · ${photos.length}`}>
      {photos.length === 0 ? (
        <EmptyState size="sm">No photos yet.{canUpload ? " Add pictures taken at the meeting." : ""}</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50">
              <a href={`/api/v1/meeting-photos/${p.id}`} target="_blank" rel="noopener" aria-label={`Open ${p.name}`} title={`${p.name} · ${p.uploadedBy ?? "—"} · ${formatDateTime(p.createdAt)}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated image; no optimisation wanted */}
                <img src={`/api/v1/meeting-photos/${p.id}`} alt={p.name} loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
              </a>
              <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-zinc-600">
                <span className="min-w-0 truncate">
                  {p.uploadedBy ?? "—"} · {formatDateTime(p.createdAt)}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <a href={`/api/v1/meeting-photos/${p.id}?download=1`} aria-label={`Save ${p.name}`} title="Save" className="text-zinc-500 hover:text-brand">
                    <Download aria-hidden="true" className="size-3.5" />
                  </a>
                  {p.canRemove ? (
                    <button type="button" onClick={() => remove(p)} disabled={pending} aria-label={`Remove ${p.name}`} title="Remove" className="text-zinc-400 hover:text-rose-600">
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
          <label htmlFor={inputId} className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">
            <Camera aria-hidden="true" className="size-3.5" />
            Add photos
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            disabled={pending || room <= 0}
            onChange={(e) => choose(e.target.files)}
            className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-800"
          />
          <p className="text-[11px] text-zinc-500">
            JPG, PNG or WebP, up to 10 MB each, {MAX_PHOTOS} per meeting{room < MAX_PHOTOS ? ` (${Math.max(0, room)} left)` : ""}. Admins and Super Admins can see them.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {msg ? (
              <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
                {msg.text}
              </p>
            ) : null}
            <Button variant="primary" size="lg" disabled={picked.length === 0 || pending} onClick={upload}>
              <Upload aria-hidden="true" className="size-4" />
              {pending ? "Uploading…" : picked.length > 1 ? `Upload ${picked.length} photos` : "Upload photo"}
            </Button>
          </div>
        </div>
      ) : msg ? (
        <p role="status" className={cn("mt-2 text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
    </PanelCard>
  );
}
