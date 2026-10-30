import { describe, expect, it } from "vitest";
import { cleanUserAgent, normalizeIp, readProxyConfig, resolveClientIp, type ProxyConfig } from "@/server/auth/client-ip";

const h = (values: Record<string, string>) => new Headers(values);
const config = (env: Record<string, string | undefined>) => readProxyConfig(env);
const prodTrusted = (extra: Record<string, string> = {}) => config({ NODE_ENV: "production", TRUST_PROXY: "true", ...extra });
const ip = (headers: Record<string, string>, c: ProxyConfig) => resolveClientIp(h(headers), c).ip;

describe("proxy configuration", () => {
  it("defaults to not trusting any forwarded header", () => {
    expect(config({ NODE_ENV: "production" })).toMatchObject({ trustProxy: false, proxyCount: 1, header: "x-forwarded-for", sharedSecret: null, production: true, invalid: null });
  });

  it("marks unusable values invalid and then trusts nothing", () => {
    for (const env of [{ TRUST_PROXY: "yes" }, { TRUST_PROXY: "true", TRUSTED_PROXY_COUNT: "0" }, { TRUST_PROXY: "true", TRUSTED_PROXY_COUNT: "1.5" }, { TRUST_PROXY: "true", CLIENT_IP_HEADER: "bad header!" }]) {
      const c = config({ NODE_ENV: "production", ...env });
      expect(c.invalid).not.toBeNull();
      expect(c.trustProxy).toBe(false);
      expect(resolveClientIp(h({ "x-forwarded-for": "203.0.113.9" }), c)).toEqual({ ip: null, reason: "config" });
    }
  });
});

describe("IP normalisation", () => {
  it("accepts IPv4 and IPv6, strips ports and brackets, unwraps mapped IPv4", () => {
    expect(normalizeIp(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9:51234")).toBe("203.0.113.9");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });

  it("rejects anything that is not an IP", () => {
    for (const v of ["", "unknown", "999.1.1.1", "1.2.3", "<script>", "example.com", "1.2.3.4; DROP", "x".repeat(100), null, undefined]) expect(normalizeIp(v)).toBeNull();
  });
});

describe("trusted proxy (production)", () => {
  it("takes the client from the right of X-Forwarded-For, ignoring browser-added entries", () => {
    const c = prodTrusted();
    expect(ip({ "x-forwarded-for": "203.0.113.9" }, c)).toBe("203.0.113.9");
    // Browser sent a fake value; the proxy appended the real address.
    expect(ip({ "x-forwarded-for": "6.6.6.6, 1.1.1.1, 203.0.113.9" }, c)).toBe("203.0.113.9");
  });

  it("walks back one entry per trusted proxy in a chain", () => {
    const c = prodTrusted({ TRUSTED_PROXY_COUNT: "2" });
    expect(ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }, c)).toBe("203.0.113.9");
    expect(resolveClientIp(h({ "x-forwarded-for": "203.0.113.9" }), c)).toEqual({ ip: null, reason: "invalid" });
  });

  it("supports a single-value header the proxy overwrites", () => {
    const c = prodTrusted({ CLIENT_IP_HEADER: "X-Real-IP" });
    expect(ip({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }, c)).toBe("198.51.100.4");
    expect(ip({ "x-real-ip": "6.6.6.6, 198.51.100.4" }, c)).toBeNull();
  });

  it("returns null for missing, malformed or oversized headers", () => {
    const c = prodTrusted();
    expect(resolveClientIp(h({}), c)).toEqual({ ip: null, reason: "missing" });
    expect(resolveClientIp(h({ "x-forwarded-for": "not-an-ip" }), c)).toEqual({ ip: null, reason: "invalid" });
    expect(resolveClientIp(h({ "x-forwarded-for": `${"1.1.1.1, ".repeat(200)}203.0.113.9` }), c)).toEqual({ ip: null, reason: "invalid" });
  });

  it("requires the shared proxy secret when one is configured", () => {
    const c = prodTrusted({ PROXY_SHARED_SECRET: "s3cret-value" });
    expect(resolveClientIp(h({ "x-forwarded-for": "203.0.113.9" }), c)).toEqual({ ip: null, reason: "secret" });
    expect(resolveClientIp(h({ "x-forwarded-for": "203.0.113.9", "x-proxy-secret": "wrong" }), c)).toEqual({ ip: null, reason: "secret" });
    expect(ip({ "x-forwarded-for": "203.0.113.9", "x-proxy-secret": "s3cret-value" }, c)).toBe("203.0.113.9");
  });
});

describe("no trusted proxy configured", () => {
  it("records no IP in production, whatever the browser sends (D4)", () => {
    const c = config({ NODE_ENV: "production" });
    const attempts: Record<string, string>[] = [{ "x-forwarded-for": "203.0.113.9" }, { "x-real-ip": "203.0.113.9" }, { "x-forwarded-for": "127.0.0.1" }, {}];
    for (const headers of attempts) {
      expect(ip(headers, c)).toBeNull();
    }
  });

  it("in development accepts only the local loopback address Next.js fills in", () => {
    const c = config({ NODE_ENV: "development" });
    expect(resolveClientIp(h({ "x-forwarded-for": "::1" }), c)).toEqual({ ip: "::1", reason: "local" });
    expect(ip({ "x-forwarded-for": "127.0.0.1" }, c)).toBe("127.0.0.1");
    expect(ip({ "x-forwarded-for": "::ffff:127.0.0.1" }, c)).toBe("127.0.0.1");
    // Spoofing attempts in development are not recorded either.
    expect(ip({ "x-forwarded-for": "203.0.113.9" }, c)).toBeNull();
    expect(ip({ "x-forwarded-for": "203.0.113.9, ::1" }, c)).toBeNull();
    expect(ip({ "x-real-ip": "::1" }, c)).toBeNull();
    expect(resolveClientIp(h({}), c)).toEqual({ ip: null, reason: "missing" });
  });
});

describe("user agent", () => {
  it("is trimmed and capped at 512 characters", () => {
    expect(cleanUserAgent("  Mozilla/5.0  ")).toBe("Mozilla/5.0");
    expect(cleanUserAgent("a".repeat(2000))).toHaveLength(512);
    expect(cleanUserAgent("   ")).toBeNull();
    expect(cleanUserAgent(null)).toBeNull();
  });
});
