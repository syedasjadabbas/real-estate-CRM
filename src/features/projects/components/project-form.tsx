"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { FormSection, selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_TYPES, PROJECT_TYPE_LABELS } from "@/modules/projects/constants";
import { createProjectAction, updateProjectAction } from "../actions";

export type ProjectFormValues = {
  name: string;
  type: string;
  status: string;
  developer: string;
  city: string;
  address: string;
  description: string;
};

/**
 * FR-060 fields in the Leads form-section style. Create mode redirects to the new project;
 * edit mode saves in place. Read-only when `disabled` (non-admins).
 */
export function ProjectForm({ projectId, initial, disabled = false }: { projectId?: string; initial: ProjectFormValues; disabled?: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = (patch: Partial<ProjectFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const off = disabled || pending;

  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      if (!projectId) {
        const result = await createProjectAction(values);
        if (result.ok) return router.push(`/dashboard/projects/${result.data.projectId}`);
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
        return;
      }
      const result = await updateProjectAction(projectId, values);
      if (result.ok) {
        setErrors({});
        setMsg({ text: result.data.changed.length ? "Changes saved." : "Nothing changed.", ok: true });
      } else {
        setErrors(result.fields ?? {});
        setMsg({ text: result.message, ok: false });
      }
    });

  const text = (key: keyof ProjectFormValues, label: string, opts: { required?: boolean; placeholder?: string } = {}) => (
    <Field label={label} required={opts.required} error={errors[key]}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={Boolean(errors[key])}
          value={values[key]}
          placeholder={opts.placeholder}
          autoComplete="off"
          disabled={off}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  const select = (key: "type" | "status", label: string, options: { value: string; label: string }[]) => (
    <Field label={label} required error={errors[key]}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} value={values[key]} disabled={off} onChange={(e) => set({ [key]: e.target.value })} className={selectClass}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <form
      noValidate
      aria-label="Project details"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {!projectId && msg && !msg.ok ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {msg.text}
        </p>
      ) : null}
      <FormSection title="Project">
        {text("name", "Name", { required: true })}
        {text("developer", "Developer / company", { placeholder: "Optional" })}
        {select("type", "Type", PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABELS[t] })))}
        {select("status", "Status", PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })))}
      </FormSection>
      <FormSection title="Location">
        {text("city", "City", { placeholder: "Optional" })}
        {text("address", "Address", { placeholder: "Optional" })}
      </FormSection>
      <FormSection title="Description">
        <Field label="Description" error={errors.description} className="sm:col-span-2">
          {(id, describedBy) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              value={values.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Optional"
              className={textareaClass}
              disabled={off}
            />
          )}
        </Field>
      </FormSection>

      {disabled ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {projectId && msg ? (
            <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
              {msg.text}
            </p>
          ) : null}
          {projectId ? (
            <Button
              variant="secondary"
              size="lg"
              disabled={!dirty || pending}
              onClick={() => {
                setValues(initial);
                setErrors({});
                setMsg(null);
              }}
            >
              Cancel
            </Button>
          ) : (
            <Link href="/dashboard/projects" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              Cancel
            </Link>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={pending || (Boolean(projectId) && !dirty)} className="px-5">
            {pending ? "Saving…" : projectId ? "Save changes" : "Create project"}
          </Button>
        </div>
      )}
    </form>
  );
}
