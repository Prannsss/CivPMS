/**
 * Sends queued notification emails (the outbox). Protected by `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends it automatically when the CRON_SECRET env var is set; see vercel.json).
 *
 * Server Actions already flush the outbox right after the mutations that create notifications
 * (`queueEmailDispatch()`); this route is the catch-up, mainly for the "project delayed" emails
 * that the database's pg_cron job queues at 00:05 Manila time. Optional `?limit=1..100`
 * (default 100).
 */
import { dispatchPendingEmails } from "@/server/email-dispatch";
import { authorizeCronRequest } from "@/server/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_DEFAULT_LIMIT = 100;

async function handle(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam === null ? CRON_DEFAULT_LIMIT : Number(limitParam);
  const result = await dispatchPendingEmails({ limit });

  return Response.json(
    { ok: result.status !== "error", ...result },
    { status: result.status === "error" ? 500 : 200, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
