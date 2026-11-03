"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/modules/accounts/validation";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { reassignOwnedLeadsAction, resetAccountPasswordAction, setAccountStatusAction, updateAccountAction } from "../actions";

type Account = { id: string; name: string; role: Role; status: "active" | "inactive" };
type Msg = { text: string; ok: boolean } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
      {msg.text}
    </p>
  );
}

const sectionTitle = "text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase";

/**
 * Account management for Admin / Super Admin (questionnaire Q2, Q3): name and role, password reset,
 * the optional lead shift, and manual deactivation. The server enforces every rule.
 */
export function AccountControls({
  account,
  roles,
  isSelf,
  leads,
  receivers,
}: {
  account: Account;
  roles: Role[];
  isSelf: boolean;
  leads: { open: number; lost: number; booked: number };
  receivers: { id: string; name: string; role: Role }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [details, setDetails] = useState({ name: account.name, role: account.role });
  const [detailsErr, setDetailsErr] = useState<Record<string, string>>({});
  const [detailsMsg, setDetailsMsg] = useState<Msg>(null);

  const [password, setPassword] = useState("");
  const [passwordErr, setPasswordErr] = useState<string | undefined>();
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);

  const [shift, setShift] = useState({ toUserId: "", open: leads.open > 0, lost: false, booked: false });
  const [shiftErr, setShiftErr] = useState<Record<string, string>>({});
  const [shiftMsg, setShiftMsg] = useState<Msg>(null);

  const [confirming, setConfirming] = useState(false);
  const [statusMsg, setStatusMsg] = useState<Msg>(null);

  const totalLeads = leads.open + leads.lost + leads.booked;

  return (
    <div className="space-y-6">
      <form
        noValidate
        aria-label="Account details"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await updateAccountAction(account.id, details);
            if (result.ok) {
              setDetailsErr({});
              setDetailsMsg({ text: result.data.changed.length ? "Account saved." : "No changes to save.", ok: true });
              router.refresh();
            } else {
              setDetailsErr(result.fields ?? {});
              setDetailsMsg({ text: result.message, ok: false });
            }
          });
        }}
      >
        <p className={sectionTitle}>Name and role</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" error={detailsErr.name}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={Boolean(detailsErr.name)} maxLength={100} value={details.name} disabled={pending} onChange={(e) => setDetails((v) => ({ ...v, name: e.target.value }))} />}
          </Field>
          <Field label="Role" error={detailsErr.role} hint={isSelf ? "You can't change your own role." : undefined}>
            {(id, d) => (
              <select id={id} aria-describedby={d} className={selectClass} value={details.role} disabled={pending || isSelf} onChange={(e) => setDetails((v) => ({ ...v, role: e.target.value as Role }))}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Status msg={detailsMsg} />
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            Save account
          </Button>
        </div>
      </form>

      <form
        noValidate
        aria-label="Reset password"
        className="space-y-3 border-t border-zinc-100 pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await resetAccountPasswordAction(account.id, { password });
            if (result.ok) {
              setPassword("");
              setPasswordErr(undefined);
              setPasswordMsg({ text: "Password changed. The user's sessions have ended; give them the new password privately.", ok: true });
            } else {
              setPasswordErr(result.fields?.password);
              setPasswordMsg({ text: result.fields?.password ?? result.message, ok: false });
            }
          });
        }}
      >
        <p className={sectionTitle}>Reset password</p>
        <Field label="New password" error={passwordErr} hint={`At least ${MIN_PASSWORD_LENGTH} characters. It is not shown again after saving.`}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={Boolean(passwordErr)} maxLength={MAX_PASSWORD_LENGTH} value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Status msg={passwordMsg} />
          <Button type="submit" variant="secondary" size="lg" disabled={pending || !password}>
            Set new password
          </Button>
        </div>
      </form>

      <form
        noValidate
        aria-label="Move leads"
        className="space-y-3 border-t border-zinc-100 pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await reassignOwnedLeadsAction(account.id, shift);
            if (result.ok) {
              setShiftErr({});
              setShiftMsg({ text: result.data.moved ? `${result.data.moved} lead${result.data.moved === 1 ? "" : "s"} moved.` : "No leads matched.", ok: true });
              router.refresh();
            } else {
              setShiftErr(result.fields ?? {});
              setShiftMsg({ text: result.fields?.open ?? result.fields?.toUserId ?? result.message, ok: false });
            }
          });
        }}
      >
        <p className={sectionTitle}>Move leads</p>
        <p className="text-xs text-zinc-600">
          Owns {leads.open} open, {leads.lost} lost and {leads.booked} booked lead{totalLeads === 1 ? "" : "s"}. Moved leads take their pending follow-ups with them; tasks and meetings stay
          where they are.
        </p>
        {totalLeads > 0 ? (
          <>
            <fieldset className="flex flex-wrap gap-4 text-xs font-semibold text-zinc-800">
              <legend className="sr-only">Leads to move</legend>
              {(["open", "lost", "booked"] as const).map((k) => (
                <label key={k} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={shift[k]} disabled={pending || leads[k] === 0} onChange={(e) => setShift((v) => ({ ...v, [k]: e.target.checked }))} />
                  {k === "open" ? "Open" : k === "lost" ? "Lost" : "Booked"} ({leads[k]})
                </label>
              ))}
            </fieldset>
            <Field label="Move to" error={shiftErr.toUserId}>
              {(id, d) => (
                <select id={id} aria-describedby={d} className={selectClass} value={shift.toUserId} disabled={pending} onChange={(e) => setShift((v) => ({ ...v, toUserId: e.target.value }))}>
                  <option value="">Choose an agent or manager</option>
                  {receivers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {ROLE_LABELS[r.role]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Status msg={shiftMsg} />
              <Button type="submit" variant="secondary" size="lg" disabled={pending || !shift.toUserId}>
                Move leads
              </Button>
            </div>
          </>
        ) : (
          <Status msg={shiftMsg} />
        )}
      </form>

      <div className="space-y-3 border-t border-zinc-100 pt-5">
        <p className={sectionTitle}>Account access</p>
        {account.status === "active" ? (
          <>
            <p className="text-xs text-zinc-600">Deactivating signs the person out everywhere and stops them signing in. Their records are kept.</p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Status msg={statusMsg} />
              <Button variant="secondary" size="lg" disabled={pending || isSelf} onClick={() => setConfirming(true)}>
                Deactivate account
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Status msg={statusMsg} />
            <Button
              variant="primary"
              size="lg"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setAccountStatusAction(account.id, { status: "active" });
                  setStatusMsg(result.ok ? { text: "Account reactivated.", ok: true } : { text: result.message, ok: false });
                  if (result.ok) router.refresh();
                })
              }
            >
              Reactivate account
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Deactivate ${account.name}?`}
        description={leads.open > 0 ? `They still own ${leads.open} open lead${leads.open === 1 ? "" : "s"}. You can move them first, or later.` : "They will be signed out and unable to sign in."}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setAccountStatusAction(account.id, { status: "inactive" });
                  setConfirming(false);
                  setStatusMsg(result.ok ? { text: "Account deactivated.", ok: true } : { text: result.message, ok: false });
                  if (result.ok) router.refresh();
                })
              }
            >
              Deactivate
            </Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-700">Their leads, history and records stay in the CRM.</p>
      </Modal>
    </div>
  );
}
