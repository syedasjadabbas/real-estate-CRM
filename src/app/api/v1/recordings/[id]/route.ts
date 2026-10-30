import { connection, type NextRequest } from "next/server";
import { openRecording } from "@/modules/recordings/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse } from "@/server/http";
import { notFound } from "@/server/errors";
import { objectSize, readObject } from "@/server/storage/local";
import { parseRange } from "@/server/storage/range";

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

/**
 * GET — streams a call recording to someone who may view its lead (404 otherwise). Supports byte
 * ranges so audio players can seek. Never cached; `?download=1` saves the file instead of playing it.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/recordings/[id]">) {
  await connection();
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const file = await openRecording(getDb(), actor, id);
    let size: number;
    try {
      size = await objectSize(file.storageKey);
    } catch {
      throw notFound("Recording file");
    }
    const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    const headers = new Headers({
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${disposition}; filename="${asciiName(file.originalName)}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    });
    const range = parseRange(req.headers.get("range"), size);
    if (range === "invalid") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(readObject(file.storageKey, range), { status: 206, headers });
    }
    headers.set("Content-Length", String(size));
    return new Response(readObject(file.storageKey), { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}
