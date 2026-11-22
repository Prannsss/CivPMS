import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `) || d === name);
  return found ? found.split(" ").slice(1) : [];
}

describe("contentSecurityPolicy", () => {
  const prod = contentSecurityPolicy({
    supabaseUrl: "https://abc.supabase.co/",
    mediaApiUrl: "https://civpms-media.onrender.com/v1",
  });

  it("allows only this site, the Supabase project and the media service to be contacted", () => {
    expect(directive(prod, "connect-src")).toEqual([
      "'self'",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
      "https://civpms-media.onrender.com",
    ]);
    expect(directive(prod, "img-src")).toContain("https://lh3.googleusercontent.com");
    expect(directive(prod, "img-src")).not.toContain("https:");
  });

  it("blocks framing, plugins and foreign form posts; no eval in production", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("falls back to any Supabase project and adds dev-only allowances", () => {
    const dev = contentSecurityPolicy({ supabaseUrl: "not a url", mediaApiUrl: null, isDev: true });
    expect(directive(dev, "connect-src")).toEqual(["'self'", "https://*.supabase.co", "wss://*.supabase.co", "ws:"]);
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("sends the standard hardening headers", () => {
    const headers = Object.fromEntries(securityHeaders({}).map((h) => [h.key, h.value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
  });
});
