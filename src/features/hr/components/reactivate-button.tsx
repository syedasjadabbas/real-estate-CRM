"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setAccountStatusAction } from "../actions";

/** Turns a switched-off account back on (owner, 16 Nov 2026); the row then leaves the list. */
export function ReactivateButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        size="lg"
        disabled={pending}
        aria-label={`Reactivate ${name}`}
        onClick={() => {
          if (!window.confirm(`Reactivate ${name}? They can sign in again straight away with their existing password.`)) return;
          setError(null);
          startTransition(async () => {
            const r = await setAccountStatusAction(userId, { status: "active" });
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
      >
        {pending ? "Reactivating…" : "Reactivate"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-[220px] text-right text-[11px] font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
