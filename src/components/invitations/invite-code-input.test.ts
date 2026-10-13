import { describe, expect, it } from "vitest";
import { normalizeInviteCode } from "@/lib/domain";
import { formatInviteCodeInput } from "./invite-code-input";

describe("formatInviteCodeInput", () => {
  it.each([
    ["", ""],
    ["7k", "7K"],
    ["7kq2", "7KQ2"],
    ["7kq2m", "7KQ2-M"],
    ["7kq2 m9xa", "7KQ2-M9XA"],
    ["7KQ2–M9XA", "7KQ2-M9XA"],
    ["7kq2-m9xa-extra", "7KQ2-M9XA"],
    ["oil1", "0111"],
  ])("formats %j as %j", (input, expected) => {
    expect(formatInviteCodeInput(input)).toBe(expected);
  });

  it("agrees with the domain normalizer for complete codes", () => {
    for (const input of [" 7kq2 m9xa ", "oiLl-0000", "abcd_efgh", "ZZZZ zzzz", "1234-5678"]) {
      const normalized = normalizeInviteCode(input);
      expect(normalized).not.toBeNull();
      expect(formatInviteCodeInput(input)).toBe(normalized);
    }
  });

  it("keeps letters that are never valid so the field can explain the problem", () => {
    expect(formatInviteCodeInput("uuuu-uuuu")).toBe("UUUU-UUUU");
    expect(normalizeInviteCode("UUUU-UUUU")).toBeNull();
  });
});
