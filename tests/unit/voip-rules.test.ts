import { describe, expect, it } from "vitest";
import { VOIP_PROVIDERS } from "@/modules/voip/providers";
import { resolveVoipProvider, selectedProviderId, voipStatus } from "@/modules/voip/registry";
import { VOIP_PROVIDER_IDS } from "@/modules/voip/types";
import type { Actor } from "@/server/auth/types";

const agent: Actor = { id: "u1", name: "Agent", email: "a@example.com", role: "agent", managedTeamIds: [] };

describe("VoIP provider selection", () => {
  it("treats an unset, empty or 'none' VOIP_PROVIDER as no provider", () => {
    for (const env of [{}, { VOIP_PROVIDER: "" }, { VOIP_PROVIDER: "   " }, { VOIP_PROVIDER: "none" }]) {
      expect(resolveVoipProvider(env)).toBeNull();
      expect(voipStatus(env)).toEqual({ configured: false, reason: "not_selected", provider: null, providerName: null });
    }
  });

  it("reports an unknown provider without echoing the raw value", () => {
    const status = voipStatus({ VOIP_PROVIDER: "acme-voice" });
    expect(status).toEqual({ configured: false, reason: "unknown_provider", provider: null, providerName: null });
    expect(JSON.stringify(status)).not.toContain("acme");
    expect(selectedProviderId({ VOIP_PROVIDER: "acme-voice" }).known).toBe(false);
  });

  it("is case-insensitive for known providers", () => {
    expect(resolveVoipProvider({ VOIP_PROVIDER: " Twilio " })?.id).toBe("twilio");
  });
});

describe("VoIP placeholders never claim to work", () => {
  it("every known provider is not configured, even with all its env names set", () => {
    for (const id of VOIP_PROVIDER_IDS) {
      const provider = VOIP_PROVIDERS[id];
      const env = { VOIP_PROVIDER: id, ...Object.fromEntries(provider.requiredEnv.map((k) => [k, "secret-value"])) };
      expect(provider.isConfigured(env), id).toBe(false);
      expect(Object.values(provider.capabilities).every((c) => c === false), id).toBe(true);
      const status = voipStatus(env);
      expect(status, id).toEqual({ configured: false, reason: "adapter_not_implemented", provider: id, providerName: provider.name });
      expect(JSON.stringify(status)).not.toContain("secret-value");
    }
  });

  it("refuses to mint a client session and rejects every webhook", async () => {
    for (const id of VOIP_PROVIDER_IDS) {
      const provider = VOIP_PROVIDERS[id];
      await expect(provider.createClientSession(agent, {})).rejects.toMatchObject({ code: "BUSINESS_RULE" });
      const result = await provider.verifyWebhook({ url: "https://crm.example/api/v1/voip/webhook", headers: new Headers(), rawBody: "{}" }, {});
      expect(result.ok).toBe(false);
    }
  });
});
