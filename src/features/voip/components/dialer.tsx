"use client";

import { Phone, PhoneOff } from "lucide-react";
import { useId } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VOIP_REASON_TEXT, type VoipStatus } from "@/modules/voip/types";

/**
 * Browser-calling panel on the lead page (docs/VOIP_INTEGRATION.md). It never shows a call, a
 * status, a duration or a connection the provider didn't report. Until a provider adapter exists
 * it says calling isn't set up and offers the phone's own dialer (`tel:`).
 */
export function Dialer({ status, telHref, leadName, phone }: { status: VoipStatus; telHref: string; leadName: string; phone: string }) {
  const titleId = useId();
  const phoneCall = (
    <a href={telHref} className={buttonClasses({ variant: "secondary", size: "lg" })} aria-label={`Call ${leadName} on ${phone} with your phone`}>
      <Phone aria-hidden="true" className="size-4" />
      Call with phone
    </a>
  );

  return (
    <Card className="p-4" role="region" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm leading-5 font-black">
            Browser calling
          </h3>
          {status.configured ? (
            <p className="text-xs text-zinc-600">Calling through {status.providerName}.</p>
          ) : (
            <div role="status" className="mt-0.5 flex items-start gap-1.5 text-xs text-zinc-600">
              <PhoneOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
              <p>
                <span className="font-bold text-zinc-800">Browser calling isn&apos;t set up yet.</span> {VOIP_REASON_TEXT[status.reason]} Use
                your phone to call {phone}.
              </p>
            </div>
          )}
        </div>
        {phoneCall}
      </div>
      {status.configured ? (
        // The provider's browser SDK mounts here once its adapter is built (loaded client-side
        // with a short-lived session from the server). Nothing is rendered until it reports a state.
        <div data-voip-provider={status.provider} data-voip-mount="" className="mt-3" aria-live="polite" />
      ) : null}
    </Card>
  );
}
