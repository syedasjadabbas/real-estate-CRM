import { connection, type NextRequest } from "next/server";
import { openDocument } from "@/modules/documents/service";
import { DOCUMENT_FORMATS, type DocumentFormat } from "@/modules/documents/validation";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse } from "@/server/http";
import { notFound } from "@/server/errors";
import { objectSize, readObject } from "@/server/storage/local";

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

/**
 * GET — a lead document for someone who may view its lead (404 otherwise). Images open inline in a
 * sandbox; PDF and Office files always download. Never cached.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]">) {
  await connection();
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const file = await openDocument(getDb(), actor, id);
    let size: number;
    try {
      size = await objectSize(file.storageKey);
    } catch {
      throw notFound("Document file");
    }
    const ext = file.storageKey.slice(file.storageKey.lastIndexOf(".") + 1) as DocumentFormat;
    const inline = DOCUMENT_FORMATS[ext]?.inline && req.nextUrl.searchParams.get("download") !== "1";
    return new Response(readObject(file.storageKey), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName(file.originalName)}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
