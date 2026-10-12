import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  activityCreateSchema,
  activityProgressSchema,
  activityUpdateSchema,
  calendarDateSchema,
  calendarSettingsSchema,
  companyCreateSchema,
  companyNameSchema,
  DEFAULT_NOTIFICATION_PREFS,
  fieldErrorsFrom,
  forgotPasswordSchema,
  inviteCodeSchema,
  inviteSchema,
  notificationPrefsSchema,
  onboardingProfileSchema,
  profileUpdateSchema,
  projectCreateSchema,
  projectStatusChangeSchema,
  projectUpdateSchema,
  redeemInviteCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";

/** First error message per field for an invalid input. */
function errors(schema: z.ZodType, input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) throw new Error(`Expected failure, got ${JSON.stringify(result.data)}`);
  return fieldErrorsFrom(result.error);
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(JSON.stringify(fieldErrorsFrom(result.error)));
  return result.data as z.output<S>;
}

describe("auth schemas", () => {
  it("signIn trims and lowercases the email", () => {
    expect(parse(signInSchema, { email: "  Maria@Example.COM ", password: "x" })).toEqual({
      email: "maria@example.com",
      password: "x",
    });
  });

  it("signIn messages", () => {
    expect(errors(signInSchema, { email: "", password: "" })).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(errors(signInSchema, { email: "maria", password: "x" }).email).toBe(
      "Enter a valid email address, like name@company.com.",
    );
    expect(errors(signInSchema, {})).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(errors(signInSchema, { email: `${"a".repeat(250)}@x.com`, password: "x" }).email).toMatch(/254 characters/);
  });

  it("signUp enforces the password length", () => {
    expect(parse(signUpSchema, { email: "a@b.co", password: "0123456789" }).password).toBe("0123456789");
    expect(errors(signUpSchema, { email: "a@b.co", password: "short" }).password).toBe(
      "Use at least 10 characters for your password.",
    );
    expect(errors(signUpSchema, { email: "a@b.co", password: "" }).password).toBe("Enter a password.");
    expect(errors(signUpSchema, { email: "a@b.co", password: "x".repeat(73) }).password).toBe(
      "Use 72 characters or fewer for your password.",
    );
  });

  it("forgotPassword needs an email", () => {
    expect(parse(forgotPasswordSchema, { email: "A@B.CO" })).toEqual({ email: "a@b.co" });
    expect(errors(forgotPasswordSchema, { email: " " }).email).toBe("Enter your email address.");
  });

  it("resetPassword requires matching passwords", () => {
    expect(parse(resetPasswordSchema, { password: "0123456789", confirmPassword: "0123456789" })).toBeTruthy();
    expect(errors(resetPasswordSchema, { password: "0123456789", confirmPassword: "0123456780" })).toEqual({
      confirmPassword: "Passwords don't match. Type the same password in both fields.",
    });
    expect(errors(resetPasswordSchema, { password: "0123456789", confirmPassword: "" })).toEqual({
      confirmPassword: "Type your new password again.",
    });
  });
});

describe("onboarding schemas", () => {
  it("profile: name 2–100 and role", () => {
    expect(parse(onboardingProfileSchema, { fullName: "  Maria Santos ", role: "inspector" })).toEqual({
      fullName: "Maria Santos",
      role: "inspector",
    });
    expect(errors(onboardingProfileSchema, { fullName: "", role: "admin" })).toEqual({
      fullName: "Enter your full name.",
      role: "Choose your role: Project Manager or Inspector / QA / QC.",
    });
    expect(errors(onboardingProfileSchema, { fullName: "M", role: "pm" }).fullName).toBe(
      "Enter your full name (at least 2 characters).",
    );
    expect(errors(onboardingProfileSchema, { fullName: "M".repeat(101), role: "pm" }).fullName).toBe(
      "Use 100 characters or fewer for your name.",
    );
  });

  it("company name: trimmed, whitespace collapsed, 2–100", () => {
    expect(companyNameSchema.parse("  Acme   Builders  Inc. ")).toBe("Acme Builders Inc.");
    expect(parse(companyCreateSchema, { name: "AB" })).toEqual({ name: "AB" });
    expect(errors(companyCreateSchema, { name: " " }).name).toBe("Enter your company name.");
    expect(errors(companyCreateSchema, { name: "A" }).name).toBe("Use at least 2 characters for the company name.");
    expect(errors(companyCreateSchema, { name: "A".repeat(101) }).name).toBe(
      "Use 100 characters or fewer for the company name.",
    );
  });

  it("invite code is normalized", () => {
    expect(inviteCodeSchema.parse(" 7kq2 m9xa ")).toBe("7KQ2-M9XA");
    expect(parse(redeemInviteCodeSchema, { code: "oooo-iiii" })).toEqual({ code: "0000-1111" });
    expect(errors(redeemInviteCodeSchema, { code: "" }).code).toBe("Enter your invite code.");
    expect(errors(redeemInviteCodeSchema, { code: "UUUU-UUUU" }).code).toBe(
      "That doesn't look like an invite code. Codes have 8 letters and numbers, like 7KQ2-M9XA.",
    );
  });

  it("invite: email lowercased and role", () => {
    expect(parse(inviteSchema, { email: " Juan@Site.PH ", role: "pm" })).toEqual({ email: "juan@site.ph", role: "pm" });
    expect(errors(inviteSchema, { email: "juan@site.ph", role: "owner_pm" }).role).toBe(
      "Choose a role: Project Manager or Inspector.",
    );
  });
});

