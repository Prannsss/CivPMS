import "server-only";

/**
 * Bearer-secret check for /api/cron/* (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * automatically when the CRON_SECRET env var is set). Constant-time comparison; without a
 * configured secret every request is refused.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv, warnOnce } from "@/lib/env";

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** True when the header carries exactly `secret`. Hashing first keeps the compare length-safe. */
export function isAuthorizedCron(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const token = bearerToken(authorization);
  if (!token) return false;
  return timingSafeEqual(digest(token), digest(secret));
}

export function cronUnauthorizedResponse(): Response {
  return Response.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="cron"', "Cache-Control": "no-store" } },
  );
}

/** Returns a 401 response when the request is not authorized, or null to continue. */
export function authorizeCronRequest(request: Request): Response | null {
  const { cronSecret } = serverEnv();
  if (!cronSecret) {
    warnOnce("cron:no-secret", "CRON_SECRET is not set: /api/cron/* refuses every request.");
    return cronUnauthorizedResponse();
  }
  return isAuthorizedCron(request.headers.get("authorization"), cronSecret) ? null : cronUnauthorizedResponse();
}
