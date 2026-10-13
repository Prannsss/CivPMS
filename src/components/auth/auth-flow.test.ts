import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  authPagePath,
  checkEmailPath,
  cleanNext,
  emailFlowError,
  emailParam,
  firstParam,
  isVisibleRecoveryError,
  maskEmail,
  matchesEmailHint,
  onboardingPath,
  postAuthDestination,
} from "./auth-flow";

describe("cleanNext", () => {
  it("keeps safe in-app paths and drops home, empty and unsafe values", () => {
    expect(cleanNext("/projects/1?tab=wbs")).toBe("/projects/1?tab=wbs");
    expect(cleanNext("/")).toBeNull();
    expect(cleanNext(null)).toBeNull();
    expect(cleanNext("")).toBeNull();
    expect(cleanNext("https://evil.example/steal")).toBeNull();
    expect(cleanNext("//evil.example")).toBeNull();
    expect(cleanNext("/login")).toBeNull();
  });
});

describe("postAuthDestination", () => {
  it("sends onboarded people to next or home", () => {
    expect(postAuthDestination({ onboarded: true })).toBe("/");
    expect(postAuthDestination({ onboarded: true, next: "/notifications" })).toBe("/notifications");
    expect(postAuthDestination({ onboarded: true, next: "https://evil.example" })).toBe("/");
  });

  it("sends people who haven't onboarded to onboarding, keeping next", () => {
    expect(postAuthDestination({ onboarded: false })).toBe("/onboarding");
    expect(postAuthDestination({ onboarded: false, next: "/projects/1" })).toBe("/onboarding?next=%2Fprojects%2F1");
  });

  it("lets invitation links skip onboarding (accepting finishes it)", () => {
    const invite = `/invite/${"a".repeat(64)}`;
    expect(postAuthDestination({ onboarded: false, next: invite })).toBe(invite);
    expect(postAuthDestination({ onboarded: true, next: invite })).toBe(invite);
  });
});

describe("paths", () => {
  it("builds onboarding, check-email and auth page links", () => {
    expect(onboardingPath(null)).toBe("/onboarding");
    expect(onboardingPath("/onboarding")).toBe("/onboarding");
    expect(checkEmailPath({ email: "juan@example.com", type: "signup" })).toBe(
      "/check-email?email=juan%40example.com&type=signup",
    );
    expect(checkEmailPath({ email: "a@b.co", type: "recovery", next: "/invite/x" })).toBe(
      "/check-email?email=a%40b.co&type=recovery&next=%2Finvite%2Fx",
    );
    expect(authPagePath("/login")).toBe("/login");
    expect(authPagePath("/signup", { email: "a@b.co", next: "/" })).toBe("/signup?email=a%40b.co");
    expect(authPagePath("/login", { next: "/invite/abc" })).toBe("/login?next=%2Finvite%2Fabc");
  });
});

describe("query params", () => {
  it("reads the first value of a param", () => {
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam([])).toBeNull();
  });

  it("only prefills plausible emails, lower-cased", () => {
    expect(emailParam(" Juan@Example.COM ")).toBe("juan@example.com");
    expect(emailParam("not-an-email")).toBe("");
    expect(emailParam("<script>@x.y z")).toBe("");
    expect(emailParam(`${"a".repeat(250)}@x.io`)).toBe("");
    expect(emailParam(undefined)).toBe("");
  });
});

describe("emailFlowError", () => {
  it("turns Supabase's mailer cap into EMAIL_SEND_FAILED for the flow", () => {
    const error = new AuthApiError("email rate limit exceeded", 429, "over_email_send_rate_limit");
    expect(emailFlowError(error, "signup")).toEqual({
      code: "EMAIL_SEND_FAILED",
      message: expect.stringContaining("your account wasn't created"),
    });
    expect(emailFlowError(error, "recovery").message).toContain("reset email");
    expect(emailFlowError(error, "resend").message).toContain("another email");
  });

  it("explains addresses the built-in mailer won't send to, on the email field", () => {
    const error = new AuthApiError("Email address not authorized", 400, "email_address_not_authorized");
    const appError = emailFlowError(error, "signup");
    expect(appError.code).toBe("EMAIL_SEND_FAILED");
    expect(appError.field).toBe("email");
    expect(appError.message).toContain("email delivery is still being set up");
  });

  it("maps SMTP failures and undeliverable addresses", () => {
    const smtp = new AuthApiError("Error sending confirmation email", 500, "unexpected_failure");
    expect(emailFlowError(smtp, "signup").code).toBe("EMAIL_SEND_FAILED");
    const invalid = new AuthApiError('Email address "x@y.test" is invalid', 400, "email_address_invalid");
    expect(emailFlowError(invalid, "signup")).toMatchObject({ code: "VALIDATION", field: "email" });
  });

  it("passes other errors through the shared mapper", () => {
    const weak = new AuthApiError("Password is too weak", 422, "weak_password");
    expect(emailFlowError(weak, "signup")).toMatchObject({ code: "WEAK_PASSWORD", field: "password" });
  });
});

describe("isVisibleRecoveryError", () => {
  it("shows delivery problems but never account existence", () => {
    expect(isVisibleRecoveryError({ code: "EMAIL_SEND_FAILED", message: "" })).toBe(true);
    expect(isVisibleRecoveryError({ code: "RATE_LIMITED", message: "" })).toBe(true);
    expect(isVisibleRecoveryError({ code: "VALIDATION", message: "", field: "email" })).toBe(true);
    expect(isVisibleRecoveryError({ code: "NOT_FOUND", message: "" })).toBe(false);
    expect(isVisibleRecoveryError({ code: "UNEXPECTED", message: "" })).toBe(false);
  });
});

describe("email hints", () => {
  it("masks like the database and compares case-insensitively", () => {
    expect(maskEmail("Juan@Gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("nope")).toBeNull();
    expect(maskEmail(null)).toBeNull();
    expect(matchesEmailHint("juan@gmail.com", "J***@gmail.com")).toBe(true);
    expect(matchesEmailHint("pedro@gmail.com", "j***@gmail.com")).toBe(false);
    expect(matchesEmailHint(null, "j***@gmail.com")).toBe(false);
  });
});
