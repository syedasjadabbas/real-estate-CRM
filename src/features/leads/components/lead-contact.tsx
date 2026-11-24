"use client";

import { Eye, EyeOff, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { GmailButton } from "@/components/ui/gmail-button";
import { maskPhone, whatsappHref } from "@/components/ui/masked-phone";

/** "shahida@gmail.com" → "sh•••@gmail.com". */
export function maskEmail(email: string) {
  const at = email.indexOf("@");
  if (at < 1) return "•••";
  return `${email.slice(0, Math.min(2, at - 1))}•••${email.slice(at)}`;
}

const round = "inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors";

/**
 * A lead's phone and email in the leads list, both hidden until the one eye button on the left shows them
 * (client, 23 Nov 2026). Hidden again on every page load; it keeps them off screen, it isn't access control.
 */
export function LeadContact({ phone, email, name, tel }: { phone: string; email: string | null; name: string; tel: string }) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  const wa = whatsappHref(phone);
  return (
    <div className="flex items-start gap-2 whitespace-nowrap">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? `Hide phone and email of ${name}` : `Show phone and email of ${name}`}
        title={shown ? "Hide phone and email" : "Show phone and email"}
        className={`${round} mt-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none`}
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
      <div className="space-y-1">
        <span className="flex items-center gap-2">
          {/* Calls from the list without opening the lead: the phone dials through the tel: link. */}
          <a href={tel} aria-label={`Call ${name}`} title={`Call ${name}`} className={`${round} bg-brand-50 text-brand ring-1 ring-brand/20 hover:bg-brand hover:text-white`}>
            <Phone aria-hidden="true" className="size-3.5" />
          </a>
          <span className="tabular-nums">{shown ? phone : maskPhone(phone)}</span>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`} title={`WhatsApp ${name}`} className={`${round} bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 hover:bg-emerald-600 hover:text-white`}>
              <MessageCircle aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
        </span>
        {email ? (
          <span className="flex items-center gap-2">
            <GmailButton email={email} name={name} />
            <span>{shown ? email : maskEmail(email)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
