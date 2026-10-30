import { describe, expect, it } from "vitest";
import { readProxyConfig } from "@/server/auth/client-ip";
import { isSameOriginRequest } from "@/server/origin";

const h = (values: Record<string, string>) => new Headers(values);
const direct = readProxyConfig({ NODE_ENV: "production" });
const proxied = readProxyConfig({ NODE_ENV: "production", TRUST_PROXY: "true" });
const withSecret = readProxyConfig({ NODE_ENV: "production", TRUST_PROXY: "true", PROXY_SHARED_SECRET: "s3cret" });
// What `next start --hostname 127.0.0.1` or a proxied app reports as req.nextUrl.origin.
const NEXT_ORIGIN = "http://localhost:3000";

describe("same-origin check", () => {
  it("allows requests without an Origin header (non-browser clients carry no ambient cookies)", () => {
    expect(isSameOriginRequest(h({ host: "crm.example.com" }), NEXT_ORIGIN, direct)).toBe(true);
  });

  it("allows the browser's own origin even when Next.js reports a different hostname", () => {
    expect(isSameOriginRequest(h({ origin: "http://127.0.0.1:3300", host: "127.0.0.1:3300" }), NEXT_ORIGIN, direct)).toBe(true);
    expect(isSameOriginRequest(h({ origin: NEXT_ORIGIN }), NEXT_ORIGIN, direct)).toBe(true);
  });

  it("treats default ports and case as the browser does", () => {
    expect(isSameOriginRequest(h({ origin: "https://crm.example.com", host: "CRM.example.com:443" }), NEXT_ORIGIN, direct)).toBe(true);
  });

  it("rejects other sites, other ports, opaque and malformed origins", () => {
    for (const origin of ["https://evil.example", "http://127.0.0.1:3301", "null", "not a url", "file:///x"]) {
      expect(isSameOriginRequest(h({ origin, host: "127.0.0.1:3300" }), NEXT_ORIGIN, direct), origin).toBe(false);
    }
  });

  it("ignores forwarded headers unless TRUST_PROXY is on", () => {
    const headers = h({ origin: "https://evil.example", host: "127.0.0.1:3000", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
    expect(isSameOriginRequest(headers, NEXT_ORIGIN, direct)).toBe(false);
  });

  it("behind a trusted proxy, matches X-Forwarded-Host and requires the forwarded scheme", () => {
    const base = { host: "127.0.0.1:3000", "x-forwarded-host": "crm.example.com" };
    expect(isSameOriginRequest(h({ ...base, origin: "https://crm.example.com", "x-forwarded-proto": "https" }), NEXT_ORIGIN, proxied)).toBe(true);
    expect(isSameOriginRequest(h({ ...base, origin: "http://crm.example.com", "x-forwarded-proto": "https" }), NEXT_ORIGIN, proxied)).toBe(false);
    expect(isSameOriginRequest(h({ ...base, origin: "https://evil.example", "x-forwarded-proto": "https" }), NEXT_ORIGIN, proxied)).toBe(false);
  });

  it("trusts forwarded headers only with the shared secret when one is configured", () => {
    const base = { origin: "https://crm.example.com", host: "127.0.0.1:3000", "x-forwarded-host": "crm.example.com", "x-forwarded-proto": "https" };
    expect(isSameOriginRequest(h(base), NEXT_ORIGIN, withSecret)).toBe(false);
    expect(isSameOriginRequest(h({ ...base, "x-proxy-secret": "s3cret" }), NEXT_ORIGIN, withSecret)).toBe(true);
  });
});
