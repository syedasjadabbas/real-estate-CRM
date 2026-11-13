import { Building2, CalendarCheck2, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Short, factual points about what the CRM covers (shown beside the form on wide screens). */
const HIGHLIGHTS: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Users aria-hidden="true" className="size-4" />, title: "Leads and follow-ups", text: "Every enquiry, owner and next step in one pipeline." },
  { icon: <Building2 aria-hidden="true" className="size-4" />, title: "Projects and inventory", text: "Units, prices and availability kept in line with bookings." },
  { icon: <CalendarCheck2 aria-hidden="true" className="size-4" />, title: "Bookings and payments", text: "From token to confirmation, with receipts and balances." },
];

function Monogram({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-2xl font-black tracking-[-0.02em] ${className ?? ""}`}
      aria-hidden="true"
    >
      {brand.monogram}
    </span>
  );
}

/**
 * Login screen: a brand panel beside the form on wide screens, the form alone on phones.
 * Nothing here reveals whether an account exists; errors come from the sign-in action.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Brand panel (wide screens) */}
      <section
        aria-label={`${brand.name} CRM`}
        className="relative hidden overflow-hidden bg-brand-700 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full bg-brand blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-black/25 blur-3xl" />

        <div className="relative flex items-center gap-3.5">
          <Monogram className="size-11 bg-white text-[14px] text-brand-700 shadow-lg shadow-black/10" />
          <div>
            <p className="text-lg leading-[18px] font-black tracking-[-0.025em] uppercase">{brand.name}</p>
            <p className="mt-1 text-xs font-semibold text-white/70">{brand.tagline}</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-[1.1] font-black tracking-[-0.035em] text-balance xl:text-[2.75rem]">
            Your sales, bookings and team in one place.
          </h2>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">{h.icon}</span>
                <span>
                  <span className="block text-sm font-bold">{h.title}</span>
                  <span className="mt-0.5 block text-sm text-white/70">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Access follows your role; every change is recorded.
        </p>
      </section>

      {/* Sign-in form */}
      <section className="relative flex items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-brand/10 blur-3xl lg:hidden" />
        <div className="relative w-full max-w-[400px]">
          <div className="flex items-center gap-3.5 lg:hidden">
            <Monogram className="size-10 bg-brand text-[13px] text-white shadow-hairline" />
            <div>
              <p className="text-lg leading-[18px] font-black tracking-[-0.025em] uppercase">{brand.name}</p>
              <p className="mt-1 text-xs font-semibold text-zinc-500">{brand.tagline}</p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-12px_rgba(16,24,40,0.12)] sm:p-8 lg:mt-0">
            <h1 className="text-[26px] leading-8 font-black tracking-[-0.03em]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-zinc-600">Sign in to {brand.name} with the account your administrator created for you.</p>
            <div className="mt-7">
              <LoginForm />
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-zinc-500">Trouble signing in? Ask your administrator to reset your password.</p>
          <p className="mt-8 text-center text-[11px] text-zinc-400">© {brand.name}</p>
        </div>
      </section>
    </main>
  );
}
