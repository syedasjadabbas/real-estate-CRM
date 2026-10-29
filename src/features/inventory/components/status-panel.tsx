"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { selectClass } from "@/features/leads/components/lead-fields";
import { cn } from "@/lib/cn";
import { UNIT_STATUSES, UNIT_STATUS_LABELS, type SaleModel, type UnitStatus } from "@/modules/inventory/constants";
import { setUnitStatusAction } from "../actions";
import { UnitStatusPill } from "./status-pill";

/**
 * Status with the admin override (reason required, audited). Bookings will drive these
 * transitions once that module exists; until then this mirrors the reference manually.
 */
export function UnitStatusPanel({
  unitId,
  status,
  saleModel,
  canManage,
}: {
  unitId: string;
  status: UnitStatus;
  saleModel: SaleModel;
  canManage: boolean;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const options = UNIT_STATUSES.filter((s) => s !== status && (s !== "partially_booked" || saleModel !== "whole"));

  return (
    <PanelCard title="Status">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-600">Current status</span>
          <UnitStatusPill status={status} />
        </div>
        {canManage ? (
          <div className="space-y-3 border-t border-zinc-100 pt-3">
            <p className="text-[11px] text-zinc-500">Admin override until Bookings updates status automatically. A reason is required and recorded.</p>
            <Field label="New status" error={errors.status}>
              {(id, describedBy) => (
                <select id={id} aria-describedby={describedBy} value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass} disabled={pending}>
                  <option value="">Select a status…</option>
                  {options.map((s) => (
                    <option key={s} value={s}>
                      {UNIT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Reason" required error={errors.reason}>
              {(id, describedBy) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Sold in SaleStorm on 12 Oct"
                  className={textareaClass}
                  disabled={pending}
                />
              )}
            </Field>
            <Button
              variant="primary"
              size="lg"
              disabled={!target || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setUnitStatusAction(unitId, target, reason);
                  if (result.ok) {
                    setErrors({});
                    setTarget("");
                    setReason("");
                    setMsg({ text: `Status changed to ${UNIT_STATUS_LABELS[result.data.to]}.`, ok: true });
                  } else {
                    setErrors(result.fields ?? {});
                    setMsg({ text: result.message, ok: false });
                  }
                })
              }
            >
              Change status
            </Button>
          </div>
        ) : null}
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </PanelCard>
  );
}
