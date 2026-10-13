import "server-only";

/**
 * Brevo transactional email over the REST API (plain fetch, no SDK).
 *
 * `sendEmail()` never throws: it resolves to `{ ok: true, messageId }`, or `{ ok: false, error }`
 * with `skipped: true` when email is not configured (no API key or sender), so callers can mark
 * the outbox row as skipped instead of retrying. Missing configuration is logged once.
 *
 * With BREVO_SANDBOX=true, Brevo validates the request but drops the email (`X-Sib-Sandbox: drop`).
 */
import { serverEnv, warnOnce, type ServerEnv } from "@/lib/env";

export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
export const BREVO_TIMEOUT_MS = 10_000;

export interface EmailAddress {
  email: string;
  name?: string | null;
}

export interface EmailMessage {
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
  /** Brevo tags for filtering in its logs, e.g. the notification type. */
  tags?: string[];
  replyTo?: EmailAddress;
}

export type SendEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; skipped?: boolean; error: string };

type BrevoConfig = Pick<ServerEnv, "brevoApiKey" | "brevoSenderEmail" | "brevoSenderName" | "brevoSandbox">;

export interface SendEmailOptions {
  /** Defaults to serverEnv(); tests pass a config directly. */
  config?: BrevoConfig;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Why email is disabled, or null when Brevo is configured. */
export function brevoDisabledReason(config: BrevoConfig = serverEnv()): string | null {
  if (!config.brevoApiKey) return "BREVO_API_KEY is not set";
  if (!config.brevoSenderEmail) return "BREVO_SENDER_EMAIL is not set";
  return null;
}

function cleanName(name: string | null | undefined): string | undefined {
  const trimmed = name?.replace(/[\r\n]+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function address(value: EmailAddress): { email: string; name?: string } {
  const name = cleanName(value.name);
  return name ? { email: value.email.trim(), name } : { email: value.email.trim() };
}

async function readBrevoError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : "";
      const message = typeof record.message === "string" ? record.message : "";
      detail = [code, message].filter(Boolean).join(": ");
    }
  } catch {
    // Body was not JSON; the status is enough.
  }
  return `Brevo responded ${response.status}${detail ? ` (${detail})` : ""}`.slice(0, 500);
}

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      const limit = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`;
      return `Brevo did not respond within ${limit}`;
    }
    return `Could not reach Brevo: ${error.message}`.slice(0, 500);
  }
  return "Could not reach Brevo";
}

export async function sendEmail(message: EmailMessage, options: SendEmailOptions = {}): Promise<SendEmailResult> {
  try {
    const config = options.config ?? serverEnv();
    const disabled = brevoDisabledReason(config);
    if (disabled || !config.brevoApiKey || !config.brevoSenderEmail) {
      const reason = disabled ?? "Email is not configured";
      warnOnce("brevo:disabled", `${reason}: emails are skipped. See docs/SETUP.md (Brevo).`);
      return { ok: false, skipped: true, error: reason };
    }

    const recipient = message.to.email?.trim();
    if (!recipient) {
      return { ok: false, skipped: true, error: "The recipient has no email address" };
    }

    const timeoutMs = options.timeoutMs ?? BREVO_TIMEOUT_MS;
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.brevoApiKey,
    };
    const body: Record<string, unknown> = {
      sender: { email: config.brevoSenderEmail, name: config.brevoSenderName },
      to: [address(message.to)],
      subject: message.subject.replace(/[\r\n]+/g, " ").trim(),
      htmlContent: message.html,
      textContent: message.text,
    };
    if (message.replyTo) body.replyTo = address(message.replyTo);
    if (message.tags && message.tags.length > 0) body.tags = message.tags.slice(0, 10);
    if (config.brevoSandbox) {
      // Brevo reads the sandbox flag from the message headers; the HTTP header is harmless extra.
      headers["X-Sib-Sandbox"] = "drop";
      body.headers = { "X-Sib-Sandbox": "drop" };
    }

    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(BREVO_SEND_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, error: await readBrevoError(response) };
    }

    let messageId = "";
    try {
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && typeof (data as { messageId?: unknown }).messageId === "string") {
        messageId = (data as { messageId: string }).messageId;
      }
    } catch {
      // 201 without a JSON body (sandbox mode can do this): still a success.
    }
    return { ok: true, messageId: messageId || (config.brevoSandbox ? "sandbox" : "unknown") };
  } catch (error) {
    return { ok: false, error: describeFailure(error, options.timeoutMs ?? BREVO_TIMEOUT_MS) };
  }
}
