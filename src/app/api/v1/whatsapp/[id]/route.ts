import { connection, type NextRequest } from "next/server";
import { openWhatsapp } from "@/modules/whatsapp/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse } from "@/server/http";
import { notFound } from "@/server/errors";
import { objectSize, readObject } from "@/server/storage/local";

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

/** GET — a WhatsApp screenshot for someone who may view its lead (404 otherwise). Inline; ?download=1 saves it. Never cached. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/whatsapp/[id]">) {
  await connection();
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const file = await openWhatsapp(getDb(), actor, id);
    let size: number;
    try {
      size = await objectSize(file.storageKey);
    } catch {
      throw notFound("Screenshot file");
    }
    const inline = req.nextUrl.searchParams.get("download") !== "1";
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