describe("projectCreateSchema (§5.1)", () => {
  const valid = {
    name: "  Riverside Bridge  ",
    startDate: "2026-01-12",
    endDate: "2026-12-12",
    budget: "1,250,000.50",
    siteName: " ",
    siteAddress: "Km 12, Marilaque Hwy",
    description: "",
    color: "teal",
  };

  it("parses and coerces form values", () => {
    expect(parse(projectCreateSchema, valid)).toEqual({
      name: "Riverside Bridge",
      startDate: "2026-01-12",
      endDate: "2026-12-12",
      budget: 1250000.5,
      siteName: null,
      siteAddress: "Km 12, Marilaque Hwy",
      description: null,
      color: "teal",
    });
  });

  it("accepts a one-day project and numeric budgets", () => {
    expect(parse(projectCreateSchema, { ...valid, endDate: "2026-01-12", budget: 0.01 }).budget).toBe(0.01);
  });

  it("end date must be on or after the start date", () => {
    expect(errors(projectCreateSchema, { ...valid, endDate: "2026-01-11" })).toEqual({
      endDate: "End date must be on or after 12 Jan 2026.",
    });
  });

  it("name rules", () => {
    expect(errors(projectCreateSchema, { ...valid, name: "  " }).name).toBe("Enter a project name.");
    expect(errors(projectCreateSchema, { ...valid, name: "AB" }).name).toBe(
      "Use at least 3 characters for the project name.",
    );
    expect(errors(projectCreateSchema, { ...valid, name: "x".repeat(121) }).name).toBe(
      "Use 120 characters or fewer for the project name.",
    );
  });

  it("date rules", () => {
    expect(errors(projectCreateSchema, { ...valid, startDate: "" }).startDate).toBe("Enter the start date.");
    expect(errors(projectCreateSchema, { ...valid, startDate: "2026-02-30" }).startDate).toBe(
      "The start date isn't a valid date. Pick a date from the calendar.",
    );
    expect(errors(projectCreateSchema, { ...valid, endDate: undefined }).endDate).toBe("Enter the end date.");
  });

  it("budget rules", () => {
    expect(errors(projectCreateSchema, { ...valid, budget: "" }).budget).toBe("Enter the project budget.");
    expect(errors(projectCreateSchema, { ...valid, budget: "abc" }).budget).toBe(
      "Enter the budget as a number, like 1,250,000.50.",
    );
    expect(errors(projectCreateSchema, { ...valid, budget: "0" }).budget).toBe("The budget must be more than ₱0.00.");
    expect(errors(projectCreateSchema, { ...valid, budget: -5 }).budget).toBe("The budget must be more than ₱0.00.");
    expect(errors(projectCreateSchema, { ...valid, budget: "1,000.505" }).budget).toBe(
      "Use at most 2 decimal places (centavos).",
    );
    expect(errors(projectCreateSchema, { ...valid, budget: "1,000,000,000,000" }).budget).toBe(
      "The budget can't be more than ₱999,999,999,999.99.",
    );
    expect(parse(projectCreateSchema, { ...valid, budget: "999,999,999,999.99" }).budget).toBe(999_999_999_999.99);
  });

  it("optional text limits and color", () => {
    expect(errors(projectCreateSchema, { ...valid, siteName: "x".repeat(201) }).siteName).toBe(
      "Use 200 characters or fewer for the site name.",
    );
    expect(errors(projectCreateSchema, { ...valid, siteAddress: "x".repeat(501) }).siteAddress).toBe(
      "Use 500 characters or fewer for the site address.",
    );
    expect(errors(projectCreateSchema, { ...valid, description: "x".repeat(2001) }).description).toBe(
      "Use 2,000 characters or fewer for the description.",
    );
    expect(errors(projectCreateSchema, { ...valid, siteName: 42 }).siteName).toBe("Enter the site name as text.");
    expect(errors(projectCreateSchema, { ...valid, color: "red" }).color).toBe("Choose one of the project colors.");
    expect(parse(projectCreateSchema, { ...valid, siteName: null, description: undefined }).siteName).toBeNull();
  });
});

