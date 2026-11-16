"use client";

import { Eye, EyeOff, MessageCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** "+92 324 4521135" → "+92 3•• •••••35": keeps the first 3 and last 2 digits, hides the rest. */
export function maskPhone(phone: string) {
  const total = (phone.match(/\d/g) ?? []).length;
  let seen = 0;
  return phone.replace(/\d/g, (d) => {
    seen += 1;
    return seen <= 3 || seen > total - 2 ? d : "•";
  });
}

/**
 * WhatsApp chat link for a displayed number (owner, 16 Nov 2026): wa.me wants the full international
 * number as digits only. A local Pakistani number written 03… becomes 923…. Null when it can't be one.
 */
export function whatsappHref(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (!phone.trim().startsWith("+") && digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}

/**
 * A phone number hidden by default (owner, 16 Nov 2026): the eye button shows it, and again hides
 * it. Each page load starts hidden. It keeps the number off screen for people looking over a
 * shoulder; the call buttons still dial it. The green button opens a WhatsApp chat with the number
 * (WhatsApp Web, the desktop app or the phone app, whichever the device uses).
 */
export function MaskedPhone({ phone, name, className }: { phone: string; name?: string; className?: string }) {
  const [shown, setShown] = useState(false);
  if (!phone || phone === "—") return <span className={className}>{phone || "—"}</span>;
  const Icon = shown ? EyeOff : Eye;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span className="tabular-nums">{shown ? phone : maskPhone(phone)}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShown((s) => !s);
        }}
        aria-pressed={shown}
        aria-label={shown ? "Hide phone number" : "Show phone number"}
        title={shown ? "Hide number" : "Show number"}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
      {whatsappHref(phone) ? (
        <a
          href={whatsappHref(phone)!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`WhatsApp ${name ?? "this number"}`}
          title={`WhatsApp ${name ?? "this number"}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-600 hover:text-white"
        >
          <MessageCircle aria-hidden="true" className="size-3.5" />
        </a>
      ) : null}
    </span>
  );
}
