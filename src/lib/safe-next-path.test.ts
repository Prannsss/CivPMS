import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("keeps same-origin root-relative paths with query and hash", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/projects/abc")).toBe("/projects/abc");
    expect(safeNextPath("/projects/abc/wbs?view=tree#row-3")).toBe("/projects/abc/wbs?view=tree#row-3");
    expect(safeNextPath("/invite/0123abcd")).toBe("/invite/0123abcd");
    expect(safeNextPath("  /onboarding  ")).toBe("/onboarding");
  });

  it("normalises dot segments", () => {
    expect(safeNextPath("/projects/../settings")).toBe("/settings");
  });

  it("uses the fallback for missing values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
    expect(safeNextPath("   ")).toBe("/");
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/projects"],
    ["triple slash", "///evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/path"],
    ["backslash", "/\\evil.com"],
    ["double backslash", "\\\\evil.com"],
    ["backslash inside", "/projects\\..\\..\\evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["javascript scheme mixed case", "JaVaScRiPt:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["no leading slash", "evil.com"],
    ["relative path", "projects/1"],
    ["encoded double slash", "/%2F%2Fevil.com"],
    ["encoded double slash (no leading slash)", "%2F%2Fevil.com"],
    ["encoded backslash", "/%5Cevil.com"],
    ["double-encoded slash", "/%252F%252Fevil.com"],
    ["double-encoded backslash", "/%255Cevil.com"],
    ["encoded javascript", "javascript%3Aalert(1)"],
    ["tab trick", "/\t/evil.com"],
    ["encoded tab trick", "/%09/evil.com"],
    ["newline", "/\n/evil.com"],
    ["encoded newline", "/%0A/evil.com"],
    ["null byte", "/%00/evil.com"],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value, "/fallback")).toBe("/fallback");
  });

  it("rejects auth pages so the sign-in flow cannot loop", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
    expect(safeNextPath("/signup")).toBe("/");
    expect(safeNextPath("/auth/signout")).toBe("/");
    expect(safeNextPath("/LOGIN")).toBe("/");
    // …but not look-alike paths
    expect(safeNextPath("/loginhelp")).toBe("/loginhelp");
  });

  it("rejects very long values", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe("/");
  });

  it("tolerates a literal percent sign in the query", () => {
    expect(safeNextPath("/search?q=100%25")).toBe("/search?q=100%25");
  });
});