describe("projectUpdateSchema", () => {
  it("validates only the fields present", () => {
    expect(parse(projectUpdateSchema, { name: "New name" })).toEqual({ name: "New name" });
    expect(parse(projectUpdateSchema, {})).toEqual({});
    expect(parse(projectUpdateSchema, { weighting: "hours" })).toEqual({ weighting: "hours" });
    expect(errors(projectUpdateSchema, { weighting: "equal" }).weighting).toBe(
      "Choose how progress is weighted: by cost or by hours.",
    );
  });

  it("checks date order only when both dates are sent", () => {
    expect(parse(projectUpdateSchema, { endDate: "2020-01-01" })).toEqual({ endDate: "2020-01-01" });
    expect(errors(projectUpdateSchema, { startDate: "2026-03-01", endDate: "2026-02-28" }).endDate).toBe(
      "End date must be on or after 1 Mar 2026.",
    );
  });

  it("an empty optional text clears the value", () => {
    expect(parse(projectUpdateSchema, { siteName: "" })).toEqual({ siteName: null });
  });
});

describe("projectStatusChangeSchema", () => {
  it("requires a reason for On-Hold and Cancelled", () => {
    expect(parse(projectStatusChangeSchema, { status: "active" })).toEqual({ status: "active", reason: null });
    expect(parse(projectStatusChangeSchema, { status: "on_hold", reason: " Rain " })).toEqual({
      status: "on_hold",
      reason: "Rain",
    });
    expect(errors(projectStatusChangeSchema, { status: "on_hold", reason: "  " }).reason).toBe(
      "Add a reason for putting the project on hold.",
    );
    expect(errors(projectStatusChangeSchema, { status: "cancelled" }).reason).toBe(
      "Add a reason for cancelling the project.",
    );
    expect(errors(projectStatusChangeSchema, { status: "archived" }).status).toBe("Choose a project status.");
  });
});

