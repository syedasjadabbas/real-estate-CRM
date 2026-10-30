"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { COUNTRY_CODES, selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { MAX_JOINING_YEAR, MIN_JOINING_YEAR } from "@/modules/employees/validation";
import { saveEmployeeProfileAction } from "../actions";

type Profile = { designation: string | null; department: string | null; phoneCountryCode: string | null; phoneNumber: string | null; joiningDate: string | null };

/** FR-140 HR profile fields (super admin, admin, HR). Free text with suggestions from existing entries. */
export function EmployeeProfileForm({ userId, profile, departments, designations }: { userId: string; profile: Profile; departments: string[]; designations: string[] }) {
  const depList = useId();
  const desList = useId();
  const [values, setValues] = useState({
    designation: profile.designation ?? "",
    department: profile.department ?? "",
    phoneCountryCode: profile.phoneCountryCode ?? "+92",
    phoneNumber: profile.phoneNumber ?? "",
    joiningDate: profile.joiningDate ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      noValidate
      aria-label="HR profile"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveEmployeeProfileAction(userId, values);
          if (result.ok) {
            setErrors({});
            setMsg({ text: result.data.changed.length ? "Profile saved." : "No changes to save.", ok: true });
          } else {
            setErrors(result.fields ?? {});
            setMsg({ text: result.fields?.form ?? result.message, ok: false });
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Designation" error={errors.designation} hint="Free text; existing entries are suggested.">
          {(id, d) => (
            <>
              <Input id={id} aria-describedby={d} invalid={Boolean(errors.designation)} list={desList} maxLength={100} value={values.designation} disabled={pending} onChange={set("designation")} />
              <datalist id={desList}>
                {designations.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Department" error={errors.department} hint="Free text; existing entries are suggested.">
          {(id, d) => (
            <>
              <Input id={id} aria-describedby={d} invalid={Boolean(errors.department)} list={depList} maxLength={100} value={values.department} disabled={pending} onChange={set("department")} />
              <datalist id={depList}>
                {departments.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Country code" error={errors.phoneCountryCode}>
          {(id, d) => (
            <select id={id} aria-describedby={d} value={values.phoneCountryCode} onChange={set("phoneCountryCode")} className={selectClass} disabled={pending}>
              {COUNTRY_CODES.some((c) => c.value === values.phoneCountryCode) ? null : <option value={values.phoneCountryCode}>{values.phoneCountryCode}</option>}
              {COUNTRY_CODES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Phone number" error={errors.phoneNumber} hint="Same format as lead phones. Leave blank for no phone.">
          {(id, d) => (
            <Input id={id} type="tel" aria-describedby={d} invalid={Boolean(errors.phoneNumber)} placeholder="3001234567 or 0300 1234567" maxLength={25} value={values.phoneNumber} disabled={pending} onChange={set("phoneNumber")} />
          )}
        </Field>
        <Field label="Joining date" error={errors.joiningDate}>
          {(id, d) => (
            <Input
              id={id}
              type="date"
              aria-describedby={d}
              invalid={Boolean(errors.joiningDate)}
              min={`${MIN_JOINING_YEAR}-01-01`}
              max={`${MAX_JOINING_YEAR}-12-31`}
              value={values.joiningDate}
              disabled={pending}
              onChange={set("joiningDate")}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending} className="px-4">
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
