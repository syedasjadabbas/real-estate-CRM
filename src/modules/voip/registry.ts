import type { VoipEnv, VoipProvider } from "./provider";
import { VOIP_PROVIDERS } from "./providers";
import { VOIP_PROVIDER_IDS, type VoipProviderId, type VoipStatus } from "./types";

/**
 * Picks the provider from `VOIP_PROVIDER` (unset = none). Pure: the env is passed in so tests and
 * callers control it. Never returns or logs secret values.
 */
export function selectedProviderId(env: VoipEnv): { id: VoipProviderId | null; known: boolean; raw: string } {
  const raw = (env.VOIP_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return { id: null, known: true, raw };
  const id = (VOIP_PROVIDER_IDS as readonly string[]).includes(raw) ? (raw as VoipProviderId) : null;
  return { id, known: id !== null, raw };
}

export function resolveVoipProvider(env: VoipEnv): VoipProvider | null {
  const { id } = selectedProviderId(env);
  return id ? VOIP_PROVIDERS[id] : null;
}

/** The browser-safe calling status: configured or not, the provider name, and why not. */
export function voipStatus(env: VoipEnv): VoipStatus {
  const selected = selectedProviderId(env);
  if (!selected.known) return { configured: false, reason: "unknown_provider", provider: null, providerName: null };
  if (!selected.id) return { configured: false, reason: "not_selected", provider: null, providerName: null };
  const provider = VOIP_PROVIDERS[selected.id];
  if (!provider.isConfigured(env)) {
    return {
      configured: false,
      reason: provider.unavailableReason(env) ?? "missing_config",
      provider: provider.id,
      providerName: provider.name,
    };
  }
  return { configured: true, provider: provider.id, providerName: provider.name };
}