describe("activity schemas", () => {
  const valid = {
    name: " Rebar installation ",
    startDate: "2026-10-12",
    durationHours: "12",
    estCost: "250,000",
  };

  it("parses a create payload with defaults", () => {
    expect(parse(activityCreateSchema, valid)).toEqual({
      name: "Rebar installation",
      description: null,
      startDate: "2026-10-12",
      durationHours: 12,
      endDate: undefined,
      estCost: 250000,
      parentId: null,
    });
  });

  it("accepts a parent, an end date, a milestone and empty cost", () => {
    const parsed = parse(activityCreateSchema, {
      ...valid,
      parentId: "3f1c2b9a-1d2e-4f5a-8b6c-7d8e9f0a1b2c",
      endDate: "2026-10-12",
      durationHours: 0,
      estCost: "",
    });
    expect(parsed).toMatchObject({ parentId: "3f1c2b9a-1d2e-4f5a-8b6c-7d8e9f0a1b2c", durationHours: 0, estCost: 0 });
    expect(parse(activityCreateSchema, { ...valid, endDate: "" }).endDate).toBeUndefined();
  });

  it("messages", () => {
    expect(errors(activityCreateSchema, { ...valid, name: "" }).name).toBe("Enter a name.");
    expect(errors(activityCreateSchema, { ...valid, name: "x".repeat(201) }).name).toBe(
      "Use 200 characters or fewer for the name.",
    );
    expect(errors(activityCreateSchema, { ...valid, durationHours: "" }).durationHours).toBe(
      "Enter the duration in hours (0 for a milestone).",
    );
    expect(errors(activityCreateSchema, { ...valid, durationHours: "two" }).durationHours).toBe(
      "Enter the duration as a number, like 16 or 7.5.",
    );
    expect(errors(activityCreateSchema, { ...valid, durationHours: -1 }).durationHours).toBe(
      "Duration can't be negative. Enter 0 for a milestone.",
    );
    expect(errors(activityCreateSchema, { ...valid, durationHours: 100_001 }).durationHours).toBe(
      "Duration can be at most 100,000 hours.",
    );
    expect(errors(activityCreateSchema, { ...valid, durationHours: 1.234 }).durationHours).toBe(
      "Use at most 2 decimal places for the duration.",
    );
    expect(errors(activityCreateSchema, { ...valid, estCost: "-1" }).estCost).toBe(
      "Estimated cost can't be negative. Enter 0 if it isn't known yet.",
    );
    expect(errors(activityCreateSchema, { ...valid, estCost: "1.001" }).estCost).toBe(
      "Use at most 2 decimal places (centavos).",
    );
    expect(errors(activityCreateSchema, { ...valid, estCost: "x" }).estCost).toBe(
      "Enter the estimated cost as a number, like 250,000.00.",
    );
    expect(errors(activityCreateSchema, { ...valid, estCost: 1e13 }).estCost).toBe(
      "Estimated cost can't be more than ₱999,999,999,999.99.",
    );
    expect(errors(activityCreateSchema, { ...valid, parentId: "not-a-uuid" }).parentId).toBe("Choose a valid parent.");
    expect(errors(activityCreateSchema, { ...valid, endDate: "2026-10-11" }).endDate).toBe(
      "End date must be on or after 12 Oct 2026.",
    );
    expect(errors(activityCreateSchema, { ...valid, endDate: "2026-10-32" }).endDate).toBe(
      "The end date isn't a valid date. Pick a date from the calendar.",
    );
  });

  it("update is partial and keeps absent fields absent", () => {
    expect(parse(activityUpdateSchema, { name: "Formworks" })).toEqual({ name: "Formworks" });
    expect(parse(activityUpdateSchema, { estCost: "" })).toEqual({ estCost: 0 });
    expect(errors(activityUpdateSchema, { startDate: "2026-10-12", endDate: "2026-10-01" }).endDate).toBe(
      "End date must be on or after 12 Oct 2026.",
    );
  });
});

describe("activityProgressSchema (§10.2–10.3)", () => {
  it("accepts consistent updates", () => {
    expect(parse(activityProgressSchema, { status: "ongoing", percent: "40" })).toEqual({
      status: "ongoing",
      percent: 40,
      note: null,
    });
    expect(parse(activityProgressSchema, { status: "on_hold", percent: 40, note: "Waiting for permit" })).toMatchObject({
      note: "Waiting for permit",
    });
  });

  it("checks status ↔ percent", () => {
    expect(errors(activityProgressSchema, { status: "completed", percent: 90 }).percent).toMatch(/at 100%/);
    expect(errors(activityProgressSchema, { status: "ongoing", percent: 40.5 }).percent).toBe(
      "Enter the progress as a whole number from 0 to 100.",
    );
    expect(errors(activityProgressSchema, { status: "ongoing", percent: "" }).percent).toBe(
      "Enter the progress (0–100).",
    );
  });

  it("requires a note for Delayed/On-Hold and for reopening", () => {
    expect(errors(activityProgressSchema, { status: "delayed", percent: 10 }).note).toBe(
      "Add a note explaining the delay or hold.",
    );
    expect(
      errors(activityProgressSchema, { status: "ongoing", percent: 90, previousStatus: "completed" }).note,
    ).toBe("Add a note explaining why this completed activity is being reopened.");
    expect(
      parse(activityProgressSchema, { status: "completed", percent: 100, previousStatus: "completed" }),
    ).toMatchObject({ status: "completed" });
    expect(parse(activityProgressSchema, { status: "ongoing", percent: 5, previousStatus: "not_started" })).toBeTruthy();
    expect(errors(activityProgressSchema, { status: "ongoing", percent: 5, note: "x".repeat(1001) }).note).toBe(
      "Use 1,000 characters or fewer for the note.",
    );
  });
});

