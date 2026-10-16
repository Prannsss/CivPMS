import { describe, expect, it } from "vitest";
import { CalendarError } from "./calendar";
import { DOMAIN_ERROR_CODES, DomainError, isDomainError } from "./errors";

describe("DomainError", () => {
  it("carries a code and defaults the message to it", () => {
    const e = new DomainError("INVALID_DATE");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("INVALID_DATE");
    expect(e.message).toBe("INVALID_DATE");
    expect(e.name).toBe("DomainError");
    expect(new DomainError("INVALID_NUMBER", "Bad").message).toBe("Bad");
  });

  it("isDomainError narrows, optionally by code", () => {
    const e = new CalendarError("NO_WORKING_DAYS");
    expect(isDomainError(e)).toBe(true);
    expect(isDomainError(e, "NO_WORKING_DAYS")).toBe(true);
    expect(isDomainError(e, "INVALID_DATE")).toBe(false);
    expect(isDomainError(new Error("x"))).toBe(false);
    expect(isDomainError("NO_WORKING_DAYS")).toBe(false);
  });

  it("lists every code", () => {
    expect(DOMAIN_ERROR_CODES).toContain("NO_WORKING_DAYS");
  });
});
