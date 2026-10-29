"use client";

import { AlertCircle, Lock, Mail } from "lucide-react";
import { useActionState } from "react";
import { loginAction, type LoginState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, undefined);

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            leading={<Lock aria-hidden="true" className="size-4" />}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
