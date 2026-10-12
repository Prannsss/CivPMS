/**
 * zod v4 schemas shared by forms (react-hook-form) and Server Actions.
 * Every message says what is wrong and how to fix it (spec §17.2).
 * Numeric fields accept form strings such as '1,250,000.50' and coerce them to numbers.
 *
 * Types: `XxxInput` is what a form may submit (z.input), `XxxValues` is the parsed result (z.output).
 */
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, PROJECT_COLOR_KEYS } from "@/lib/constants";
import { isValidISODate } from "./dates";
import { formatDate, formatPeso } from "./format";
import { normalizeInviteCode } from "./invite-code";
import { hasAtMostDecimals, MAX_MONEY, parseNumericInput, roundMoney } from "./money";
import { PROJECT_ROLES } from "./permissions";
import { PROJECT_STATUSES, projectStatusRequiresReason } from "./project";
import { ACTIVITY_STATUSES, statusChangeRequiresNote, validateStatusPercent } from "./status";

/** Supabase (bcrypt) ignores bytes past 72, so longer passwords are rejected up front. */
export const PASSWORD_MAX_LENGTH = 72;
export const MAX_DURATION_HOURS = 100_000;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "Use an email address of 254 characters or fewer.")
  .pipe(z.email("Enter a valid email address, like name@company.com."));

const newPasswordSchema = z
  .string({ error: "Enter a password." })
  .min(1, "Enter a password.")
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`)
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer for your password.`);

export const fullNameSchema = z
  .string({ error: "Enter your full name." })
  .trim()
  .min(1, "Enter your full name.")
  .min(2, "Enter your full name (at least 2 characters).")
  .max(100, "Use 100 characters or fewer for your name.");

/** Optional free text: trimmed, '' and null become null, max length enforced. */
function optionalText(max: number, label: string) {
  return z
    .string({ error: `Enter the ${label} as text.` })
    .trim()
    .max(max, `Use ${max.toLocaleString("en-US")} characters or fewer for the ${label}.`)
    .nullish()
    .transform((value) => (value ? value : null));
}

/** Required ISO calendar date (`YYYY-MM-DD`, as produced by date pickers). */
function dateField(label: string) {
  return z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .min(1, `Enter the ${label}.`)
    .refine(isValidISODate, `The ${label} isn't a valid date. Pick a date from the calendar.`);
}

/** Optional ISO date: '' and null become undefined. */
function optionalDateField(label: string) {
  return z.preprocess((value) => (value === "" || value === null ? undefined : value), dateField(label).optional());
}

/**
 * Numeric form field: strings like '1,250,000.50' are parsed; '' / null / undefined mean "missing"
 * (or `emptyValue` when given); text that is not a number is reported with the schema's message.
 */
function numericField<T extends z.ZodNumber>(schema: T, emptyValue?: number) {
  return z.preprocess((value) => {
    const parsed = parseNumericInput(value);
    return parsed === null ? emptyValue : parsed;
  }, schema);
}

function numberError(requiredMessage: string, invalidMessage: string) {
  return {
    error: (issue: { input?: unknown }) => (issue.input === undefined ? requiredMessage : invalidMessage),
  };
}

type DateOrderShape = { startDate?: string | null; endDate?: string | null };

/** Adds 'End date must be on or after 12 Jan 2026.' on endDate when both dates are valid and out of order. */
function checkDateOrder(value: DateOrderShape, ctx: z.core.$RefinementCtx<DateOrderShape>): void {
  const { startDate, endDate } = value;
  if (isValidISODate(startDate) && isValidISODate(endDate) && endDate < startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `End date must be on or after ${formatDate(startDate)}.`,
    });
  }
}

const TWO_DECIMALS_MESSAGE = "Use at most 2 decimal places (centavos).";

// ---------------------------------------------------------------------------
// Auth & onboarding (spec §4, D10)
// ---------------------------------------------------------------------------

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password."),
});
export type SignInInput = z.input<typeof signInSchema>;
export type SignInValues = z.output<typeof signInSchema>;

export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type ForgotPasswordValues = z.output<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string({ error: "Type your new password again." }).min(1, "Type your new password again."),
  })
  .superRefine((value, ctx) => {
    if (value.confirmPassword && value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords don't match. Type the same password in both fields.",
      });
    }
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>;

