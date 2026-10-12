import { describe, expect, it } from "vitest";
import * as domain from "@/lib/domain";

/** The names other features import; renaming any of them is a breaking change. */
const BINDING_EXPORTS = [
  // dates
  "parseISODate",
  "toISODate",
  "addDays",
  "diffDays",
  "isoWeekday",
  "compareISO",
  "minISO",
  "maxISO",
  "isValidISODate",
  "todayInManila",
  "yearsBetween",
  // calendar
  "createCalendarIndex",
  "isWorkingDay",
  "nextWorkingDay",
  "computeEndDate",
  "durationHoursFromDates",
  "countWorkingDays",
  "rescheduleLeaves",
  "nonWorkingReason",
  "CalendarError",
  // wbs
  "buildTree",
  "computeWbsCodes",
  "flattenTree",
  "findNode",
  "ancestorsOf",
  "descendantsOf",
  "subtreeHeight",
  "depthOf",
  "canMove",
  "countDescendantsByLevel",
  "describeDeleteImpact",
  "levelLabel",
  "childLevelLabel",
  // rollup
  "rollupTree",
  "projectRollup",
  // status
  "ACTIVITY_STATUSES",
  "activityStatusLabel",
  "validateStatusPercent",
  "derivedDelayed",
  "isEscalation",
  // project
  "PROJECT_STATUSES",
  "projectStatusLabel",
  "projectTransitions",
  "budgetAllocation",
  "projectBadges",
  "isProjectDelayed",
  // permissions
  "companyPermissions",
  "projectPermissions",
  // format
  "formatPeso",
  "formatPesoCompact",
  "formatDate",
  "formatDateRange",
  "formatDateTime",
  "formatRelativeTime",
  "formatPercent",
  "formatDuration",
  "parseDurationInput",
  "initials",
  "pluralize",
  // invite codes
  "INVITE_CODE_ALPHABET",
  "normalizeInviteCode",
  "isInviteCodeFormat",
  // schemas
  "signInSchema",
  "signUpSchema",
  "forgotPasswordSchema",
  "resetPasswordSchema",
  "onboardingProfileSchema",
  "companyNameSchema",
  "inviteCodeSchema",
  "inviteSchema",
  "projectCreateSchema",
  "projectUpdateSchema",
  "projectStatusChangeSchema",
  "activityCreateSchema",
  "activityUpdateSchema",
  "calendarSettingsSchema",
  "calendarDateSchema",
  "profileUpdateSchema",
  "notificationPrefsSchema",
  // errors
  "DomainError",
] as const;

describe("@/lib/domain barrel", () => {
  it.each(BINDING_EXPORTS)("exports %s", (name) => {
    expect(domain[name]).toBeDefined();
  });
});
