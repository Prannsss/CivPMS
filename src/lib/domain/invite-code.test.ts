import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  INVITE_CODE_ALPHABET,
  inviteCodeFromBytes,
  isInviteCodeFormat,
  normalizeInviteCode,
} from "./invite-code";

describe("INVITE_CODE_ALPHABET", () => {
  it("is Crockford base32 without I, L, O, U", () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(32);
    for (const ch of "ILOU") expect(INVITE_CODE_ALPHABET).not.toContain(ch);
  });
});

describe("normalizeInviteCode", () => {
  it.each([
    ["7KQ2-M9XA", "7KQ2-M9XA"],
    ["7kq2m9xa", "7KQ2-M9XA"],
    ["  7kq2 m9xa ", "7KQ2-M9XA"],
    ["7-K-Q-2-M-9-X-A", "7KQ2-M9XA"],
    ["7KQ2–M9XA", "7KQ2-M9XA"], // en dash pasted from a document
    ["7KQ2_M9XA", "7KQ2-M9XA"],
    ["OOOO-OOOO", "0000-0000"],
    ["oiLl-0000", "0111-0000"],
    ["ABCD\tEFGH", "ABCD-EFGH"],
  ])("%j → %s", (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "7KQ2-M9X", // too short
    "7KQ2-M9XAB", // too long
    "UUUU-UUUU", // U is not in the alphabet
    "7KQ2-M9X!",
    "7KQ2.M9XA",
  ])("rejects %j", (input) => {
    expect(normalizeInviteCode(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode(undefined)).toBeNull();
  });
});

describe("isInviteCodeFormat", () => {
  it("accepts only canonical codes", () => {
    expect(isInviteCodeFormat("7KQ2-M9XA")).toBe(true);
    expect(isInviteCodeFormat("7kq2-m9xa")).toBe(false);
    expect(isInviteCodeFormat("7KQ2M9XA")).toBe(false);
    expect(isInviteCodeFormat("OKQ2-M9XA")).toBe(false);
    expect(isInviteCodeFormat(12345678)).toBe(false);
  });
});

describe("inviteCodeFromBytes", () => {
  it("encodes 40 bits into a canonical code", () => {
    expect(inviteCodeFromBytes(new Uint8Array([0, 0, 0, 0, 0]))).toBe("0000-0000");
    expect(inviteCodeFromBytes(new Uint8Array([255, 255, 255, 255, 255]))).toBe("ZZZZ-ZZZZ");
    expect(inviteCodeFromBytes(new Uint8Array([0, 0, 0, 0, 31]))).toBe("0000-000Z");
    expect(inviteCodeFromBytes(new Uint8Array([0, 0, 0, 0, 32]))).toBe("0000-0010");
  });

  it("uses only the first 5 bytes and always produces a valid code", () => {
    const code = inviteCodeFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe(inviteCodeFromBytes(new Uint8Array([1, 2, 3, 4, 5])));
    for (let i = 0; i < 50; i += 1) {
      const bytes = new Uint8Array([i * 5, i * 7, 255 - i, i * 3, i * 11].map((n) => n % 256));
      const c = inviteCodeFromBytes(bytes);
      expect(isInviteCodeFormat(c)).toBe(true);
      expect(normalizeInviteCode(c)).toBe(c);
    }
  });

  it("needs at least 5 bytes", () => {
    expect(() => inviteCodeFromBytes(new Uint8Array(4))).toThrow(DomainError);
  });
});