describe("calendar schemas (§7)", () => {
  it("parses settings, sorting work days and coercing strings", () => {
    expect(parse(calendarSettingsSchema, { workDays: ["5", 1, 3], hoursPerDay: "7.5", holidaysNonWorking: true })).toEqual(
      { workDays: [1, 3, 5], hoursPerDay: 7.5, holidaysNonWorking: true },
    );
  });

  it("settings messages", () => {
    const base = { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaysNonWorking: true };
    expect(errors(calendarSettingsSchema, { ...base, workDays: [] }).workDays).toBe("Choose at least one working day.");
    expect(errors(calendarSettingsSchema, { ...base, workDays: "1,2" }).workDays).toBe(
      "Choose at least one working day.",
    );
    expect(errors(calendarSettingsSchema, { ...base, workDays: [1, 1] }).workDays).toBe(
      "Each day can be chosen only once.",
    );
    expect(errors(calendarSettingsSchema, { ...base, workDays: [0] })["workDays.0"]).toBe(
      "Pick working days from Monday to Sunday.",
    );
    expect(errors(calendarSettingsSchema, { ...base, workDays: [8] })["workDays.0"]).toBe(
      "Pick working days from Monday to Sunday.",
    );
    expect(errors(calendarSettingsSchema, { ...base, hoursPerDay: 0 }).hoursPerDay).toBe(
      "Hours per day must be between 1 and 24.",
    );
    expect(errors(calendarSettingsSchema, { ...base, hoursPerDay: 25 }).hoursPerDay).toBe(
      "Hours per day must be between 1 and 24.",
    );
    expect(errors(calendarSettingsSchema, { ...base, hoursPerDay: 7.555 }).hoursPerDay).toBe(
      "Use at most 2 decimal places for hours per day.",
    );
    expect(errors(calendarSettingsSchema, { ...base, hoursPerDay: "" }).hoursPerDay).toBe(
      "Enter the working hours per day.",
    );
    expect(errors(calendarSettingsSchema, { ...base, holidaysNonWorking: "yes" }).holidaysNonWorking).toBe(
      "Choose whether holidays are non-working days.",
    );
  });

  it("calendar dates: holidays need a name", () => {
    expect(parse(calendarDateSchema, { date: "2026-06-12", kind: "holiday", note: "Independence Day" })).toEqual({
      date: "2026-06-12",
      kind: "holiday",
      note: "Independence Day",
    });
    expect(parse(calendarDateSchema, { date: "2026-06-13", kind: "override_working" })).toEqual({
      date: "2026-06-13",
      kind: "override_working",
      note: null,
    });
    expect(errors(calendarDateSchema, { date: "2026-06-12", kind: "holiday" }).note).toBe(
      "Enter the holiday name, like Independence Day.",
    );
    expect(errors(calendarDateSchema, { date: "2026-06-12", kind: "weekend" }).kind).toBe(
      "Choose holiday, non-working day or working day.",
    );
  });
});

describe("profile and notification schemas", () => {
  it("profile update", () => {
    expect(parse(profileUpdateSchema, { fullName: "Maria Santos" })).toEqual({ fullName: "Maria Santos", avatarUrl: null });
    expect(parse(profileUpdateSchema, { fullName: "Maria", avatarUrl: "https://cdn.example.com/a.png" }).avatarUrl).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(errors(profileUpdateSchema, { fullName: "Maria", avatarUrl: "javascript:alert(1)" }).avatarUrl).toBe(
      "Enter a web address that starts with https://.",
    );
  });

  it("notification prefs", () => {
    expect(parse(notificationPrefsSchema, DEFAULT_NOTIFICATION_PREFS)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS.events.activity_escalated).toEqual({ inApp: true, email: true });
    const missing = { ...DEFAULT_NOTIFICATION_PREFS, events: { invitations: { inApp: true, email: false } } };
    expect(notificationPrefsSchema.safeParse(missing).success).toBe(false);
    expect(errors(notificationPrefsSchema, { ...DEFAULT_NOTIFICATION_PREFS, emailDigest: "weekly" }).emailDigest).toBe(
      "Choose off or daily for the email digest.",
    );
    expect(
      errors(notificationPrefsSchema, {
        ...DEFAULT_NOTIFICATION_PREFS,
        events: { ...DEFAULT_NOTIFICATION_PREFS.events, invitations: { inApp: "yes", email: true } },
      })["events.invitations.inApp"],
    ).toBe("Choose on or off for in-app notifications.");
  });
});

describe("fieldErrorsFrom", () => {
  it("keeps the first message per path and uses _form for root issues", () => {
    const result = signInSchema.safeParse("nope");
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrorsFrom(result.error))).toEqual(["_form"]);
  });
});
