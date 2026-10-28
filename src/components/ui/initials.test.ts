import { describe, expect, it } from "vitest";
import { getInitials, getProjectInitials, hashToIndex } from "./initials";

describe("getInitials", () => {
  it.each([
    ["Juan Dela Cruz", "JC"],
    ["maria@site.ph", "MA"],
    ["Maria", "MA"],
    ["  ", "?"],
    ["[QA] Ivan Reyes", "IR"],
    ["[F4] Olivia Ocampo", "OO"],
    ["(Demo) Builders", "BU"],
    ["[QA] 1016072430", "10"],
    ["[F4]", "F4"],
    ["Élise Ñunez", "ÉÑ"],
    ["- & -", "?"],
  ])("%j → %s", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});

describe("getProjectInitials", () => {
  it.each([
    ["Davao Drainage Rehabilitation, Phase 2", "DD"],
    ["[QA] 1016072430 Mactan Bridge Retrofit", "MB"],
    ["[F4] Metro Drainage Upgrade", "MD"],
    ["Warehouse", "WA"],
    ["2027", "20"],
    ["[QA]", "QA"],
    ["", "?"],
  ])("%j → %s", (name, expected) => {
    expect(getProjectInitials(name)).toBe(expected);
  });
});

describe("hashToIndex", () => {
  it("is stable and inside the range", () => {
    expect(hashToIndex("Juan", 6)).toBe(hashToIndex("Juan", 6));
    expect(hashToIndex("Juan", 6)).toBeGreaterThanOrEqual(0);
    expect(hashToIndex("Juan", 6)).toBeLessThan(6);
  });
});
