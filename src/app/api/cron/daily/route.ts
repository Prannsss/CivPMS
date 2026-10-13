/**
 * Daily maintenance fallback. The database already runs `private.run_daily_checks()` through
 * pg_cron (00:05 Asia/Manila, job `civpms-daily-checks`); this route runs the service-role
 * `run_daily_checks()` RPC on demand (it is idempotent) and then flushes the email outbox so the
 * "project delayed" emails go out. Protected by `Authorization: Bearer $CRON_SECRET`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingEmails } from "@/server/email-dispatch";
import { authorizeCronRequest } from "@/server/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const noStore = { "Cache-Control": "no-store" };
  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { ok: false, status: "disabled", reason: "SUPABASE_SECRET_KEY is not set" },
      { status: 503, headers: noStore },
    );
  }

  const { data: checks, error } = await admin.rpc("run_daily_checks");
  if (error) {
    console.error("[cron/daily] run_daily_checks failed", error);
    return Response.json({ ok: false, error: "run_daily_checks failed" }, { status: 500, headers: noStore });
  }

  const emails = await dispatchPendingEmails({ client: admin, limit: 100 });
  return Response.json({ ok: true, checks, emails }, { headers: noStore });
}

export const GET = handle;
export const POST = handle;