export const ONBOARDING_ROLES = ["pm", "inspector"] as const;

export const onboardingProfileSchema = z.object({
  fullName: fullNameSchema,
  role: z.enum(ONBOARDING_ROLES, { error: "Choose your role: Project Manager or Inspector / QA / QC." }),
});
export type OnboardingProfileInput = z.input<typeof onboardingProfileSchema>;
export type OnboardingProfileValues = z.output<typeof onboardingProfileSchema>;

/** Company name: trimmed, inner whitespace collapsed, 2–100 characters (unique case-insensitively in the DB). */
export const companyNameSchema = z
  .string({ error: "Enter your company name." })
  .trim()
  .min(1, "Enter your company name.")
  .min(2, "Use at least 2 characters for the company name.")
  .max(100, "Use 100 characters or fewer for the company name.")
  .transform((value) => value.replace(/\s+/g, " "));

export const companyCreateSchema = z.object({ name: companyNameSchema });
export type CompanyCreateInput = z.input<typeof companyCreateSchema>;
export type CompanyCreateValues = z.output<typeof companyCreateSchema>;

/** Invite code typed by a user → canonical `XXXX-XXXX` (see invite-code.ts). */
export const inviteCodeSchema = z
  .string({ error: "Enter your invite code." })
  .trim()
  .min(1, "Enter your invite code.")
  .transform((value, ctx) => {
    const code = normalizeInviteCode(value);
    if (!code) {
      ctx.addIssue({
        code: "custom",
        message: "That doesn't look like an invite code. Codes have 8 letters and numbers, like 7KQ2-M9XA.",
      });
      return z.NEVER;
    }
    return code;
  });

export const redeemInviteCodeSchema = z.object({ code: inviteCodeSchema });
export type RedeemInviteCodeInput = z.input<typeof redeemInviteCodeSchema>;
export type RedeemInviteCodeValues = z.output<typeof redeemInviteCodeSchema>;

/** Email invitation to a project (spec §4.4). */
export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(PROJECT_ROLES, { error: "Choose a role: Project Manager or Inspector." }),
});
export type InviteInput = z.input<typeof inviteSchema>;
export type InviteValues = z.output<typeof inviteSchema>;

// ---------------------------------------------------------------------------
// Projects (spec §5.1, §5.2)
// ---------------------------------------------------------------------------

const budgetField = numericField(
  z
    .number(numberError("Enter the project budget.", "Enter the budget as a number, like 1,250,000.50."))
    .positive("The budget must be more than ₱0.00.")
    .max(MAX_MONEY, `The budget can't be more than ${formatPeso(MAX_MONEY)}.`)
    .refine((v) => hasAtMostDecimals(v, 2), TWO_DECIMALS_MESSAGE),
).transform(roundMoney);

export const PROGRESS_WEIGHTINGS = ["cost", "hours"] as const;

const projectFields = z.object({
  name: z
    .string({ error: "Enter a project name." })
    .trim()
    .min(1, "Enter a project name.")
    .min(3, "Use at least 3 characters for the project name.")
    .max(120, "Use 120 characters or fewer for the project name."),
  startDate: dateField("start date"),
  endDate: dateField("end date"),
  budget: budgetField,
  siteName: optionalText(200, "site name"),
  siteAddress: optionalText(500, "site address"),
  description: optionalText(2000, "description"),
  color: z.enum(PROJECT_COLOR_KEYS, { error: "Choose one of the project colors." }),
});

export const projectCreateSchema = projectFields.superRefine(checkDateOrder);
export type ProjectCreateInput = z.input<typeof projectCreateSchema>;
export type ProjectCreateValues = z.output<typeof projectCreateSchema>;

/** Partial update: only the fields present are validated. Date order is checked when both are sent. */
export const projectUpdateSchema = projectFields
  .extend({
    weighting: z.enum(PROGRESS_WEIGHTINGS, { error: "Choose how progress is weighted: by cost or by hours." }),
  })
  .partial()
  .superRefine(checkDateOrder);
export type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;
export type ProjectUpdateValues = z.output<typeof projectUpdateSchema>;

