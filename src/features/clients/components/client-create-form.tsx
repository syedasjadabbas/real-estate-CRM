"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { selectClass } from "@/features/leads/components/lead-fields";
import { createClientAction } from "../actions";
import { emptyExtraPhones, phoneFormErrors } from "@/modules/contacts/constants";
import { ClientFields, type ClientFormValues } from "./client-fields";

type Conflict = { message: string; existingClientId?: string; existingName?: string };

/** Manual client (admins). Lead conversion happens from the lead page. */
export function ClientCreateForm({
  cities,
  owners,
  defaultOwnerId,
}: {
  cities: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  defaultOwnerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<ClientFormValues>({
    name: "",
    phoneCountryCode: "+92",
    phoneNumber: "",
    email: "",
    cityId: "",
    cityOther: "",
    relationship: "",
    phones: emptyExtraPhones(),
  });
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const submit = () =>
    startTransition(async () => {
      setFormError(null);
      setConflict(null);
      const early = phoneFormErrors(values.phoneNumber, values.phones);
      if (Object.keys(early).length) {
        setErrors(early);
        setFormError("Check the highlighted fields.");
        return;
      }
      const result = await createClientAction({ ...values, ownerId });
      if (result.ok) {
        router.push(`/dashboard/clients/${result.data.clientId}`);
        return;
      }
      if (result.code === "CONFLICT") {
        setConflict({ message: result.message, ...(result.details as Omit<Conflict, "message">) });
        return;
      }
      setErrors(result.fields ?? {});
      setFormError(result.message);
    });

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
      {conflict ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm font-semibold text-amber-950">
          {conflict.message}{" "}
          {conflict.existingClientId ? (
            <Link href={`/dashboard/clients/${conflict.existingClientId}`} className="font-bold text-brand hover:underline">
              Open {conflict.existingName}
            </Link>
          ) : null}
        </p>
      ) : null}

      <ClientFields
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        errors={errors}
        cities={cities}
        disabled={pending}
        profileExtra={
          <Field label="Owner" required error={errors.ownerId}>
            {(id, describedBy) => (
              <select id={id} aria-describedby={describedBy} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectClass} disabled={pending}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        }
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/dashboard/clients" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="px-5">
          {pending ? "Saving…" : "Create client"}
        </Button>
      </div>
    </form>
  );
}
