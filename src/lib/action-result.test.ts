import { notFound, redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { fail, failFrom, failWith, fromZodError, isActionFailure, ok, runAction, type ActionResult } from "./action-result";
import { AppException, DEFAULT_MESSAGES, errorFromRpcResult } from "./errors";

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("ok / fail", () => {
  it("wraps data", () => {
    expect(ok({ id: "p1" })).toEqual({ ok: true, data: { id: "p1" } });
    expect(ok()).toEqual({ ok: true, data: undefined });
  });

  it("uses the default message and drops empty field errors", () => {
    expect(fail("FORBIDDEN")).toEqual({ ok: false, error: { code: "FORBIDDEN", message: DEFAULT_MESSAGES.FORBIDDEN } });
    expect(fail("VALIDATION", "Fix the name.", {})).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "Fix the name." },
    });
    expect(fail("VALIDATION", undefined, { name: "Enter a name." })).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: DEFAULT_MESSAGES.VALIDATION, fieldErrors: { name: "Enter a name." } },
    });
  });

  it("narrows failures", () => {
    const result: ActionResult<number> = fail("NOT_FOUND");
    expect(isActionFailure(result)).toBe(true);
    expect(isActionFailure(ok(1))).toBe(false);
  });
});

describe("fromZodError", () => {
  const schema = z
    .object({
      name: z.string().min(3, "Use at least 3 characters."),
      dates: z.object({ start: z.string().min(1, "Pick a start date."), end: z.string().min(1, "Pick an end date.") }),
      tags: z.array(z.string().min(1, "Tags can't be empty.")),
    })
    .refine(() => false, { message: "Something about the whole form." });

  it("joins field paths with dots and keeps the first message per field", () => {
    const parsed = schema.safeParse({ name: "a", dates: { start: "", end: "" }, tags: ["ok", ""] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const result = fromZodError(parsed.error);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: DEFAULT_MESSAGES.VALIDATION,
        fieldErrors: {
          name: "Use at least 3 characters.",
          "dates.start": "Pick a start date.",
          "dates.end": "Pick an end date.",
          "tags.1": "Tags can't be empty.",
          _form: "Something about the whole form.",
        },
      },
    });
  });

  it("uses a form-level issue as the message when it is the only one", () => {
    const parsed = schema.safeParse({ name: "abc", dates: { start: "x", end: "y" }, tags: [] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fromZodError(parsed.error)).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Something about the whole form.",
        fieldErrors: { _form: "Something about the whole form." },
      },
    });
  });

  it("accepts a custom message", () => {
    const parsed = z.object({ email: z.email("Enter a valid email.") }).safeParse({ email: "x" });
    if (parsed.success) throw new Error("expected failure");
    expect(fromZodError(parsed.error, "Check the invitation form.").error.message).toBe("Check the invitation form.");
  });
});

describe("failFrom", () => {
  it("maps RPC errors with the hint as a field error", () => {
    expect(failFrom({ code: "P0001", message: "INVALID_DATES", details: "End date must be on or after 12 Jan 2026.", hint: "end_date" })).toEqual({
      ok: false,
      error: {
        code: "INVALID_DATES",
        message: "End date must be on or after 12 Jan 2026.",
        fieldErrors: { end_date: "End date must be on or after 12 Jan 2026." },
      },
    });
  });

  it("keeps an AppException's field errors", () => {
    expect(failFrom(new AppException("VALIDATION", "Check the dates.", { fieldErrors: { end: "Too early." } }))).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "Check the dates.", fieldErrors: { end: "Too early." } },
    });
  });
});

describe("failWith", () => {
  it("turns an AppError (e.g. from errorFromRpcResult) into a failure with its field", () => {
    const appError = errorFromRpcResult(
      { ok: false, error_code: "CODE_EXPIRED", error_message: "This code has expired. Ask your PM for a new one." },
      { field: "code" },
    );
    expect(appError).not.toBeNull();
    expect(failWith(appError!)).toEqual({
      ok: false,
      error: {
        code: "CODE_EXPIRED",
        message: "This code has expired. Ask your PM for a new one.",
        fieldErrors: { code: "This code has expired. Ask your PM for a new one." },
      },
    });
    expect(failWith({ code: "FORBIDDEN", message: "Nope." })).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Nope." },
    });
  });
});

describe("runAction", () => {
  it("returns the body's result", async () => {
    await expect(runAction(async () => ok(5))).resolves.toEqual({ ok: true, data: 5 });
    await expect(runAction<number>(async () => fail("STALE_VERSION"))).resolves.toEqual({
      ok: false,
      error: { code: "STALE_VERSION", message: DEFAULT_MESSAGES.STALE_VERSION },
    });
  });

  it("converts thrown errors into failures and never throws", async () => {
    const result = await runAction<number>(async () => {
      throw { code: "P0001", message: "ALREADY_MEMBER", details: "Ana is already on this project.", hint: "" };
    });
    expect(result).toEqual({ ok: false, error: { code: "ALREADY_MEMBER", message: "Ana is already on this project." } });

    const unexpected = await runAction<number>(async () => {
      throw new Error('column "secret" does not exist');
    });
    expect(unexpected.ok).toBe(false);
    if (!unexpected.ok) {
      expect(unexpected.error.code).toBe("UNEXPECTED");
      expect(unexpected.error.message).not.toContain("secret");
    }
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("re-throws Next.js redirect() and notFound()", async () => {
    await expect(
      runAction(async () => {
        redirect("/login");
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });

    await expect(
      runAction(async () => {
        notFound();
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
