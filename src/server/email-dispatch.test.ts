import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import type { SendEmailResult, sendEmail } from "@/lib/email/brevo";
import { resetWarnOnce } from "@/lib/env";
import type { AdminSupabaseClient } from "@/lib/supabase/admin";
import { dispatchPendingEmails, type ClaimedEmailRow } from "./email-dispatch";

const brevo = {
  config: { brevoApiKey: "xkeysib-test", brevoSenderEmail: "noreply@civpms.test", brevoSenderName: "CivPMS", brevoSandbox: true },
};

function claimedRow(overrides: Partial<ClaimedEmailRow> = {}): ClaimedEmailRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    type: "project_delayed",
    title: "Tower A is delayed",
    body: '"Tower A" passed its end date (10 Oct 2026) and is not completed yet.',
    link: "/projects/11111111-1111-1111-1111-111111111111",
    payload: { project_name: "Tower A", end_date: "2026-10-10" },
    recipient_email: "maria@example.com",
    recipient_name: "Maria Santos",
    attempts: 1,
    ...overrides,
  };
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeClient(rows: ClaimedEmailRow[], options: { claimError?: boolean; completeError?: boolean } = {}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_email_batch") {
        return options.claimError
          ? { data: null, error: { code: "42501", message: "permission denied", details: "", hint: "" } }
          : { data: rows, error: null };
      }
      return options.completeError
        ? { data: null, error: { code: "P0001", message: "VALIDATION", details: "", hint: "" } }
        : { data: null, error: null };
    },
  };
  return { client: client as unknown as AdminSupabaseClient, calls };
}

let consoleError: MockInstance<typeof console.error>;
let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetWarnOnce();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe("dispatchPendingEmails", () => {
  it("is a no-op with a reason when the secret key is missing", async () => {
    await expect(dispatchPendingEmails({ client: null })).resolves.toEqual({
      status: "disabled",
      reason: "SUPABASE_SECRET_KEY is not set",
      claimed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      completeErrors: 0,
    });
  });

  it("leaves rows pending (claims nothing) when Brevo is not configured", async () => {
    const { client, calls } = fakeClient([claimedRow()]);
    const result = await dispatchPendingEmails({
      client,
      sendOptions: { config: { ...brevo.config, brevoApiKey: null } },
    });
    expect(result).toMatchObject({ status: "disabled", reason: "BREVO_API_KEY is not set", claimed: 0 });
    expect(calls).toEqual([]);
  });

  it("claims, renders, sends and completes each row", async () => {
    const rows = [
      claimedRow(),
      claimedRow({ id: "00000000-0000-0000-0000-000000000002", recipient_email: "" }),
      claimedRow({ id: "00000000-0000-0000-0000-000000000003", type: "project_budget_exceeded" }),
      claimedRow({ id: "00000000-0000-0000-0000-000000000004" }),
    ];
    const { client, calls } = fakeClient(rows);
    const results: Record<string, SendEmailResult> = {
      "maria@example.com": { ok: true, messageId: "m-1" },
    };
    let sendCount = 0;
    const send = vi.fn<typeof sendEmail>(async (message) => {
      sendCount += 1;
      // the 3rd send (row 4) fails at Brevo
      if (sendCount === 3) return { ok: false, error: "Brevo responded 400" };
      expect(message.html).toContain("<!DOCTYPE html>");
      expect(message.subject).not.toMatch(/[\r\n]/);
      return results[message.to.email] ?? { ok: false, error: "unexpected" };
    });

    const result = await dispatchPendingEmails({
      client,
      send,
      sendOptions: brevo,
      appUrl: "https://pms.example.com",
      limit: 500,
      concurrency: 1,
    });

    expect(result).toEqual({ status: "ok", claimed: 4, sent: 2, failed: 1, skipped: 1, completeErrors: 0 });
    expect(calls[0]).toEqual({ fn: "claim_email_batch", args: { p_limit: 100 } });
    const completions = calls.slice(1).map((c) => [c.args.p_id, c.args.p_status]);
    expect(completions).toEqual([
      ["00000000-0000-0000-0000-000000000001", "sent"],
      ["00000000-0000-0000-0000-000000000002", "skipped"],
      ["00000000-0000-0000-0000-000000000003", "sent"],
      ["00000000-0000-0000-0000-000000000004", "failed"],
    ]);
    expect(send.mock.calls[0][0].to).toEqual({ email: "maria@example.com", name: "Maria Santos" });
    expect(send.mock.calls[0][0].text).toContain("https://pms.example.com/projects/11111111-1111-1111-1111-111111111111");
  });

  it("marks rows skipped when Brevo skips them", async () => {
    const { client, calls } = fakeClient([claimedRow()]);
    const send = vi.fn<typeof sendEmail>(async () => ({ ok: false, skipped: true, error: "The recipient has no email address" }));
    const result = await dispatchPendingEmails({ client, send, sendOptions: brevo, appUrl: "https://pms.example.com" });
    expect(result).toMatchObject({ status: "ok", skipped: 1 });
    expect(calls[1].args).toMatchObject({ p_status: "skipped", p_error: "The recipient has no email address" });
  });

  it("reports a claim failure without throwing", async () => {
    const { client } = fakeClient([], { claimError: true });
    const result = await dispatchPendingEmails({ client, sendOptions: brevo });
    expect(result).toMatchObject({ status: "error", error: "Could not claim emails", claimed: 0 });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("counts complete_email failures and keeps going", async () => {
    const { client } = fakeClient([claimedRow(), claimedRow({ id: "00000000-0000-0000-0000-000000000002" })], {
      completeError: true,
    });
    const send = vi.fn<typeof sendEmail>(async () => ({ ok: true, messageId: "m" }));
    const result = await dispatchPendingEmails({ client, send, sendOptions: brevo, appUrl: "https://pms.example.com" });
    expect(result).toMatchObject({ status: "ok", sent: 2, completeErrors: 2 });
  });

  it("returns an empty ok result when nothing is pending", async () => {
    const { client, calls } = fakeClient([]);
    await expect(dispatchPendingEmails({ client, sendOptions: brevo })).resolves.toMatchObject({ status: "ok", claimed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ p_limit: 25 });
  });
});
