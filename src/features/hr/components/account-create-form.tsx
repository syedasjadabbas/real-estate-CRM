"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/modules/accounts/validation";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { createAccountAction } from "../actions";

/** New CRM account (Admin / Super Admin, questionnaire Q2). The initial password is never shown again. */
export function AccountCreateForm({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", email: "", role: "agent" as Role, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      noValidate
      aria-label="New CRM user"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createAccountAction(values);
          if (result.ok) {
            router.push(`/dashboard/hr/employees/${result.data.id}`);
          } else {
            setErrors(result.fields ?? {});
            setMsg(result.message);
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(errors.name)} maxLength={100} value={values.name} disabled={pending} onChange={set("name")} />}
        </Field>
        <Field label="Email" error={errors.email} hint="Used to sign in.">
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="off" invalid={Boolean(errors.email)} maxLength={254} value={values.email} disabled={pending} onChange={set("email")} />}
        </Field>
        <Field label="Role" error={errors.role}>
          {(id, d) => (
            <select id={id} aria-describedby={d} className={selectClass} value={values.role} disabled={pending} onChange={set("role")}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Initial password" error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters. Give it to the user privately.`}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={Boolean(errors.password)} maxLength={MAX_PASSWORD_LENGTH} value={values.password} disabled={pending} onChange={set("password")} />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role="alert" className={cn("text-xs font-semibold text-rose-600")}>
            {msg}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}
