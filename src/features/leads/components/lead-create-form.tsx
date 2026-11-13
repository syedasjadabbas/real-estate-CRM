"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { LeadLookups } from "@/modules/leads/queries";
import { emptyExtraPhones, phoneFormErrors } from "@/modules/contacts/constants";
import { createLeadAction } from "../actions";
import { textareaClass } from "./follow-up-dialog";
import { FormSection, LeadFields, selectClass, type LeadFormValues } from "./lead-fields";

type Conflict = { existingLeadId?: string; existingCode?: string; existingName?: string };

export function LeadCreateForm({
  lookups,
  projects,
  defaultProjectId,
  owners,
  canChooseOwner,
}: {
  lookups: LeadLookups;
  projects: { id: string; name: string }[];
  defaultProjectId: string;
  owners: { id: string; name: string }[];
  canChooseOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<LeadFormValues>({
    name: "",
    phoneCountryCode: "+92",
    phoneNumber: "",
    email: "",
    gender: "",
    desiredSize: "",
    sourceId: "",
    budgetRangeId: "",
    priority: "none",
    cityId: "",
    cityOther: "",
    phones: emptyExtraPhones(),
  });
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [ownerId, setOwnerId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = (onDuplicate: "reject" | "duplicate" | "regenerate" = "reject") =>
    startTransition(async () => {
      setFormError(null);
      const early = phoneFormErrors(values.phoneNumber, values.phones);
      if (Object.keys(early).length) {
        setErrors(early);
        setFormError("Check the highlighted fields.");
        return;
      }
      const result = await createLeadAction({ ...values, projectId, ownerId, note, onDuplicate });
      if (result.ok) {
        setConflict(null);
        if (result.data.outcome === "created" && !result.data.visible) {
          setNotice(`This customer already has an agent, so lead ${result.data.code} was assigned to them. They will follow it up.`);
        } else if (result.data.outcome === "created") {
          router.push(`/dashboard/leads/${result.data.leadId}`);
        } else if (result.data.leadId) {
          router.push(`/dashboard/leads/${result.data.leadId}`);
        } else {
          setNotice("Re-inquiry recorded on the existing lead. Its owner will see it in Regenerated.");
        }
        return;
      }
      if (result.code === "CONFLICT") {
        setConflict((result.details ?? {}) as Conflict);
        return;
      }
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

  if (notice) {
    return (
      <div role="status" className="space-y-4 rounded-2xl border border-brand/25 bg-brand-50/60 p-5">
        <p className="text-sm font-bold text-brand-700">{notice}</p>
        <div className="flex gap-2">
          <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            Back to leads
          </Link>
          <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
            Add another lead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      <LeadFields
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        errors={errors}
        lookups={lookups}
        projectId={projectId}
        disabled={pending}
        interestExtra={
          <>
            <Field label="Project" required error={errors.projectId}>
              {(id) => (
                <select id={id} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectClass} disabled={pending}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {canChooseOwner ? (
              <Field label="Owner" error={errors.ownerId} hint="Leave empty to assign automatically. A returning customer always goes to their original agent.">
                {(id, describedBy) => (
                  <select id={id} aria-describedby={describedBy} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectClass} disabled={pending}>
                    <option value="">Auto-assign</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}
          </>
        }
      />

      <FormSection title="Notes">
        <Field label="First note" error={errors.note} className="sm:col-span-2">
          {(id) => (
            <textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call outcome, next step, objection…" className={textareaClass} disabled={pending} />
          )}
        </Field>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/dashboard/leads" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Saving…" : "Create lead"}
        </Button>
      </div>

      <Modal
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="Phone number already exists"
        description="A lead with this phone number already exists in this project."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setConflict(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="secondary" size="lg" onClick={() => submit("duplicate")} disabled={pending}>
              Save as duplicate
            </Button>
            <Button variant="primary" size="lg" onClick={() => submit("regenerate")} disabled={pending}>
              Log re-inquiry on existing
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-zinc-700">
          {conflict?.existingLeadId ? (
            <p>
              Existing lead:{" "}
              <Link href={`/dashboard/leads/${conflict.existingLeadId}`} className="font-bold text-brand hover:underline">
                {conflict.existingName} ({conflict.existingCode})
              </Link>
            </p>
          ) : (
            <p>The existing lead belongs to another owner, so its details are hidden.</p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600">
            <li>
              <span className="font-bold text-zinc-800">Log re-inquiry</span> marks the existing lead as Regenerated (no new lead).
            </li>
            <li>
              <span className="font-bold text-zinc-800">Save as duplicate</span> creates a new lead flagged as a duplicate of the original.
            </li>
          </ul>
        </div>
      </Modal>
    </form>
  );
}
