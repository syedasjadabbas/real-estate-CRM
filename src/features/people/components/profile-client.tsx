"use client";

import { Printer, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { addEmployeeNoteAction, deleteEmployeeNoteAction } from "../actions";

/** Print the work profile, or save it as PDF from the print dialog (16 Nov 2026). */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" size="md" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" className="size-4" />
      Print / PDF
    </Button>
  );
}

type Note = { id: string; body: string; createdAt: Date | string; authorId: string | null; authorName: string | null };

/** Private coaching notes on the profile: Admins and Super Admins only; the employee never sees them. */
export function CoachingNotes({ userId, notes, meId, canDeleteAny, canWrite }: { userId: string; notes: Note[]; meId: string; canDeleteAny: boolean; canWrite: boolean }) {
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      {canWrite ? (
        <form
          className="space-y-2 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await addEmployeeNoteAction(userId, body);
              if (r.ok) {
                setBody("");
                setMsg({ text: "Note saved.", ok: true });
              } else setMsg({ text: r.fields?.body ?? r.message, ok: false });
            });
          }}
        >
          <textarea
            aria-label="New coaching note"
            rows={2}
            maxLength={2000}
            value={body}
            disabled={pending}
            onChange={(e) => setBody(e.target.value)}
            placeholder="e.g. Spoke about follow-up delays; agreed to clear overdue calls daily."
            className="w-full rounded-xl border border-zinc-200/80 bg-white px-3 py-2 text-xs focus:border-brand/50 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500">Private: only Admins and Super Admins see these notes.</p>
            <Button type="submit" variant="primary" size="md" disabled={pending || !body.trim()}>
              {pending ? "Saving…" : "Add note"}
            </Button>
          </div>
          {msg ? <p className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>{msg.text}</p> : null}
        </form>
      ) : null}
      {notes.length === 0 ? (
        <p className="text-xs text-zinc-500">No notes yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="block whitespace-pre-line text-zinc-800">{n.body}</span>
                <span className="block pt-0.5 text-[11px] text-zinc-500">
                  {n.authorName ?? "Former user"} · {formatDateTime(n.createdAt)}
                </span>
              </span>
              {n.authorId === meId || canDeleteAny ? (
                <button
                  type="button"
                  aria-label="Delete note"
                  disabled={pending}
                  onClick={() => startTransition(async () => void (await deleteEmployeeNoteAction(n.id)))}
                  className="shrink-0 text-zinc-400 hover:text-rose-600 print:hidden"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
