import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Login screen. The reference CRM's login page could not be inspected without signing out,
 * so this layout reuses the reference's brand block, card and form styling (assumption).
 */
export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-brand/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-24 size-96 rounded-full bg-brand/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="flex items-center gap-3.5">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50/80 text-[13px] font-black tracking-[-0.02em] text-brand shadow-hairline ring-2 ring-brand/20">
            {brand.monogram}
          </span>
          <div>
            <p className="text-lg leading-[18px] font-black tracking-[-0.025em] uppercase">{brand.name}</p>
            <p className="mt-1 text-xs font-semibold text-zinc-400">{brand.tagline}</p>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-hairline sm:p-8">
          <h1 className="text-2xl leading-8 font-black tracking-[-0.025em]">
            Sign in to <span className="text-brand">{brand.name}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-600">Use the account your administrator created for you.</p>
          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </div>
    </main>
  );
}
