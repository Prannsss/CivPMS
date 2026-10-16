import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import { resetWarnOnce } from "@/lib/env";
import { BREVO_SEND_URL, brevoDisabledReason, isReservedEmailDomain, sendEmail, type EmailMessage } from "./brevo";

const config = {
  brevoApiKey: "xkeysib-test-key",
  brevoSenderEmail: "noreply@civpms.test",
  brevoSenderName: "CivPMS",
  brevoSandbox: false,
};

const message: EmailMessage = {
  to: { email: "ana@example.com", name: "Ana Cruz" },
  subject: "Hello\r\nBcc: attacker@example.com",
  html: "<p>Hello</p>",
  text: "Hello",
  tags: ["invitation"],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetWarnOnce();
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("posts to Brevo with the api-key header and JSON body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(201, { messageId: "<abc@smtp-relay.brevo.com>" }));
    const result = await sendEmail(message, { config, fetch: fetchMock });

    expect(result).toEqual({ ok: true, messageId: "<abc@smtp-relay.brevo.com>" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_SEND_URL);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("xkeysib-test-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["X-Sib-Sandbox"]).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      sender: { email: "noreply@civpms.test", name: "CivPMS" },
      to: [{ email: "ana@example.com", name: "Ana Cruz" }],
      subject: "Hello Bcc: attacker@example.com",
      htmlContent: "<p>Hello</p>",
      textContent: "Hello",
      tags: ["invitation"],
    });
  });

  it("uses the global fetch by default", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(201, { messageId: "m-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail(message, { config })).resolves.toEqual({ ok: true, messageId: "m-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adds the sandbox header when BREVO_SANDBOX is on", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(201, {}));
    const result = await sendEmail(message, { config: { ...config, brevoSandbox: true }, fetch: fetchMock });

    expect(result).toEqual({ ok: true, messageId: "sandbox" });
    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["X-Sib-Sandbox"]).toBe("drop");
    expect(JSON.parse(String(init?.body)).headers).toEqual({ "X-Sib-Sandbox": "drop" });
  });

  it("skips (without calling Brevo) when the API key is missing, warning once", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const noKey = { ...config, brevoApiKey: null };
    const first = await sendEmail(message, { config: noKey, fetch: fetchMock });
    const second = await sendEmail(message, { config: noKey, fetch: fetchMock });

    expect(first).toEqual({ ok: false, skipped: true, error: "BREVO_API_KEY is not set" });
    expect(second).toEqual(first);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it("skips when the sender is missing", async () => {
    expect(brevoDisabledReason({ ...config, brevoSenderEmail: null })).toBe("BREVO_SENDER_EMAIL is not set");
    const result = await sendEmail(message, { config: { ...config, brevoSenderEmail: null }, fetch: vi.fn<typeof fetch>() });
    expect(result).toMatchObject({ ok: false, skipped: true });
  });

  it("reports Brevo errors without throwing or leaking the key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(400, { code: "invalid_parameter", message: "email is not valid in to" }),
    );
    const result = await sendEmail(message, { config, fetch: fetchMock });
    expect(result).toEqual({ ok: false, error: "Brevo responded 400 (invalid_parameter: email is not valid in to)" });
    expect(JSON.stringify(result)).not.toContain("xkeysib");
  });

  it("handles non-JSON error bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("Bad gateway", { status: 502 }));
    await expect(sendEmail(message, { config, fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: "Brevo responded 502",
    });
  });

  it("turns network failures into a result", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(sendEmail(message, { config, fetch: fetchMock })).resolves.toEqual({
      ok: false,
      error: "Could not reach Brevo: fetch failed",
    });
  });

  it("times out instead of hanging", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await sendEmail(message, { config, fetch: fetchMock, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, error: "Brevo did not respond within 20 ms" });
  });

  it("skips recipients without an address", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await sendEmail({ ...message, to: { email: "  " } }, { config, fetch: fetchMock });
    expect(result).toEqual({ ok: false, skipped: true, error: "The recipient has no email address" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips demo and test recipients on reserved TLDs without calling Brevo", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await sendEmail({ ...message, to: { email: "owner@civpms.test", name: "Juan" } }, { config, fetch: fetchMock });
    expect(result).toEqual({ ok: false, skipped: true, error: "Reserved test domain: email not sent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isReservedEmailDomain", () => {
  it.each(["owner@civpms.test", "PM@CIVPMS.TEST", "a@b.example", "x@site.invalid", "dev@localhost", "z@mail.test."])(
    "treats %s as undeliverable",
    (email) => {
      expect(isReservedEmailDomain(email)).toBe(true);
    },
  );

  it.each(["ana@example.com", "juan@gmail.com", "ops@testing.ph", "qa@test.com", "test@company.co"])(
    "keeps %s deliverable",
    (email) => {
      expect(isReservedEmailDomain(email)).toBe(false);
    },
  );
});
