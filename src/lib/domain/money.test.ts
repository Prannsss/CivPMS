import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { hasAtMostDecimals, MAX_MONEY, parseNumericInput, roundMoney, roundTo, sumMoney, toCents } from "./money";

describe("roundTo / roundMoney", () => {
  it("avoids the 1.005 binary-float bug", () => {
    expect(Math.round(1.005 * 100) / 100).toBe(1); // the bug we avoid
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1234567.885)).toBe(1234567.89);
  });

  it("rounds half away from zero for negatives", () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-0.001)).toBe(0);
    expect(Object.is(roundMoney(-0.001), -0)).toBe(false);
  });

  it("handles exponent notation and other precisions", () => {
    expect(roundTo(1e-7, 2)).toBe(0);
    expect(roundTo(1.5e21, 2)).toBe(1.5e21);
    expect(roundTo(12.3456, 0)).toBe(12);
    expect(roundTo(12.5, 0)).toBe(13);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(MAX_MONEY, 2)).toBe(MAX_MONEY);
  });

  it("rejects bad input", () => {
    expect(() => roundTo(Number.NaN, 2)).toThrow(DomainError);
    expect(() => roundTo(Number.POSITIVE_INFINITY, 2)).toThrow(DomainError);
    expect(() => roundTo(1, -1)).toThrow(DomainError);
    expect(() => roundTo(1, 1.5)).toThrow(DomainError);
  });
});

describe("toCents / sumMoney", () => {
  it("converts and sums without drift", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1)).toBe(10);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([100.1, null, undefined, 200.2, Number.NaN])).toBe(300.3);
    expect(sumMoney([])).toBe(0);
  });
});

describe("hasAtMostDecimals", () => {
  it("checks decimal places tolerating float noise", () => {
    expect(hasAtMostDecimals(1250000.5, 2)).toBe(true);
    expect(hasAtMostDecimals(1.25, 2)).toBe(true);
    expect(hasAtMostDecimals(0.1 + 0.2, 2)).toBe(true);
    expect(hasAtMostDecimals(1.255, 2)).toBe(false);
    expect(hasAtMostDecimals(7.5, 0)).toBe(false);
    expect(hasAtMostDecimals(Number.NaN, 2)).toBe(false);
  });
});

describe("parseNumericInput", () => {
  it("parses form strings", () => {
    expect(parseNumericInput("1,250,000.50")).toBe(1250000.5);
    expect(parseNumericInput(" 12 ")).toBe(12);
    expect(parseNumericInput("₱ 1,000")).toBe(1000);
    expect(parseNumericInput("PHP 1,000.25")).toBe(1000.25);
    expect(parseNumericInput("-5")).toBe(-5);
    expect(parseNumericInput(".5")).toBe(0.5);
    expect(parseNumericInput("5.")).toBe(5);
  });

  it("distinguishes missing (null) from invalid (NaN)", () => {
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("   ")).toBeNull();
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput(undefined)).toBeNull();
    expect(parseNumericInput("abc")).toBeNaN();
    expect(parseNumericInput("1.2.3")).toBeNaN();
    expect(parseNumericInput("1e5")).toBeNaN();
    expect(parseNumericInput(true)).toBeNaN();
  });

  it("passes numbers through", () => {
    expect(parseNumericInput(42)).toBe(42);
    expect(parseNumericInput(Number.NaN)).toBeNaN();
  });
});