export const projectStatusChangeSchema = z
  .object({
    status: z.enum(PROJECT_STATUSES, { error: "Choose a project status." }),
    reason: optionalText(500, "reason"),
  })
  .superRefine((value, ctx) => {
    if (projectStatusRequiresReason(value.status) && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message:
          value.status === "on_hold"
            ? "Add a reason for putting the project on hold."
            : "Add a reason for cancelling the project.",
      });
    }
  });
export type ProjectStatusChangeInput = z.input<typeof projectStatusChangeSchema>;
export type ProjectStatusChangeValues = z.output<typeof projectStatusChangeSchema>;

// ---------------------------------------------------------------------------
// Activities (spec §6.2, §10.2–10.3)
// ---------------------------------------------------------------------------

const durationField = numericField(
  z
    .number(
      numberError("Enter the duration in hours (0 for a milestone).", "Enter the duration as a number, like 16 or 7.5."),
    )
    .min(0, "Duration can't be negative. Enter 0 for a milestone.")
    .max(MAX_DURATION_HOURS, `Duration can be at most ${MAX_DURATION_HOURS.toLocaleString("en-US")} hours.`)
    .refine((v) => hasAtMostDecimals(v, 2), "Use at most 2 decimal places for the duration."),
);

const estCostField = numericField(
  z
    .number(numberError("Enter the estimated cost.", "Enter the estimated cost as a number, like 250,000.00."))
    .min(0, "Estimated cost can't be negative. Enter 0 if it isn't known yet.")
    .max(MAX_MONEY, `Estimated cost can't be more than ${formatPeso(MAX_MONEY)}.`)
    .refine((v) => hasAtMostDecimals(v, 2), TWO_DECIMALS_MESSAGE),
  0,
).transform(roundMoney);

const activityFields = z.object({
  name: z
    .string({ error: "Enter a name." })
    .trim()
    .min(1, "Enter a name.")
    .max(200, "Use 200 characters or fewer for the name."),
  description: optionalText(2000, "description"),
  startDate: dateField("start date"),
  durationHours: durationField,
  /** Optional: when omitted the server derives it from start + duration + calendar (D20). */
  endDate: optionalDateField("end date"),
  /** Empty means ₱0.00. */
  estCost: estCostField,
});

export const activityCreateSchema = activityFields
  .extend({
    parentId: z
      .guid("Choose a valid parent.")
      .nullish()
      .transform((value) => value ?? null),
  })
  .superRefine(checkDateOrder);
export type ActivityCreateInput = z.input<typeof activityCreateSchema>;
export type ActivityCreateValues = z.output<typeof activityCreateSchema>;

export const activityUpdateSchema = activityFields.partial().superRefine(checkDateOrder);
export type ActivityUpdateInput = z.input<typeof activityUpdateSchema>;
export type ActivityUpdateValues = z.output<typeof activityUpdateSchema>;

/** Progress update (spec §10.2–10.3). `previousStatus` decides whether a note is required. */
export const activityProgressSchema = z
  .object({
    status: z.enum(ACTIVITY_STATUSES, { error: "Choose a status." }),
    percent: numericField(
      z
        .number(numberError("Enter the progress (0–100).", "Enter the progress as a whole number from 0 to 100."))
        .int("Enter the progress as a whole number from 0 to 100.")
        .min(0, "Enter the progress as a whole number from 0 to 100.")
        .max(100, "Enter the progress as a whole number from 0 to 100."),
    ),
    note: optionalText(1000, "note"),
    previousStatus: z.enum(ACTIVITY_STATUSES).optional(),
  })
  .superRefine((value, ctx) => {
    const percentMessage = validateStatusPercent(value.status, value.percent);
    if (percentMessage) ctx.addIssue({ code: "custom", path: ["percent"], message: percentMessage });
    const needsNote =
      value.status === "delayed" ||
      value.status === "on_hold" ||
      (value.previousStatus !== undefined && statusChangeRequiresNote(value.previousStatus, value.status));
    if (needsNote && !value.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message:
          value.previousStatus === "completed" && value.status !== "completed"
            ? "Add a note explaining why this completed activity is being reopened."
            : "Add a note explaining the delay or hold.",
      });
    }
  });
