import type { Actor } from "@/server/auth/types";
import type { VoipProviderId, VoipUnavailableReason } from "./types";

/**
 * The provider-independent integration boundary for browser (WebRTC) calling.
 * See docs/VOIP_INTEGRATION.md. An adapter wraps one provider; the rest of the CRM only talks to
 * this interface, so swapping Twilio for a self-hosted SIP server touches one file.
 *
 * Rule: nothing in the CRM may invent a call, a call status, a duration or a connection. Call
 * facts only ever come from a provider event that passed `verifyWebhook`.
 */
export interface VoipProvider {
  readonly id: VoipProviderId;
  /** Human-readable name shown in the UI. */
  readonly name: string;
  /** Env var NAMES this adapter needs (documentation and `missing_config` reporting; never values). */
  readonly requiredEnv: readonly string[];
  readonly capabilities: VoipCapabilities;
  /** True only when the adapter is implemented AND every required setting is present. */
  isConfigured(env: VoipEnv): boolean;
  /** Why `isConfigured` is false (undefined when configured). */
  unavailableReason(env: VoipEnv): VoipUnavailableReason | undefined;
  /**
   * Server side: mints what the browser SDK needs to register/place calls for this user
   * (a short-lived access token, or SIP credentials for a WSS registrar). Must check the actor
   * may call before issuing anything. Throws when not configured.
   */
  createClientSession(actor: Actor, env: VoipEnv): Promise<VoipClientSession>;
  /**
   * Verifies a provider webhook (signature over the raw body/URL) and maps it to a call event.
   * Returns `{ ok: false }` for anything unverified; callers must then ignore the payload.
   */
  verifyWebhook(request: VoipWebhookRequest, env: VoipEnv): Promise<VoipWebhookResult>;
}

export type VoipEnv = Readonly<Record<string, string | undefined>>;

export type VoipCapabilities = {
  /** Place calls from the browser (WebRTC). */
  outboundBrowser: boolean;
  /** Receive calls in the browser. */
  inboundBrowser: boolean;
  /** Provider-side call recording. */
  recording: boolean;
  /** Can present a Pakistani (+92) caller ID. Unverified for every cloud provider today. */
  localPakistanCallerId: boolean;
};

/** Returned to the browser by a future `POST /api/v1/voip/session`; short-lived, per user. */
export type VoipClientSession = {
  provider: VoipProviderId;
  /** Provider identity for this CRM user (e.g. "user_<uuid>"); never the user's email. */
  identity: string;
  /** Short-lived access token (cloud providers) — omitted for SIP. */
  token?: string;
  /** WSS registrar and SIP URI (self-hosted SIP). */
  sip?: { wsUri: string; uri: string; authorizationUser: string; password: string };
  /** STUN/TURN servers for the RTCPeerConnection. */
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[];
  expiresAt: string;
};

export type VoipWebhookRequest = { url: string; headers: Headers; rawBody: string };

export type VoipCallEvent = {
  providerCallId: string;
  status: "initiated" | "ringing" | "answered" | "completed" | "busy" | "no_answer" | "failed" | "canceled";
  /** Seconds, only as reported by the provider. */
  durationSeconds?: number;
  recordingUrl?: string;
  occurredAt: string;
};

export type VoipWebhookResult = { ok: true; event: VoipCallEvent } | { ok: false; reason: string };
