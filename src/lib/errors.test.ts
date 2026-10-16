import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import {
  AUTH_REDIRECT_ERROR_CODES,
  AppException,
  DB_ERROR_CODES,
  DEFAULT_MESSAGES,
  ERROR_CODES,
  appErrorFieldErrors,
  authRedirectCodeFor,
  authRedirectError,
  authRedirectParam,
  errorFromRpcResult,
  isErrorCode,
  isProviderDisabledMessage,
  toAppError,
} from "./errors";

function pgError(code: string, message: string, details = "", hint = "") {
  return { code, message, details, hint };
}

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("DEFAULT_MESSAGES", () => {
  it("has a plain-language sentence for every code", () => {
    for (const code of ERROR_CODES) {
      const message = DEFAULT_MESSAGES[code];
      expect(message.length, code).toBeGreaterThan(10);
      expect(message.trim(), code).toMatch(/[.!?]$/);
    }
  });

  it("includes every database error code from docs/DATABASE.md", () => {
    for (const code of [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION",
      "STALE_VERSION",
      "ALREADY_IN_COMPANY",
      "COMPANY_NAME_TAKEN",
      "NO_WORKING_DAYS",
      "ROLE_NOT_ALLOWED",
      "ALREADY_MEMBER",
      "CANNOT_REMOVE_OWNER",
      "CANNOT_CHANGE_OWNER_ROLE",
      "CANNOT_INVITE_SELF",
      "INVITEE_IN_OTHER_COMPANY",
      "INVITE_EMAIL_MISMATCH",
      "INVITE_EXPIRED",
      "INVITE_NOT_PENDING",
      "RATE_LIMITED",
      "INVALID_CODE",
      "CODE_EXPIRED",
      "CODE_REVOKED",
      "CODE_EXHAUSTED",
      "INVALID_DATES",
      "INVALID_BUDGET",
      "PROJECT_NAME_TAKEN",
      "INVALID_TRANSITION",
      "REASON_REQUIRED",
      "PROJECT_HAS_INCOMPLETE_ACTIVITIES",
      "NOT_CLOSED",
      "RESTORE_EXPIRED",
      "PARENT_NOT_FOUND",
      "PARENT_DELETED",
      "MAX_DEPTH_EXCEEDED",
      "INVALID_MOVE",
      "LOG_IMMUTABLE",
    ]) {
      expect(DB_ERROR_CODES).toContain(code);
    }
  });

  it("guards error codes", () => {
    expect(isErrorCode("STALE_VERSION")).toBe(true);
    expect(isErrorCode("NETWORK")).toBe(true);
    expect(isErrorCode("nope")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe("toAppError: database errors", () => {
  it("maps P0001 to the code, the detail to the message and the hint to the field", () => {
    const error = toAppError(
      pgError("P0001", "PROJECT_NAME_TAKEN", "Your company already has a project named \"Tower A\".", "name"),
    );
    expect(error).toEqual({
      code: "PROJECT_NAME_TAKEN",
      message: 'Your company already has a project named "Tower A".',
      field: "name",
    });
    expect(appErrorFieldErrors(error)).toEqual({ name: 'Your company already has a project named "Tower A".' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back to the default message when the detail is empty and omits an empty hint", () => {
    const error = toAppError(pgError("P0001", "STALE_VERSION", "", ""));
    expect(error).toEqual({ code: "STALE_VERSION", message: DEFAULT_MESSAGES.STALE_VERSION });
    expect(appErrorFieldErrors(error)).toBeUndefined();
  });

  it("treats an unknown P0001 message as UNEXPECTED without leaking it", () => {
    const error = toAppError(pgError("P0001", "SOMETHING_INTERNAL", "secret internals: table x", "col"));
    expect(error.code).toBe("UNEXPECTED");
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("SOMETHING_INTERNAL");
    expect(error.referenceId).toMatch(/[0-9a-f-]{36}/);
  });

  it.each([
    ["42501", "permission denied for table projects", "FORBIDDEN"],
    ["PGRST116", "JSON object requested, multiple (or no) rows returned", "NOT_FOUND"],
    ["PGRST301", "JWSError JWSInvalidSignature", "UNAUTHENTICATED"],
    ["PGRST303", "JWT expired", "UNAUTHENTICATED"],
    ["23514", 'new row for relation "profiles" violates check constraint "profiles_avatar_url_check"', "VALIDATION"],
    ["22P02", 'invalid input syntax for type uuid: "abc"', "VALIDATION"],
  ])("maps PostgREST/Postgres %s without the raw text", (code, raw, expected) => {
    const error = toAppError(pgError(code, raw, "row details", "a hint"));
    expect(error.code).toBe(expected);
    expect(error.message).toBe(DEFAULT_MESSAGES[expected as keyof typeof DEFAULT_MESSAGES]);
    expect(error.message).not.toContain(raw);
    expect(error.field).toBeUndefined();
  });

  it("maps a PostgREST fetch failure to NETWORK", () => {
    const error = toAppError(pgError("", "TypeError: fetch failed", "Error: connect ECONNREFUSED", ""));
    expect(error.code).toBe("NETWORK");
  });

  it("treats other Postgres errors as UNEXPECTED with a logged reference id", () => {
    const raw = 'duplicate key value violates unique constraint "invitations_token_hash_key"';
    const error = toAppError(pgError("23505", raw, "Key (token_hash)=(abc) already exists.", ""));
    expect(error.code).toBe("UNEXPECTED");
    expect(error.message).not.toContain("duplicate");
    expect(error.message).not.toContain("token_hash");
    expect(error.referenceId).toBeDefined();
    expect(error.message).toContain(error.referenceId!.slice(0, 8).toUpperCase());
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain(error.referenceId!);
  });
});

describe("toAppError: auth errors", () => {
  it.each([
    ["invalid_credentials", 400, "INVALID_CREDENTIALS", undefined],
    ["email_not_confirmed", 400, "EMAIL_NOT_CONFIRMED", undefined],
    ["user_already_exists", 422, "EMAIL_TAKEN", "email"],
    ["email_exists", 422, "EMAIL_TAKEN", "email"],
    ["weak_password", 422, "WEAK_PASSWORD", "password"],
    ["over_email_send_rate_limit", 429, "RATE_LIMITED", undefined],
    ["over_request_rate_limit", 429, "RATE_LIMITED", undefined],
    ["same_password", 422, "VALIDATION", "password"],
    ["otp_expired", 403, "LINK_EXPIRED", undefined],
    ["flow_state_not_found", 404, "OAUTH_FAILED", undefined],
    ["bad_oauth_state", 400, "OAUTH_FAILED", undefined],
    ["bad_code_verifier", 400, "LINK_INVALID", undefined],
    ["session_not_found", 403, "UNAUTHENTICATED", undefined],
    ["provider_disabled", 400, "OAUTH_NOT_CONFIGURED", undefined],
    ["invite_not_found", 404, "LINK_INVALID", undefined],
    ["email_address_not_authorized", 400, "EMAIL_SEND_FAILED", "email"],
    ["refresh_token_already_used", 400, "UNAUTHENTICATED", undefined],
  ])("maps %s", (authCode, status, expected, field) => {
    const error = toAppError(new AuthApiError("raw provider text", status, authCode));
    expect(error.code).toBe(expected);
    expect(error.field).toBe(field);
    expect(error.message).not.toContain("raw provider text");
  });

  it("maps a disabled OAuth provider to OAUTH_NOT_CONFIGURED", () => {
    const error = toAppError(new AuthApiError("Unsupported provider: provider is not enabled", 400, "validation_failed"));
    expect(error).toEqual({ code: "OAUTH_NOT_CONFIGURED", message: DEFAULT_MESSAGES.OAUTH_NOT_CONFIGURED });
    expect(isProviderDisabledMessage("Unsupported provider: provider is not enabled")).toBe(true);
    expect(isProviderDisabledMessage("Unable to exchange external code")).toBe(false);
    expect(isProviderDisabledMessage(null)).toBe(false);
    // other validation failures stay VALIDATION
    expect(toAppError(new AuthApiError("Unable to validate email address: invalid format", 400, "validation_failed")).code).toBe(
      "VALIDATION",
    );
  });

  it("maps signup mail failures to EMAIL_SEND_FAILED without the raw text", () => {
    for (const raw of ["Error sending confirmation email", "Error sending recovery email", "Error sending magic link email"]) {
      const error = toAppError(new AuthApiError(raw, 500, "unexpected_failure"));
      expect(error).toEqual({ code: "EMAIL_SEND_FAILED", message: DEFAULT_MESSAGES.EMAIL_SEND_FAILED });
    }
    expect(toAppError(new AuthApiError("Error sending confirmation email", 500, undefined)).code).toBe("EMAIL_SEND_FAILED");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("explains breached passwords", () => {
    const error = toAppError(new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]));
    expect(error).toMatchObject({ code: "WEAK_PASSWORD", field: "password" });
    expect(error.message).toMatch(/data breach/);
  });

  it("matches legacy messages without a code", () => {
    expect(toAppError(new AuthApiError("Invalid login credentials", 400, undefined)).code).toBe("INVALID_CREDENTIALS");
    expect(toAppError(new AuthApiError("Email not confirmed", 400, undefined)).code).toBe("EMAIL_NOT_CONFIRMED");
    expect(toAppError(new AuthApiError("User already registered", 422, undefined)).code).toBe("EMAIL_TAKEN");
  });

  it("maps retryable fetch failures, missing sessions and missing PKCE verifiers", () => {
    expect(toAppError(new AuthRetryableFetchError("fetch failed", 0)).code).toBe("NETWORK");
    expect(toAppError(new AuthSessionMissingError()).code).toBe("UNAUTHENTICATED");
    expect(toAppError(new AuthPKCECodeVerifierMissingError()).code).toBe("LINK_INVALID");
  });

  it("falls back to RATE_LIMITED for unknown 429s and UNEXPECTED otherwise", () => {
    expect(toAppError(new AuthApiError("slow down", 429, "brand_new_limit")).code).toBe("RATE_LIMITED");
    const unknown = toAppError(new AuthApiError("internal auth hiccup", 500, "unexpected_failure"));
    expect(unknown.code).toBe("UNEXPECTED");
    expect(unknown.message).not.toContain("hiccup");
    expect(unknown.referenceId).toBeDefined();
  });
});

describe("toAppError: other sources", () => {
  it("passes AppException through", () => {
    expect(toAppError(new AppException("NOT_FOUND"))).toEqual({
      code: "NOT_FOUND",
      message: DEFAULT_MESSAGES.NOT_FOUND,
    });
    expect(toAppError(new AppException("VALIDATION", "Pick a date.", { field: "startDate" }))).toEqual({
      code: "VALIDATION",
      message: "Pick a date.",
      field: "startDate",
    });
  });

  it("maps zod errors to VALIDATION on the first field", () => {
    const parsed = z.object({ dates: z.object({ end: z.string().min(1, "Enter an end date.") }) }).safeParse({
      dates: { end: "" },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(toAppError(parsed.error)).toEqual({ code: "VALIDATION", message: "Enter an end date.", field: "dates.end" });
    }
  });

  it("maps domain errors", () => {
    expect(toAppError(new DomainError("NO_WORKING_DAYS")).code).toBe("NO_WORKING_DAYS");
    expect(toAppError(new DomainError("INVALID_DATE", "bad date 2026-13-01"))).toEqual({
      code: "VALIDATION",
      message: DEFAULT_MESSAGES.VALIDATION,
    });
  });

  it("maps fetch failures and timeouts to NETWORK", () => {
    expect(toAppError(new TypeError("fetch failed")).code).toBe("NETWORK");
    expect(toAppError(new TypeError("Failed to fetch")).code).toBe("NETWORK");
    expect(toAppError(new DOMException("The operation timed out.", "TimeoutError")).code).toBe("NETWORK");
    expect(toAppError(new DOMException("aborted", "AbortError")).code).toBe("NETWORK");
  });

  it("turns anything else into UNEXPECTED without raw text", () => {
    for (const thrown of [new Error("relation \"secret_table\" does not exist"), "boom secret", 42, null, undefined]) {
      const error = toAppError(thrown);
      expect(error.code).toBe("UNEXPECTED");
      expect(error.message).not.toMatch(/secret/);
      expect(error.message.startsWith(DEFAULT_MESSAGES.UNEXPECTED)).toBe(true);
      expect(error.referenceId).toBeTruthy();
    }
    expect(consoleError).toHaveBeenCalledTimes(5);
  });
});

describe("errorFromRpcResult", () => {
  it("returns null for successful results", () => {
    expect(errorFromRpcResult({ ok: true, error_code: null, error_message: null, company_id: "c1" })).toBeNull();
  });

  it.each(["INVALID_CODE", "CODE_EXPIRED", "CODE_REVOKED", "CODE_EXHAUSTED"] as const)(
    "maps the returned %s code with the database message and an optional field",
    (code) => {
      expect(errorFromRpcResult({ ok: false, error_code: code, error_message: "  Plain message from the DB.  " })).toEqual({
        code,
        message: "Plain message from the DB.",
      });
      expect(errorFromRpcResult({ ok: false, error_code: code, error_message: null }, { field: "code" })).toEqual({
        code,
        message: DEFAULT_MESSAGES[code],
        field: "code",
      });
    },
  );

  it("treats unknown codes and malformed results as UNEXPECTED without leaking them", () => {
    const unknown = errorFromRpcResult({ ok: false, error_code: "SECRET_INTERNAL", error_message: "secret internals" });
    expect(unknown?.code).toBe("UNEXPECTED");
    expect(unknown?.message).not.toContain("secret");
    expect(unknown?.referenceId).toBeDefined();
    expect(errorFromRpcResult(null)?.code).toBe("UNEXPECTED");
    expect(errorFromRpcResult("nope")?.code).toBe("UNEXPECTED");
    expect(consoleError).toHaveBeenCalledTimes(3);
  });
});

describe("auth redirect errors", () => {
  it("round-trips the login error parameter", () => {
    for (const code of AUTH_REDIRECT_ERROR_CODES) {
      const param = authRedirectParam(code);
      expect(param).toBe(code.toLowerCase());
      expect(authRedirectError(param)).toEqual({ code, message: DEFAULT_MESSAGES[code] });
    }
  });

  it("ignores unknown or hostile values", () => {
    expect(authRedirectError(null)).toBeNull();
    expect(authRedirectError("")).toBeNull();
    expect(authRedirectError("<script>alert(1)</script>")).toBeNull();
    expect(authRedirectError("stale_version")).toBeNull();
  });

  it("keeps specific auth codes and falls back for the rest", () => {
    expect(authRedirectCodeFor({ code: "LINK_EXPIRED", message: "" }, "LINK_INVALID")).toBe("LINK_EXPIRED");
    expect(authRedirectCodeFor({ code: "UNEXPECTED", message: "" }, "OAUTH_FAILED")).toBe("OAUTH_FAILED");
    expect(authRedirectCodeFor({ code: "RATE_LIMITED", message: "" }, "LINK_INVALID")).toBe("LINK_INVALID");
  });
});