export type ActivityProgressInput = z.input<typeof activityProgressSchema>;
export type ActivityProgressValues = z.output<typeof activityProgressSchema>;

// ---------------------------------------------------------------------------
// Working calendar (spec §7)
// ---------------------------------------------------------------------------

export const calendarSettingsSchema = z.object({
  workDays: z
    .array(
      z.coerce
        .number({ error: "Pick working days from Monday to Sunday." })
        .int("Pick working days from Monday to Sunday.")
        .min(1, "Pick working days from Monday to Sunday.")
        .max(7, "Pick working days from Monday to Sunday."),
      { error: "Choose at least one working day." },
    )
    .min(1, "Choose at least one working day.")
    .refine((days) => new Set(days).size === days.length, "Each day can be chosen only once.")
    .transform((days) => [...days].sort((a, b) => a - b)),
  hoursPerDay: numericField(
    z
      .number(numberError("Enter the working hours per day.", "Enter the hours per day as a number, like 8 or 7.5."))
      .min(1, "Hours per day must be between 1 and 24.")
      .max(24, "Hours per day must be between 1 and 24.")
      .refine((v) => hasAtMostDecimals(v, 2), "Use at most 2 decimal places for hours per day."),
  ),
  holidaysNonWorking: z.boolean({ error: "Choose whether holidays are non-working days." }),
});
export type CalendarSettingsInput = z.input<typeof calendarSettingsSchema>;
export type CalendarSettingsValues = z.output<typeof calendarSettingsSchema>;

export const CALENDAR_DATE_KINDS = ["holiday", "override_nonworking", "override_working"] as const;

/** A holiday or a per-date override (data model `calendar_dates`). Holidays need a name in `note`. */
export const calendarDateSchema = z
  .object({
    date: dateField("date"),
    kind: z.enum(CALENDAR_DATE_KINDS, { error: "Choose holiday, non-working day or working day." }),
    note: optionalText(200, "note"),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "holiday" && !value.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Enter the holiday name, like Independence Day." });
    }
  });
export type CalendarDateInput = z.input<typeof calendarDateSchema>;
export type CalendarDateValues = z.output<typeof calendarDateSchema>;

// ---------------------------------------------------------------------------
// Profile & notifications (spec §14)
// ---------------------------------------------------------------------------

export const profileUpdateSchema = z.object({
  fullName: fullNameSchema,
  avatarUrl: z
    .url({ protocol: /^https?$/, error: "Enter a web address that starts with https://." })
    .nullish()
    .transform((value) => value ?? null),
});
export type ProfileUpdateInput = z.input<typeof profileUpdateSchema>;
export type ProfileUpdateValues = z.output<typeof profileUpdateSchema>;

export const NOTIFICATION_EVENT_TYPES = [
  "invitations",
  "inspection_proposed",
  "inspection_decided",
  "inspection_reschedule_requested",
  "inspection_reminder",
  "activity_escalated",
  "activity_completed",
  "project_alerts",
  "membership_removed",
  "sync_conflicts",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const EMAIL_DIGEST_OPTIONS = ["off", "daily"] as const;

const channelPrefsSchema = z.object({
  inApp: z.boolean({ error: "Choose on or off for in-app notifications." }),
  email: z.boolean({ error: "Choose on or off for email notifications." }),
});

export const notificationPrefsSchema = z.object({
  events: z.record(z.enum(NOTIFICATION_EVENT_TYPES), channelPrefsSchema, {
    error: "Set in-app and email preferences for every notification type.",
  }),
  emailDigest: z.enum(EMAIL_DIGEST_OPTIONS, { error: "Choose off or daily for the email digest." }),
});
export type NotificationPrefsInput = z.input<typeof notificationPrefsSchema>;
export type NotificationPrefsValues = z.output<typeof notificationPrefsSchema>;

/** Defaults: everything in-app and by email, no digest. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsValues = {
  events: Object.fromEntries(
    NOTIFICATION_EVENT_TYPES.map((type) => [type, { inApp: true, email: true }]),
  ) as NotificationPrefsValues["events"],
  emailDigest: "off",
};

/** Flattens zod issues into `{ field: firstMessage }` for `ActionResult.fieldErrors`. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
