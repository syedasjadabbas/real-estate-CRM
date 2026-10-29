import { cookies } from "next/headers";
import { clearSessionCookie, requestMeta, SESSION_COOKIE } from "@/server/auth/current-user";
import { revokeSession } from "@/server/auth/session-store";
import { apiRoute } from "@/server/http";

/** POST /api/v1/auth/logout — revokes the current session. */
export const POST = apiRoute(async ({ db }) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(db, token, await requestMeta());
  await clearSessionCookie();
  return { signedOut: true };
});
