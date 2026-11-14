"use client";

import { CheckCircle2, Circle, FileText, Printer, ReceiptText, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { BOOKING_STAGE_LABELS, type BookingStage } from "@/modules/bookings/constants";
import { advanceBookingAction } from "../actions";

export type StageFile = { id: string; name: string; createdAt: Date | string };

const MAX = 10 * 1024 * 1024;
const fileInput =
  "block w-full text-xs text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-200/80 file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-zinc-800 hover:file:bg-zinc-50";

/** Uploads one file to a booking endpoint; returns the new file's id, or an error message. */
async function upload(url: string, file: File): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return { error: "The upload failed. Check your connection and try again." };
  const json = (await res.json().catch(() => null)) as { data?: { id: string }; error?: { message?: string } } | null;
  if (!res.ok || !json?.data) return { error: json?.error?.message ?? "The upload failed." };
  return { id: json.data.id };
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn("mt-0.5 shrink-0", done ? "text-brand" : "text-zinc-300")} aria-hidden="true">
        {done ? <CheckCircle2 className="size-5" /> : <Circle className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-black">
          <span className="text-zinc-400">{n}.</span> {title}
          {done ? <span className="sr-only"> (done)</span> : null}
        </p>
        {children}
      </div>
    </li>
  );
}

function FileLinks({ files, base }: { files: StageFile[]; base: string }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-1.5 text-[11px]">
          <FileText aria-hidden="true" className="size-3.5 text-zinc-400" />
          <a href={`${base}/${f.id}`} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
            {f.name}
          </a>
          <span className="text-zinc-500">· {formatDateTime(f.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The booking's steps, one stage at a time (owner, 14 Nov 2026):
 * 1. Token: give the client the provisional receipt; then enter the partial down payment and its proof.
 * 2. Partial Down Payment: generate the booking form, upload it signed by the client; then enter the
 *    complete down payment and its proof.
 * 3. Complete Down Payment: generate the booking form again, upload it signed; then close as won.
 * Uploaded forms and proofs are listed here.
 */
export function StageSteps({
  bookingId,
  stage,
  next,
  canAdvance,
  stageChangedAt,
  signedForms,
  proofs,
}: {
  bookingId: string;
  stage: BookingStage;
  next: BookingStage | null;
  /** May this person make the next move (Close as Won is for managers and admins)? */
  canAdvance: boolean;
  stageChangedAt: Date | string;
  signedForms: StageFile[];
  proofs: StageFile[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const since = new Date(stageChangedAt).getTime();
  const thisStageForms = signedForms.filter((f) => new Date(f.createdAt).getTime() >= since);
  const needsForm = stage === "down_payment" || stage === "agreement_pending";
  const formDone = thisStageForms.length > 0;
  const paymentMove = next === "down_payment" || next === "agreement_pending";
  const amountOk = Number(amount.replace(/,/g, "")) > 0;
  const ready = (!needsForm || formDone) && (!paymentMove || (amountOk && Boolean(proofFile)));
  const pick = (f: File | null, set: (f: File | null) => void) => {
    setMsg(f && f.size > MAX ? { text: "That file is larger than 10 MB.", ok: false } : null);
    set(f && f.size <= MAX ? f : null);
  };

  const uploadForm = () =>
    startTransition(async () => {
      if (!formFile) return;
      const r = await upload(`/api/v1/bookings/${bookingId}/signed-forms`, formFile);
      if ("error" in r) return setMsg({ text: r.error, ok: false });
      setFormFile(null);
      setMsg({ text: "Signed booking form uploaded.", ok: true });
      router.refresh();
    });

  const move = () =>
    startTransition(async () => {
      if (!next) return;
      let proofId: string | null = null;
      if (proofFile) {
        const r = await upload(`/api/v1/bookings/${bookingId}/proofs`, proofFile);
        if ("error" in r) return setMsg({ text: r.error, ok: false });
        proofId = r.id;
      }
      const result = await advanceBookingAction(bookingId, next, note, proofId, paymentMove ? amount.replace(/,/g, "") : null);
      if (result.ok) {
        setNote("");
        setAmount("");
        setProofFile(null);
        setMsg({ text: `Moved to ${BOOKING_STAGE_LABELS[next]}.`, ok: true });
      } else setMsg({ text: result.message, ok: false });
    });

  let n = 0;
  const paymentLabel = next === "down_payment" ? "partial down payment" : "complete down payment";

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {stage === "token_pending" ? (
          <Step n={++n} done={false} title="Give the client the provisional receipt">
            <Link href={`/print/booking/${bookingId}/receipt`} target="_blank" className={buttonClasses({ variant: "secondary", size: "md" })}>
              <ReceiptText aria-hidden="true" className="size-4" />
              Generate provisional receipt
            </Link>
          </Step>
        ) : null}

        {needsForm ? (
          <>
            <Step n={++n} done={formDone} title={`Generate the booking form (${BOOKING_STAGE_LABELS[stage]})`}>
              <Link href={`/print/booking/${bookingId}/form`} target="_blank" className={buttonClasses({ variant: "secondary", size: "md" })}>
                <Printer aria-hidden="true" className="size-4" />
                Generate booking form
              </Link>
            </Step>
            <Step n={++n} done={formDone} title="Upload it signed by the client">
              <FileLinks files={thisStageForms} base="/api/v1/documents" />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  aria-label="Signed booking form"
                  accept=".jpg,.jpeg,.png,.pdf"
                  disabled={pending}
                  onChange={(e) => pick(e.target.files?.[0] ?? null, setFormFile)}
                  className={cn(fileInput, "min-w-0 flex-1")}
                />
                <Button variant="secondary" size="md" disabled={!formFile || pending} onClick={uploadForm}>
                  <Upload aria-hidden="true" className="size-4" />
                  Upload
                </Button>
              </div>
            </Step>
          </>
        ) : null}

        {stage === "agreement_pending" ? (
          // The sales order goes with the complete down payment (owner, 14 Nov 2026).
          <Step n={++n} done={false} title="Generate the sales order">
            <Link href={`/print/booking/${bookingId}/sales-order`} target="_blank" className={buttonClasses({ variant: "secondary", size: "md" })}>
              <ReceiptText aria-hidden="true" className="size-4" />
              Generate sales order
            </Link>
          </Step>
        ) : null}

        {next && canAdvance ? (
          <>
            {paymentMove ? (
              <Step n={++n} done={amountOk && Boolean(proofFile)} title={`Enter the ${paymentLabel}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-zinc-600">PKR</span>
                  <Input
                    aria-label={`Amount received for the ${paymentLabel}`}
                    inputMode="decimal"
                    value={amount}
                    placeholder="Amount received"
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                    disabled={pending}
                    className="w-44"
                  />
                </div>
                <input
                  type="file"
                  aria-label="Payment proof"
                  accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx"
                  disabled={pending}
                  onChange={(e) => pick(e.target.files?.[0] ?? null, setProofFile)}
                  className={fileInput}
                />
                <p className="text-[11px] text-zinc-500">Payment proof (transfer screenshot, cheque or cash photo): required. Accounts post the payment in Finance.</p>
              </Step>
            ) : null}
            <Step n={++n} done={false} title={next === "confirmed" ? "Close as Won" : `Move to ${BOOKING_STAGE_LABELS[next]}`}>
              <textarea aria-label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={textareaClass} disabled={pending} />
              <Button variant="primary" size="lg" disabled={!ready || pending} onClick={move}>
                {pending ? "Saving…" : next === "confirmed" ? "Close as Won" : `Move to ${BOOKING_STAGE_LABELS[next]}`}
              </Button>
              {!ready ? <p className="text-[11px] text-zinc-500">Finish the steps above first.</p> : null}
            </Step>
          </>
        ) : next ? (
          <li className="text-xs text-zinc-600">
            Next: {BOOKING_STAGE_LABELS[next]}. {next === "confirmed" ? "An Admin closes bookings as won once the signed form is uploaded." : "Your role can't move this booking further."}
          </li>
        ) : null}
      </ol>

      {proofs.length || signedForms.length ? (
        <div className="space-y-1.5 border-t border-zinc-100 pt-3">
          {proofs.length ? (
            <>
              <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Payment proofs · {proofs.length}</p>
              <FileLinks files={proofs} base="/api/v1/bookings/proofs" />
            </>
          ) : null}
          {signedForms.length ? (
            <>
              <p className="pt-1 text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">Signed booking forms · {signedForms.length}</p>
              <FileLinks files={signedForms} base="/api/v1/documents" />
            </>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
