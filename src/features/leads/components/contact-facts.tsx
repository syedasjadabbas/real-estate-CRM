"use client";

import { Eye, EyeOff, MessageCircle } from "lucide-react";
import { useState } from "react";
import { GmailButton } from "@/components/ui/gmail-button";
import { maskPhone, whatsappHref } from "@/components/ui/masked-phone";

export const maskEmail = (email: string) => email.replace(/^(.)([^@]*)(@.).*?(\.[^.]*)?$/, (_, a: string, rest: string, at: string, tld = "") => `${a}${"•".repeat(Math.max(3, Math.min(8, rest.length)))}${at}•••${tld}`);

/** Phone and email on the lead page, hidden together behind one eye button (client, 25 Nov 2026). */
export function ContactFacts({ phone, email, name }: { phone: string; email: string | null; name: string }) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  const label = "text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase";
  const wa = whatsappHref(phone);
  return (
    <div className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? "Hide phone and email" : "Show phone and email"}
        title={shown ? "Hide phone and email" : "Show phone and email"}
        className="inline-flex size-8 items-center justify-center rounded-full border border-zinc-200/80 text-zinc-500 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
      <div className="min-w-0">
        <p className={label}>Phone</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold">
          <span className="truncate tabular-nums">{shown ? phone : maskPhone(phone)}</span>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`} title={`WhatsApp ${name}`} className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 hover:bg-emerald-600 hover:text-white">
              <MessageCircle aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="min-w-0">
        <p className={label}>Email</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold">
          <span className="truncate">{email ? (shown ? email : maskEmail(email)) : "—"}</span>
          <GmailButton email={email} name={name} />
        </div>
      </div>
    </div>
  );
}
