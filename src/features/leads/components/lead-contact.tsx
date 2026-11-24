"use client";

import { Check, Contact, Copy, Mail, MessageCircle, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { gmailComposeHref } from "@/components/ui/gmail-button";
import { whatsappHref } from "@/components/ui/masked-phone";
import { Modal } from "@/components/ui/modal";

const action =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-bold text-zinc-800 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      className={action}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? <Check aria-hidden="true" className="size-3.5 text-brand" /> : <Copy aria-hidden="true" className="size-3.5" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Can't copy" : "Copy"}
    </button>
  );
}

function Detail({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4">
      <p className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-base font-bold break-all tabular-nums select-text">{value}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/**
 * A lead's contact details stay off the list until the agent opens them (client, 24 Nov 2026): one View
 * Contact button, then phone and email together with call, message and copy. Privacy on screen, not access
 * control: whoever can see the lead can open it.
 */
export function ViewContact({ phone, email, name, code, tel }: { phone: string; email: string | null; name: string; code: string; tel: string }) {
  const [open, setOpen] = useState(false);
  const wa = whatsappHref(phone);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View contact of ${name}`}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] leading-4 font-bold text-zinc-700 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
      >
        <Contact aria-hidden="true" className="size-3.5 text-zinc-400" />
        View contact
      </button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Contact details" description={`${name} · ${code}`}>
          <div className="space-y-3">
            <Detail label="Phone" value={phone}>
              <a href={tel} aria-label={`Call ${name}`} className={action}>
                <Phone aria-hidden="true" className="size-3.5" />
                Call
              </a>
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`} className={action}>
                  <MessageCircle aria-hidden="true" className="size-3.5" />
                  WhatsApp
                </a>
              ) : null}
              <CopyButton value={phone} label="phone number" />
            </Detail>
            {email ? (
              <Detail label="Email" value={email}>
                <a href={gmailComposeHref(email)} target="_blank" rel="noopener noreferrer" aria-label={`Email ${name} in Gmail`} className={action}>
                  <Mail aria-hidden="true" className="size-3.5" />
                  Email
                </a>
                <CopyButton value={email} label="email" />
              </Detail>
            ) : (
              <p className="rounded-2xl border border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-500">No email saved for this lead.</p>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
