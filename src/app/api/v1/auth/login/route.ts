import { NextResponse, type NextRequest } from "next/server";
import { requestMeta, setSessionCookie } from "@/server/auth/current-user";
import { fieldErrors } from "@/modules/leads/validation";
import { authenticate, loginSchema } from "@/server/auth/login";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { errorResponse, readJson } from "@/server/http";
import { isSameOriginRequest } from "@/server/origin";

/** POST /api/v1/auth/login — { email, password } → session cookie. */
export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginRequest(req.headers, req.nextUrl.origin)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-origin request blocked." } }, { status: 403 });
    }
    const body = await readJson(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: fieldErrors(parsed.error) });
    }
    const { token, userId } = await authenticate(getDb(), parsed.data, await requestMeta());
    await setSessionCookie(token);
    return NextResponse.json({ data: { userId } });
  } catch (error) {
    return errorResponse(error);
  }
}
