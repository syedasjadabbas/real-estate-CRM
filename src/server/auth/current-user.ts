import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
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

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}
