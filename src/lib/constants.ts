export const APP_NAME = "CivPMS";
export const APP_TAGLINE = "The modern project management system for engineering teams.";

/** Business timezone for "today", Delayed checks, logs and exports (spec §17.1). */
export const BUSINESS_TIMEZONE = "Asia/Manila";

/** Project card colors (mockup 7). Red/orange/yellow are excluded on purpose: they mean warnings (docs/DECISIONS.md D30). */
export const PROJECT_COLOR_KEYS = ["blue", "green", "pink", "purple", "teal", "graphite"] as const;
export type ProjectColorKey = (typeof PROJECT_COLOR_KEYS)[number];

/** Budget allocation share at which "Near Budget Limit" shows (spec §5.3, A9). */
export const NEAR_BUDGET_THRESHOLD = 0.9;

export const PASSWORD_MIN_LENGTH = 10;
export const INVITATION_TTL_DAYS = 7;
export const SOFT_DELETE_RESTORE_DAYS = 30;
export const WBS_MAX_DEPTH = 3;
