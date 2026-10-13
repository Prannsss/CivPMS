import { describe, expect, it } from "vitest";
import {
  isApiPath,
  isAuthPage,
  isCronPath,
  isPublicPath,
  isStaticAssetPath,
  loginErrorPath,
  loginRedirectPath,
  matchesPath,
} from "./auth-routes";

const dev = { isProduction: false };
const prod = { isProduction: true };

describe("auth routes", () => {
  it("matches a base path and its children only", () => {
    expect(matchesPath("/invite", "/invite")).toBe(true);
    expect(matchesPath("/invite/abc", "/invite")).toBe(true);
    expect(matchesPath("/invites", "/invite")).toBe(false);
  });

  it.each(["/login", "/signup", "/forgot-password", "/reset-password", "/check-email", "/auth/callback", "/auth/confirm", "/auth/signout", "/invite/abc123", "/api/cron/daily"])(
    "treats %s as public",
    (path) => {
      expect(isPublicPath(path, prod)).toBe(true);
    },
  );

  it.each(["/", "/onboarding", "/projects/1", "/profile", "/settings", "/notifications", "/api/other", "/loginx"])(
    "protects %s",
    (path) => {
      expect(isPublicPath(path, prod)).toBe(false);
    },
  );

  it("opens /dev/* outside production only", () => {
    expect(isPublicPath("/dev/styleguide", dev)).toBe(true);
    expect(isPublicPath("/dev/styleguide", prod)).toBe(false);
  });

  it("recognises static assets", () => {
    expect(isStaticAssetPath("/brand/logo-mark.png")).toBe(true);
    expect(isStaticAssetPath("/icons/icon-192.png")).toBe(true);
    expect(isStaticAssetPath("/favicon.ico")).toBe(true);
    expect(isStaticAssetPath("/_next/static/chunk.js")).toBe(true);
    expect(isStaticAssetPath("/photo.webp")).toBe(true);
    expect(isStaticAssetPath("/projects/1")).toBe(false);
  });

  it("classifies auth pages, cron and api paths", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/signup")).toBe(true);
    expect(isAuthPage("/forgot-password")).toBe(false);
    expect(isCronPath("/api/cron/dispatch-emails")).toBe(true);
    expect(isCronPath("/api/cronjob")).toBe(false);
    expect(isApiPath("/api/anything")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
  });

  it("builds login redirects with an encoded next", () => {
    expect(loginRedirectPath("/")).toBe("/login?next=%2F");
    expect(loginRedirectPath("/projects/1", "?tab=wbs&x=1")).toBe("/login?next=%2Fprojects%2F1%3Ftab%3Dwbs%26x%3D1");
    expect(loginErrorPath("link_invalid")).toBe("/login?error=link_invalid");
  });
});
