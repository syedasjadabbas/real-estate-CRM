import { AppError } from "@/server/errors";
import type { VoipProvider } from "./provider";
import { VOIP_PROVIDER_LABELS, type VoipProviderId } from "./types";

/**
 * Typed placeholders, one per evaluated provider (docs/VOIP_INTEGRATION.md). None is implemented:
 * `isConfigured()` is always false, sessions are refused and every webhook is rejected. Replace a
 * placeholder with a real adapter only once the client has chosen the provider and supplied
 * credentials. The env names below are what that adapter is expected to read.
 */
const REQUIRED_ENV: Record<VoipProviderId, readonly string[]> = {
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_TWIML_APP_SID", "TWILIO_CALLER_ID"],
  vonage: ["VONAGE_APPLICATION_ID", "VONAGE_PRIVATE_KEY_PATH", "VONAGE_CALLER_ID"],
  plivo: ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN", "PLIVO_APP_ID", "PLIVO_CALLER_ID"],
  telnyx: ["TELNYX_API_KEY", "TELNYX_CREDENTIAL_CONNECTION_ID", "TELNYX_PUBLIC_KEY", "TELNYX_CALLER_ID"],
  sip: ["SIP_WSS_URI", "SIP_DOMAIN", "SIP_TURN_URI", "SIP_TURN_SECRET"],
};

function placeholder(id: VoipProviderId): VoipProvider {
  return {
    id,
    name: VOIP_PROVIDER_LABELS[id],
    requiredEnv: REQUIRED_ENV[id],
    capabilities: { outboundBrowser: false, inboundBrowser: false, recording: false, localPakistanCallerId: false },
    isConfigured: () => false,
    unavailableReason: () => "adapter_not_implemented",
    async createClientSession() {
      throw new AppError("BUSINESS_RULE", "Browser calling isn't set up yet.");
    },
    async verifyWebhook() {
      return { ok: false, reason: "adapter_not_implemented" };
    },
  };
}

export const VOIP_PROVIDERS: Record<VoipProviderId, VoipProvider> = {
  twilio: placeholder("twilio"),
  vonage: placeholder("vonage"),
  plivo: placeholder("plivo"),
  telnyx: placeholder("telnyx"),
  sip: placeholder("sip"),
};
