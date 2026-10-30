import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Client IP resolution behind a trusted reverse proxy (docs/PRODUCTION_READINESS_PLAN.md §2).
 *
 * Next.js only fills `x-forwarded-for` from the socket when the header is missing, and App Router
 * code cannot see the peer address, so a browser-supplied header is indistinguishable from a proxy's.
 * Forwarded headers are therefore trusted only when the deployment says a proxy overwrites them
 * (`TRUST_PROXY=true`); otherwise no IP is recorded in production. Pure functions, no Next.js imports.
 */

export type ProxyConfig = {
  trustProxy: boolean;
  /** Trusted proxies in front of the app; the client is this many entries from the right. */
  proxyCount: number;
  /** Lower-case header the proxy overwrites. */
  header: string;
  sharedSecret: string | null;
  production: boolean;
  /** Set when the environment variables are present but unusable; nothing is trusted then. */
  invalid: string | null;
};

type Env = Record<string, string | undefined>;
type HeaderSource = { get(name: string): string | null };

export const PROXY_SECRET_HEADER = "x-proxy-secret";
const MAX_HEADER_LENGTH = 1024;
export const MAX_USER_AGENT_LENGTH = 512;
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

export function readProxyConfig(env: Env = process.env): ProxyConfig {
  const production = env.NODE_ENV === "production";
  const trustRaw = env.TRUST_PROXY?.trim().toLowerCase();
  const countRaw = env.TRUSTED_PROXY_COUNT?.trim();
  const header = (env.CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for");
  const sharedSecret = env.PROXY_SHARED_SECRET?.trim() || null;
  const proxyCount = countRaw ? Number(countRaw) : 1;
  let invalid: string | null = null;
  if (trustRaw && trustRaw !== "true" && trustRaw !== "false") invalid = "TRUST_PROXY must be true or false";
  else if (!Number.isInteger(proxyCount) || proxyCount < 1 || proxyCount > 10) invalid = "TRUSTED_PROXY_COUNT must be a whole number from 1 to 10";
  else if (!HEADER_NAME.test(header)) invalid = "CLIENT_IP_HEADER is not a valid header name";
  return { trustProxy: !invalid && trustRaw === "true", proxyCount, header, sharedSecret, production, invalid };
}

/** Canonical IP text, or null: trims, drops ports and IPv6 brackets, unwraps IPv4-mapped IPv6. */
export function normalizeIp(value: string | null | undefined): string | null {
  let v = value?.trim();
  if (!v || v.length > 64) return null;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(v);
  if (bracketed) v = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  v = v.replace(/%.*$/, "").toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/.exec(v);
  if (mapped) v = mapped[1];
  return isIP(v) ? v : null;
}

const isLoopback = (ip: string) => ip === "::1" || /^127\./.test(ip);

export function secretMatches(expected: string, given: string | null) {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ClientIpResult = { ip: string | null; reason: "trusted" | "local" | "untrusted" | "missing" | "invalid" | "secret" | "config" };

/** The verified client IP for this request, or null when it cannot be trusted. */
export function resolveClientIp(headers: HeaderSource, config: ProxyConfig): ClientIpResult {
  if (config.invalid) return { ip: null, reason: "config" };
  if (!config.trustProxy) {
    if (config.production) return { ip: null, reason: "untrusted" };
    // Development and tests: accept only the loopback address Next.js fills in for a local
    // connection. Anything else could have been typed by the browser.
    const raw = headers.get("x-forwarded-for");
    const only = raw && !raw.includes(",") ? normalizeIp(raw) : null;
    return only && isLoopback(only) ? { ip: only, reason: "local" } : { ip: null, reason: raw ? "untrusted" : "missing" };
  }
  if (config.sharedSecret && !secretMatches(config.sharedSecret, headers.get(PROXY_SECRET_HEADER))) return { ip: null, reason: "secret" };
  const raw = headers.get(config.header);
  if (!raw) return { ip: null, reason: "missing" };
  if (raw.length > MAX_HEADER_LENGTH) return { ip: null, reason: "invalid" };
  if (config.header !== "x-forwarded-for") {
    const ip = normalizeIp(raw);
    return ip ? { ip, reason: "trusted" } : { ip: null, reason: "invalid" };
  }
  // Each trusted proxy appends (or overwrites with) the address it saw, so the client is
  // `proxyCount` entries from the right; entries further left came from the browser.
  const hops = raw.split(",").map((s) => s.trim());
  if (hops.length < config.proxyCount) return { ip: null, reason: "invalid" };
  const ip = normalizeIp(hops[hops.length - config.proxyCount]);
  return ip ? { ip, reason: "trusted" } : { ip: null, reason: "invalid" };
}

/** Stored user agent: as received, trimmed and capped. */
export function cleanUserAgent(value: string | null | undefined) {
  const v = value?.trim();
  return v ? v.slice(0, MAX_USER_AGENT_LENGTH) : null;
}
