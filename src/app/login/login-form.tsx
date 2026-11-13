"use client";

import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, undefined);
  const [revealed, setRevealed] = useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state?.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700"
        >
          <AlertCircle aria-hidden="true" className="mt-px size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      <Field label="Email" required error={state?.fields?.email}>
        {(id, describedBy) => (
          <Input
            id={id}
            name="email"
            aria-describedby={describedBy}
            invalid={Boolean(state?.fields?.email)}
            type="email"
            autoComplete="username"
            defaultValue={state?.email}
            placeholder="you@company.com"
            leading={<Mail aria-hidden="true" className="size-4" />}
          />
        )}
      </Field>
      <Field label="Password" required error={state?.fields?.password}>
        {(id, describedBy) => (
          <Input
            id={id}
            name="password"
            aria-describedby={describedBy}
            invalid={Boolean(state?.fields?.password)}
            type={revealed ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Your password"
            leading={<Lock aria-hidden="true" className="size-4" />}
            trailing={
              // The label avoids the word "password" so the field keeps a single accessible match.
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-pressed={revealed}
                aria-label={revealed ? "Hide the characters" : "Show the characters"}
                title={revealed ? "Hide" : "Show"}
                className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                {revealed ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
              </button>
            }
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" className="group w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            Sign in
            <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
