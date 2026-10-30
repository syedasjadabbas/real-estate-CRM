import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { cleanUserAgent, readProxyConfig, resolveClientIp } from "./client-ip";
import { findActorByToken, SESSION_ABSOLUTE_MS, type RequestMeta } from "./session-store";
import type { Actor } from "./types";

export const SESSION_COOKIE = "mz_session";

/** Reads the session cookie once per request. Must be called inside a <Suspense> boundary. */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findActorByToken(getDb(), token);
});

/** For pages: sends unauthenticated visitors to /login. */
export async function requirePageUser(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActor(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  return user;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

let warnedAboutProxy = false;

/**
 * IP and user agent for sign-in logging and the login rate limit. The IP is only taken from a
 * trusted proxy's header (see client-ip.ts); otherwise it is null, never a browser-supplied value.
 */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const config = readProxyConfig();
  const { ip, reason } = resolveClientIp(h, config);
  if (!ip && config.production && !warnedAboutProxy && (reason === "untrusted" || reason === "config" || reason === "secret")) {
    warnedAboutProxy = true;
    console.warn(
      `[client-ip] Not recording client IP addresses: ${config.invalid ?? (reason === "secret" ? "proxy secret missing or wrong" : "TRUST_PROXY is not enabled")}. See docs/DEPLOYMENT_PROXY.md.`,
    );
  }
  return { ip, userAgent: cleanUserAgent(h.get("user-agent")) };
}
