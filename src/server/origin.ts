import { readProxyConfig, PROXY_SECRET_HEADER, secretMatches, type ProxyConfig } from "@/server/auth/client-ip";

type HeaderSource = { get(name: string): string | null };

/**
 * CSRF guard for state-changing API requests (cookie auth + SameSite=Lax + this Origin check).
 *
 * `req.nextUrl.origin` is built from the hostname Next.js was started with (`next start
 * --hostname`), not from what the browser addressed, so it cannot be compared with `Origin`
 * directly. Instead the Origin's host must equal the host the browser sent the request to: the
 * `Host` header (a browser never lets a page set it), or `X-Forwarded-Host` when a trusted proxy
 * overwrites it (`TRUST_PROXY=true`, see docs/DEPLOYMENT_PROXY.md). Pure function, no Next.js imports.
 */
export function isSameOriginRequest(headers: HeaderSource, fallbackOrigin: string, config: ProxyConfig = readProxyConfig()): boolean {
  const raw = headers.get("origin");
  // Browsers send Origin on every cross-site POST/PUT/PATCH/DELETE; its absence means a
  // same-origin navigation or a non-browser client, which carries no ambient cookies to abuse.
  if (!raw) return true;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  if (raw === fallbackOrigin) return true;

  const hosts: string[] = [];
  const trusted = config.trustProxy && !config.invalid && (!config.sharedSecret || secretMatches(config.sharedSecret, headers.get(PROXY_SECRET_HEADER)));
  if (trusted) {
    const forwardedHost = first(headers.get("x-forwarded-host"));
    if (forwardedHost) hosts.push(forwardedHost);
    const proto = first(headers.get("x-forwarded-proto"));
    if (proto && `${proto.toLowerCase()}:` !== origin.protocol) return false;
  }
  const host = headers.get("host");
  if (host) hosts.push(host);
  return hosts.some((h) => normalizeHost(h, origin.protocol) === origin.host);
}

const first = (value: string | null) => value?.split(",")[0]?.trim() || null;

/** Host as the browser would write it for this scheme (lower case, default port dropped), or null. */
function normalizeHost(host: string, protocol: string) {
  if (!/^[a-z0-9.\-[\]:]{1,255}$/i.test(host)) return null;
  try {
    return new URL(`${protocol}//${host}`).host;
  } catch {
    return null;
  }
}
