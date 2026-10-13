import "server-only";

/**
 * Notification email outbox worker (docs/DATABASE.md "Notifications and email").
 *
 * claim_email_batch(n) → render → Brevo → complete_email(id, sent | failed | skipped).
 * `failed` rows go back to pending until 5 attempts. Rows stuck in `sending` for 15 minutes are
 * re-claimed, so a crash mid-batch only delays emails.
 *
 * Triggers:
 * - `queueEmailDispatch()` from Server Actions that create notifications (runs after the response).
 * - `/api/cron/dispatch-emails` and `/api/cron/daily` (Bearer CRON_SECRET).
 */
import { after } from "next/server";
import { brevoDisabledReason, sendEmail, type SendEmailOptions } from "@/lib/email/brevo";
import { renderNotificationEmail, type RenderedEmail } from "@/lib/email/templates";
import { serverEnv, warnOnce } from "@/lib/env";
import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type ClaimedEmailRow = Database["public"]["Functions"]["claim_email_batch"]["Returns"][number];

export interface DispatchCounts {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** complete_email calls that themselves failed (the row is re-claimed after 15 minutes). */
  completeErrors: number;
}

export type DispatchResult =
  | ({ status: "ok" } & DispatchCounts)
  | ({ status: "disabled"; reason: string } & DispatchCounts)
  | ({ status: "error"; error: string } & DispatchCounts);

export interface DispatchOptions {
  limit?: number;
  /** Parallel sends (Brevo handles bursts well; keep it modest). */
  concurrency?: number;
  /** Test seams. */
  client?: AdminSupabaseClient | null;
  send?: typeof sendEmail;
  sendOptions?: SendEmailOptions;
  appUrl?: string;
}

const EMPTY_COUNTS: DispatchCounts = { claimed: 0, sent: 0, failed: 0, skipped: 0, completeErrors: 0 };

export const DEFAULT_DISPATCH_LIMIT = 25;
const MAX_DISPATCH_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_DISPATCH_LIMIT;
  return Math.min(MAX_DISPATCH_LIMIT, Math.max(1, Math.floor(limit)));
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * Sends up to `limit` pending notification emails. Never throws. Returns `disabled` (with the
 * reason) when the secret key or Brevo is not configured; pending rows then stay pending.
 */
export async function dispatchPendingEmails(options: DispatchOptions = {}): Promise<DispatchResult> {
  const counts: DispatchCounts = { ...EMPTY_COUNTS };
  try {
    const client = options.client === undefined ? createAdminClient() : options.client;
    if (!client) {
      return { status: "disabled", reason: "SUPABASE_SECRET_KEY is not set", ...counts };
    }
    const sendOptions = options.sendOptions ?? {};
    const disabled = brevoDisabledReason(sendOptions.config ?? serverEnv());
    if (disabled && !options.send) {
      warnOnce("dispatch:brevo-disabled", `${disabled}: notification emails stay queued until Brevo is configured.`);
      return { status: "disabled", reason: disabled, ...counts };
    }

    const { data, error } = await client.rpc("claim_email_batch", { p_limit: clampLimit(options.limit) });
    if (error) {
      console.error("[email-dispatch] claim_email_batch failed", error);
      return { status: "error", error: "Could not claim emails", ...counts };
    }
    const rows = data ?? [];
    counts.claimed = rows.length;
    if (rows.length === 0) return { status: "ok", ...counts };

    const send = options.send ?? sendEmail;
    const appUrl = options.appUrl ?? serverEnv().appUrl;

    const complete = async (id: string, status: "sent" | "failed" | "skipped", reason?: string) => {
      const { error: completeError } = await client.rpc("complete_email", {
        p_id: id,
        p_status: status,
        p_error: reason,
      });
      if (completeError) {
        counts.completeErrors += 1;
        console.error(`[email-dispatch] complete_email(${id}, ${status}) failed`, completeError);
      }
    };

    await runPool(rows, Math.max(1, options.concurrency ?? 5), async (row) => {
      if (!row.recipient_email) {
        counts.skipped += 1;
        await complete(row.id, "skipped", "The recipient has no email address");
        return;
      }
      let rendered: RenderedEmail;
      try {
        rendered = renderNotificationEmail(row, { appUrl });
      } catch (renderError) {
        counts.failed += 1;
        console.error(`[email-dispatch] could not render ${row.type} (${row.id})`, renderError);
        await complete(row.id, "failed", "Template rendering failed");
        return;
      }
      const result = await send(
        {
          to: { email: row.recipient_email, name: row.recipient_name },
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: rendered.tags,
        },
        sendOptions,
      );
      if (result.ok) {
        counts.sent += 1;
        await complete(row.id, "sent");
      } else if (result.skipped) {
        counts.skipped += 1;
        await complete(row.id, "skipped", result.error);
      } else {
        counts.failed += 1;
        await complete(row.id, "failed", result.error);
      }
    });

    return { status: "ok", ...counts };
  } catch (error) {
    console.error("[email-dispatch] unexpected failure", error);
    return { status: "error", error: "Unexpected failure while sending emails", ...counts };
  }
}

/**
 * Schedules `dispatchPendingEmails()` to run after the current response is sent. Call it from a
 * Server Action or Route Handler right after a mutation that creates notifications.
 */
export function queueEmailDispatch(options: Pick<DispatchOptions, "limit"> = {}): void {
  try {
    after(async () => {
      const result = await dispatchPendingEmails(options);
      if (result.status === "error") {
        console.error("[email-dispatch] background dispatch failed", result.error);
      }
    });
  } catch (error) {
    // Outside a request scope (e.g. a script): nothing to hook into; the cron route catches up.
    console.warn("[email-dispatch] could not schedule a background dispatch", error);
  }
}
