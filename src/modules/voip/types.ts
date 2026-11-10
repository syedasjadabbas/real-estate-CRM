/**
 * Browser-calling (VoIP) types shared by the server and the Dialer client component.
 * Zod-free and server-free on purpose: client components import this file, and Zod probes
 * `new Function`, which the CSP reports (docs/VOIP_INTEGRATION.md).
 */

/** Providers the integration boundary knows about. None has a working adapter yet. */
export const VOIP_PROVIDER_IDS = ["twilio", "vonage", "plivo", "telnyx", "sip"] as const;
export type VoipProviderId = (typeof VOIP_PROVIDER_IDS)[number];

export const VOIP_PROVIDER_LABELS: Record<VoipProviderId, string> = {
  twilio: "Twilio Voice",
  vonage: "Vonage Voice",
  plivo: "Plivo Voice",
  telnyx: "Telnyx WebRTC",
  sip: "Self-hosted SIP (Asterisk/FreeSWITCH)",
};

/** Why browser calling is unavailable. */
export type VoipUnavailableReason =
  /** `VOIP_PROVIDER` is unset or empty. */
  | "not_selected"
  /** `VOIP_PROVIDER` names a provider this build doesn't know. */
  | "unknown_provider"
  /** A known provider whose adapter hasn't been built yet (all of them, today). */
  | "adapter_not_implemented"
  /** The adapter exists but required credentials/config are missing. */
  | "missing_config";

/** What the browser may learn about calling: never secrets, never credentials. */
export type VoipStatus =
  | { configured: false; reason: VoipUnavailableReason; provider: VoipProviderId | null; providerName: string | null }
  | { configured: true; provider: VoipProviderId; providerName: string };

export const VOIP_REASON_TEXT: Record<VoipUnavailableReason, string> = {
  not_selected: "No calling provider has been chosen.",
  unknown_provider: "The configured calling provider isn't supported.",
  adapter_not_implemented: "The chosen calling provider hasn't been connected yet.",
  missing_config: "The calling provider's credentials are incomplete.",
};
