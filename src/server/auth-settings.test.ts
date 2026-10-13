import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

import { getAuthProviders, parseAuthSettings } from "./auth-settings";

let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
});

const settings = {
  external: { google: true, email: true, github: false },
  disable_signup: false,
  mailer_autoconfirm: false,
};

describe("parseAuthSettings", () => {
  it("reads the provider switches", () => {
    expect(parseAuthSettings(settings)).toEqual({
      google: true,
      email: true,
      signupDisabled: false,
      mailerAutoconfirm: false,
    });
    expect(parseAuthSettings({ ...settings, external: { email: true } })?.google).toBe(false);
  });

  it("rejects unexpected shapes", () => {
    expect(parseAuthSettings(null)).toBeNull();
    expect(parseAuthSettings({})).toBeNull();
    expect(parseAuthSettings({ external: [] })).toBeNull();
  });
});

describe("getAuthProviders", () => {
  it("calls the settings endpoint with the publishable key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(settings));
    await expect(getAuthProviders({ fetch: fetchMock })).resolves.toMatchObject({ google: true, email: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/auth/v1/settings");
    expect((init?.headers as Record<string, string>).apikey).toBe("sb_publishable_test");
  });

  it("returns null instead of throwing when Supabase is unreachable or errors", async () => {
    await expect(
      getAuthProviders({
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).resolves.toBeNull();
    await expect(getAuthProviders({ fetch: async () => new Response("nope", { status: 503 }) })).resolves.toBeNull();
    expect(consoleWarn).toHaveBeenCalledTimes(2);
  });
});
