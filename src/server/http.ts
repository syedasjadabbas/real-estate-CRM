import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { requireActor } from "@/server/auth/current-user";
import type { Actor } from "@/server/auth/types";
import { getDb, type Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { getProjectScope } from "@/server/project-scope";
import { selectableProjects } from "@/modules/projects/queries";

type Handler = (ctx: { req: NextRequest; db: Database; actor: Actor; params: Record<string, string> }) => Promise<unknown>;

/** Rejects cross-site state-changing requests (cookie auth + SameSite=Lax + Origin check). */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    throw new AppError("FORBIDDEN", "Cross-origin request blocked.");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, fields: error.fields, details: error.details } },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Internal error." } }, { status: 500 });
}

/** Authenticated JSON route: { data } on success, { error } with the documented status codes otherwise. */
export function apiRoute(handler: Handler, status = 200) {
  return async (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => {
    // Authenticated data is always request-time: opt out of GET prerendering before the try/catch,
    // so the prerender interruption isn't swallowed as an error.
    await connection();
    try {
      assertSameOrigin(req);
      const actor = await requireActor();
      const params = (await ctx?.params) ?? {};
      const data = await handler({ req, db: getDb(), actor, params });
      return NextResponse.json({ data: data ?? null }, { status });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be JSON.");
  }
}

/** `?projectId=` when valid, else the project selected in the UI. */
export async function resolveProjectId(req: NextRequest, db: Database) {
  const requested = req.nextUrl.searchParams.get("projectId");
  if (requested) {
    const projects = await selectableProjects(db, await requireActor());
    if (!projects.some((p) => p.id === requested)) throw new AppError("VALIDATION_FAILED", "Unknown project.");
    return requested;
  }
  const { activeProjectId } = await getProjectScope();
  if (!activeProjectId) throw new AppError("BUSINESS_RULE", "No active project.");
  return activeProjectId;
}

export function queryObject(req: NextRequest) {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}
