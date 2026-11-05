"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  requestMeta,
  requireActor,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/server/auth/current-user";
import { fieldErrors } from "@/modules/leads/validation";
import { projectCookieName, selectableProjects } from "@/modules/projects/queries";
import { authenticate, loginSchema } from "@/server/auth/login";
import { revokeSession } from "@/server/auth/session-store";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";
import { SHARED_PROJECT_COOKIE } from "@/server/project-scope";

export type LoginState = { error?: string; fields?: Record<string, string>; email?: string } | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const input = { email, password: String(formData.get("password") ?? "") };
  // Field validation first, so the form gives precise feedback before touching the database.
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fields: fieldErrors(parsed.error), email };
  }
  try {
    const { token } = await authenticate(getDb(), input, await requestMeta());
    await setSessionCookie(token);
  } catch (error) {
    const result = toActionError(error);
    return { error: result.message, fields: result.fields, email };
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getDb(), token, await requestMeta());
  await clearSessionCookie();
  (await cookies()).delete(SHARED_PROJECT_COOKIE);
  redirect("/login");
}

export async function setActiveProjectAction(projectId: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const projects = await selectableProjects(getDb(), actor);
    if (!projects.some((p) => p.id === projectId)) {
      return { ok: false, code: "VALIDATION_FAILED", message: "That project is not available." };
    }
    (await cookies()).set(projectCookieName(actor.id), projectId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
