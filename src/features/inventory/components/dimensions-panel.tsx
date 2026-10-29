"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { textareaClass } from "@/features/leads/components/follow-up-dialog";
import { cn } from "@/lib/cn";
import { DIMENSION_KEYS, DIMENSION_LABELS, type DimensionKey } from "@/modules/inventory/constants";
import type { ProjectDimensions } from "@/server/db/schema";
import { updateDimensionsAction } from "../actions";

const toText = (list?: string[]) => (list ?? []).join("\n");
const toList = (text: string) => text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);

/**
 * FR-061 inventory dimensions for a project. Admins edit one value per line; an empty list
 * leaves that unit field as free text. Others see the lists read-only.
 */
export function DimensionsPanel({ projectId, dimensions, canManage }: { projectId: string; dimensions: ProjectDimensions; canManage: boolean }) {
  const initial = Object.fromEntries(DIMENSION_KEYS.map((k) => [k, toText(dimensions[k])])) as Record<DimensionKey, string>;
  const [values, setValues] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  if (!canManage) {
    return (
      <dl className="space-y-2 text-xs">
        {DIMENSION_KEYS.map((k) => (
          <div key={k}>
            <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{DIMENSION_LABELS[k]}</dt>
            <dd className="mt-0.5 text-zinc-800">{dimensions[k]?.length ? dimensions[k]!.join(", ") : <span className="text-zinc-400">Free text</span>}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">One value per line. Units in this project must use these values; leave a list empty to allow free text.</p>
      {DIMENSION_KEYS.map((k) => (
        <Field key={k} label={DIMENSION_LABELS[k]}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={values[k]}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              placeholder="Free text"
              className={textareaClass}
              disabled={pending}
            />
          )}
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await updateDimensionsAction(projectId, Object.fromEntries(DIMENSION_KEYS.map((k) => [k, toList(values[k])])));
              setMsg(result.ok ? { text: result.data.changed ? "Dimensions saved." : "Nothing changed.", ok: true } : { text: result.message, ok: false });
            })
          }
        >
          Save dimensions
        </Button>
        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-xs font-semibold", msg.ok ? "text-brand" : "text-rose-600")}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
