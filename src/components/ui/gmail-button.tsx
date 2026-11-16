import { Mail } from "lucide-react";
import { cn } from "@/lib/cn";

/** Gmail's web compose window with the To box filled in (opens in the browser's signed-in Gmail). */
export function gmailComposeHref(email: string) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
}

/**
 * A small button next to an email address (owner, 16 Nov 2026): opens Gmail in a new tab, signed in as
 * whoever is logged in to Gmail in that browser, with a new message already addressed. Nothing is sent
 * or recorded by the CRM.
 */
export function GmailButton({ email, name, className }: { email: string | null | undefined; name?: string; className?: string }) {
  if (!email) return null;
  const label = `Email ${name ?? email} in Gmail`;
  return (
    <a
      href={gmailComposeHref(email)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-200 transition-colors hover:bg-rose-600 hover:text-white",
        className,
      )}
    >
      <Mail aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/** An email address with the Gmail button beside it; "—" (or `empty`) when there is none. */
export function EmailWithGmail({ email, name, empty = "—", className }: { email: string | null | undefined; name?: string; empty?: string; className?: string }) {
  if (!email) return <span className={className}>{empty}</span>;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5", className)}>
      <span className="min-w-0 truncate">{email}</span>
      <GmailButton email={email} name={name} />
    </span>
  );
}
