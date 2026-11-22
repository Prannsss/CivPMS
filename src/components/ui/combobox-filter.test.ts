import { describe, expect, it } from "vitest";
import { matchesQuery, normalizeForSearch } from "./combobox-filter";

describe("normalizeForSearch", () => {
  it("lower-cases, trims and strips accents", () => {
    expect(normalizeForSearch("  José Ñiño ")).toBe("jose nino");
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty or blank query", () => {
    expect(matchesQuery("Panay Bridge Retrofit", "")).toBe(true);
    expect(matchesQuery("Panay Bridge Retrofit", "   ")).toBe(true);
  });

  it("matches every word in any order, ignoring case and accents", () => {
    expect(matchesQuery("Panay Bridge Retrofit", "bridge pan")).toBe(true);
    expect(matchesQuery("José Dela Cruz", "jose CRUZ")).toBe(true);
  });

  it("fails when any word is missing", () => {
    expect(matchesQuery("Panay Bridge Retrofit", "bridge road")).toBe(false);
  });

  it("matches inside words (partial typing)", () => {
    expect(matchesQuery("[F3] Warehouse", "wareh")).toBe(true);
    expect(matchesQuery("[F3] Warehouse", "[f3]")).toBe(true);
  });
});
