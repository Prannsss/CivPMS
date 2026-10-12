/**
 * Domain-level errors. These are thrown by pure functions when called with input that
 * violates a precondition (an invalid date string, a calendar without working days, …).
 * They are programming/data errors, not user-facing validation: user input is validated
 * with the zod schemas in `schemas.ts`, which return plain-language messages instead.
 */

export const DOMAIN_ERROR_CODES = [
  "INVALID_DATE",
  "INVALID_NUMBER",
  "INVALID_DURATION",
  "INVALID_HOURS_PER_DAY",
  "NO_WORKING_DAYS",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
  }
}

/** Type guard that also narrows by code when one is given. */
export function isDomainError(value: unknown, code?: DomainErrorCode): value is DomainError {
  return value instanceof DomainError && (code === undefined || value.code === code);
}
