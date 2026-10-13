import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import { resetWarnOnce } from "@/lib/env";
import { authorizeCronRequest, bearerToken, cronUnauthorizedResponse, isAuthorizedCron } from "./cron-auth";

const SECRET = "cron-secret-0123456789";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://pms.example.com/api/cron/dispatch-emails", { headers });
}

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetWarnOnce();
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
  vi.unstubAllEnvs();
});

describe("bearerToken", () => {
  it("reads the token of a Bearer header (case-insensitive scheme, extra spaces)", () => {
    expect(bearerToken(`Bearer ${SECRET}`)).toBe(SECRET);
    expect(bearerToken(`bearer   ${SECRET}  `)).toBe(SECRET);
  });

  it("returns null for missing or malformed headers", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer    ")).toBeNull();
    expect(bearerToken(`Basic ${SECRET}`)).toBeNull();
    expect(bearerToken(SECRET)).toBeNull();
  });
});

describe("isAuthorizedCron", () => {
  it("accepts exactly the configured secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects wrong, longer, shorter and prefix tokens", () => {
    expect(isAuthorizedCron("Bearer wrong", SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer anything", null)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
  });
});

describe("authorizeCronRequest", () => {
  it("lets an authorized request through", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(authorizeCronRequest(request(`Bearer ${SECRET}`))).toBeNull();
  });

  it("answers 401 without leaking anything", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const header of [undefined, "Bearer nope", `Token ${SECRET}`]) {
      const response = authorizeCronRequest(request(header));
      expect(response?.status).toBe(401);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(response?.headers.get("www-authenticate")).toContain("Bearer");
      const body = await response!.json();
      expect(body).toEqual({ ok: false, error: "Unauthorized" });
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
  });

  it("refuses every request, warning once, when CRON_SECRET is not set", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(authorizeCronRequest(request("Bearer "))?.status).toBe(401);
    expect(authorizeCronRequest(request("Bearer anything"))?.status).toBe(401);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0][0])).toContain("CRON_SECRET");
  });

  it("builds a fresh 401 response each time", () => {
    expect(cronUnauthorizedResponse()).not.toBe(cronUnauthorizedResponse());
  });
});
