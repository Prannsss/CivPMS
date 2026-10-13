import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import { parsePublicEnv, parseServerEnv, publicEnv, resetWarnOnce, resolveAppUrl, serverEnv, warnOnce } from "./env";

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetWarnOnce();
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
  vi.unstubAllEnvs();
});

describe("publicEnv", () => {
  it("is validated at import and trims the trailing slash", () => {
    expect(publicEnv).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("names each missing variable", () => {
    expect(() => parsePublicEnv({})).toThrowError(/NEXT_PUBLIC_SUPABASE_URL: is missing/);
    expect(() => parsePublicEnv({})).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: is missing/);
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "  ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key" }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL: is missing/);
  });

  it("rejects a malformed URL", () => {
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key" }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL: must be a URL/);
  });
});

describe("serverEnv", () => {
  it("applies defaults and treats blank values as unset", () => {
    expect(parseServerEnv({ SUPABASE_SECRET_KEY: "", BREVO_API_KEY: "  ", BREVO_SANDBOX: "" })).toEqual({
      appUrl: "http://localhost:3000",
      supabaseSecretKey: null,
      brevoApiKey: null,
      brevoSenderEmail: null,
      brevoSenderName: "CivPMS",
      brevoSandbox: false,
      cronSecret: null,
      demoPassword: null,
    });
  });

  it("reads configured values", () => {
    expect(
      parseServerEnv({
        APP_URL: "https://pms.example.com/",
        SUPABASE_SECRET_KEY: "sb_secret_x",
        BREVO_API_KEY: "xkeysib-x",
        BREVO_SENDER_EMAIL: "noreply@example.com",
        BREVO_SENDER_NAME: "CivPMS Alerts",
        BREVO_SANDBOX: "true",
        CRON_SECRET: "s3cret",
        DEMO_PASSWORD: "demo-pass-123",
      }),
    ).toEqual({
      appUrl: "https://pms.example.com",
      supabaseSecretKey: "sb_secret_x",
      brevoApiKey: "xkeysib-x",
      brevoSenderEmail: "noreply@example.com",
      brevoSenderName: "CivPMS Alerts",
      brevoSandbox: true,
      cronSecret: "s3cret",
      demoPassword: "demo-pass-123",
    });
  });

  it("ignores DEMO_PASSWORD on Vercel production with one warning", () => {
    expect(parseServerEnv({ DEMO_PASSWORD: "demo-pass-123", VERCEL_ENV: "production" }).demoPassword).toBeNull();
    expect(parseServerEnv({ DEMO_PASSWORD: "demo-pass-123", VERCEL_ENV: "production" }).demoPassword).toBeNull();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(parseServerEnv({ DEMO_PASSWORD: "demo-pass-123", VERCEL_ENV: "preview" }).demoPassword).toBe("demo-pass-123");
  });

  it("drops an invalid optional value with one warning instead of crashing", () => {
    const env = parseServerEnv({ BREVO_SENDER_EMAIL: "not-an-email", BREVO_API_KEY: "k" });
    expect(env.brevoSenderEmail).toBeNull();
    expect(env.brevoApiKey).toBe("k");
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0][0])).toContain("BREVO_SENDER_EMAIL");
  });

  it("reads process.env at call time", () => {
    vi.stubEnv("CRON_SECRET", "from-env");
    expect(serverEnv().cronSecret).toBe("from-env");
  });
});

describe("resolveAppUrl", () => {
  it("prefers APP_URL", () => {
    expect(resolveAppUrl({ APP_URL: "https://pms.example.com", VERCEL_URL: "x.vercel.app" })).toBe("https://pms.example.com");
  });

  it("falls back to the Vercel production domain in production", () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "civpms.vercel.app",
        VERCEL_URL: "civpms-abc123.vercel.app",
      }),
    ).toBe("https://civpms.vercel.app");
  });

  it("uses the deployment URL for previews", () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "civpms.vercel.app",
        VERCEL_URL: "civpms-git-feature.vercel.app",
      }),
    ).toBe("https://civpms-git-feature.vercel.app");
  });

  it("defaults to localhost", () => {
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });
});

describe("warnOnce", () => {
  it("logs each key once", () => {
    warnOnce("k", "first");
    warnOnce("k", "second");
    warnOnce("other", "third");
    expect(consoleWarn).toHaveBeenCalledTimes(2);
  });
});
