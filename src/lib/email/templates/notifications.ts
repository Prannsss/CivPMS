/**
 * Notification emails for the outbox (`claim_email_batch` rows). The database already writes a
 * human `title` and `body` (with names and amounts); templates add structure from `payload` and a
 * button to the relevant page. Unknown types use the generic template.
 */
import { APP_NAME } from "@/lib/constants";
import { formatDate, formatPeso, roundMoney } from "@/lib/domain";
import { absoluteUrl, singleLine } from "./escape";
import { invitationEmail } from "./invitation";
import { renderEmailHtml, renderEmailText, type EmailLayoutInput, type Paragraph } from "./layout";
import { roleLabel, statusLabel, type RenderedEmail } from "./types";

/** The fields of a `claim_email_batch()` row that rendering needs. */
export interface NotificationEmailRow {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: unknown;
  recipient_name?: string | null;
  recipient_email?: string | null;
}

export interface NotificationEmailContext {
  appUrl: string;
}

type Template = (row: NotificationEmailRow, ctx: NotificationEmailContext) => RenderedEmail;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function payloadOf(row: NotificationEmailRow): Record<string, unknown> {
  const p = row.payload;
  return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

function str(payload: Record<string, unknown>, key: string, max = 120): string | undefined {
  const value = payload[key];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = singleLine(value, max);
  return cleaned === "" ? undefined : cleaned;
}

function num(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function greeting(row: NotificationEmailRow): string {
  const name = singleLine(row.recipient_name, 80);
  const first = name && !name.includes("@") ? name.split(" ")[0] : "";
  return first ? `Hi ${first},` : "Hi there,";
}

function bodyParagraphs(row: NotificationEmailRow): Paragraph[] {
  const body = (row.body ?? "").trim();
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

interface BuildInput {
  heading: string;
  preheader?: string;
  paragraphs?: Paragraph[];
  details?: { label: string; value: string | undefined }[];
  callout?: EmailLayoutInput["callout"];
  cta: { label: string; path: string | null | undefined };
  notes?: string[];
  reason: string;
  tag: string;
}

function build(row: NotificationEmailRow, ctx: NotificationEmailContext, input: BuildInput): RenderedEmail {
  const heading = singleLine(input.heading, 150) || APP_NAME;
  const paragraphs: Paragraph[] = [greeting(row), ...(input.paragraphs ?? bodyParagraphs(row))];
  const details = (input.details ?? [])
    .filter((d): d is { label: string; value: string } => typeof d.value === "string" && d.value !== "")
    .map((d) => ({ label: d.label, value: d.value }));

  const layout: EmailLayoutInput = {
    appUrl: ctx.appUrl,
    preheader: input.preheader || singleLine(row.body, 140) || heading,
    heading,
    paragraphs,
    details,
    callout: input.callout,
    cta: { label: input.cta.label, url: absoluteUrl(ctx.appUrl, input.cta.path ?? row.link ?? "/") },
    notes: input.notes,
    footer: { reason: input.reason, manageSettings: true },
  };

  return {
    subject: singleLine(row.title, 150) || heading,
    html: renderEmailHtml(layout),
    text: renderEmailText(layout),
    tags: [input.tag],
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** `invitation_received`: an existing user was invited (no token; the app lists the invitation). */
export const invitationReceivedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return invitationEmail({
    appUrl: ctx.appUrl,
    email: row.recipient_email ?? "your email address",
    inviterName: str(p, "inviter_name", 80),
    companyName: str(p, "company_name") ?? "their company",
    projectName: str(p, "project_name") ?? "a project",
    role: str(p, "role", 40) ?? "",
    expiresAt: str(p, "expires_at", 60),
    link: row.link ?? "/",
  });
};

export const invitationAcceptedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    details: [
      { label: "Project", value: str(p, "project_name") },
      { label: "Role", value: p.role ? roleLabel(p.role) : undefined },
    ],
    cta: { label: "View collaborators", path: row.link },
    reason: "you sent this invitation",
    tag: "invitation_accepted",
  });
};

export const invitationDeclinedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    details: [{ label: "Project", value: str(p, "project_name") }],
    cta: { label: "View collaborators", path: row.link },
    notes: ["You can invite someone else, or send a new invitation if this was a mistake."],
    reason: "you sent this invitation",
    tag: "invitation_declined",
  });
};

export const memberJoinedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    details: [
      { label: "Joined", value: str(p, "project_name") ?? str(p, "company_name") },
      { label: "Invite code", value: str(p, "code", 20) },
    ],
    cta: { label: "View team", path: row.link },
    notes: ["If you didn't expect this person, remove them from the team and turn the code off."],
    reason: "you created the invite code they used",
    tag: "member_joined",
  });
};

export const addedToProjectEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    details: [
      { label: "Project", value: str(p, "project_name") },
      { label: "Your role", value: p.role ? roleLabel(p.role) : undefined },
    ],
    cta: { label: "Open project", path: row.link },
    reason: "your project access changed",
    tag: "added_to_project",
  });
};

export const removedFromProjectEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    callout: { tone: "neutral", text: "You no longer have access to this project." },
    details: [{ label: "Project", value: str(p, "project_name") }],
    cta: { label: `Open ${APP_NAME}`, path: row.link ?? "/" },
    notes: ["If you think this is a mistake, contact the project's PM."],
    reason: "your project access changed",
    tag: "removed_from_project",
  });
};

export const removedFromCompanyEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  return build(row, ctx, {
    heading: row.title,
    callout: { tone: "neutral", text: "You no longer have access to this company's projects." },
    details: [{ label: "Company", value: str(p, "company_name") }],
    cta: { label: `Open ${APP_NAME}`, path: row.link ?? "/" },
    notes: ["You can still sign in. Join another company with an invite code or an invitation."],
    reason: "your company membership changed",
    tag: "removed_from_company",
  });
};

export const budgetExceededEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  const budget = num(p, "budget");
  const allocated = num(p, "allocated");
  const over = budget !== undefined && allocated !== undefined ? roundMoney(allocated - budget) : undefined;
  return build(row, ctx, {
    heading: row.title,
    callout: {
      tone: "danger",
      text: over !== undefined && over > 0 ? `Budget exceeded by ${formatPeso(over)}` : "Budget exceeded",
    },
    details: [
      { label: "Project", value: str(p, "project_name") },
      { label: "Budget", value: budget !== undefined ? formatPeso(budget) : undefined },
      { label: "Allocated cost", value: allocated !== undefined ? formatPeso(allocated) : undefined },
    ],
    cta: { label: "Review budget", path: row.link },
    notes: ["Lower activity costs in the WBS or raise the project budget to clear this alert."],
    reason: "you manage this project",
    tag: "project_budget_exceeded",
  });
};

export const projectDelayedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  const endDate = str(p, "end_date", 20);
  return build(row, ctx, {
    heading: row.title,
    callout: { tone: "danger", text: "Delayed: the planned end date has passed." },
    details: [
      { label: "Project", value: str(p, "project_name") },
      { label: "Planned end", value: endDate ? formatDate(endDate) : undefined },
    ],
    cta: { label: "Review schedule", path: row.link },
    notes: ["Moving the end date to today or later clears the Delayed badge."],
    reason: "you manage this project",
    tag: "project_delayed",
  });
};

export const projectStatusChangedEmail: Template = (row, ctx) => {
  const p = payloadOf(row);
  const to = typeof p.to === "string" ? p.to : "";
  const tone = to === "on_hold" ? "warning" : to === "cancelled" ? "neutral" : "info";
  return build(row, ctx, {
    heading: row.title,
    callout: to ? { tone, text: `Status: ${statusLabel(to)}` } : undefined,
    details: [
      { label: "Project", value: str(p, "project_name") },
      { label: "From", value: p.from ? statusLabel(p.from) : undefined },
      { label: "To", value: to ? statusLabel(to) : undefined },
      { label: "Reason", value: str(p, "reason", 500) },
    ],
    cta: { label: "Open project", path: row.link },
    reason: "you're on this project's team",
    tag: "project_status_changed",
  });
};

/** Fallback for any type without a dedicated template. */
export const genericNotificationEmail: Template = (row, ctx) =>
  build(row, ctx, {
    heading: row.title,
    cta: { label: `Open ${APP_NAME}`, path: row.link },
    reason: `you have a ${APP_NAME} account and this notification is turned on`,
    tag: row.type ? singleLine(row.type, 50) : "notification",
  });

const TEMPLATES: Record<string, Template> = {
  invitation_received: invitationReceivedEmail,
  invitation_accepted: invitationAcceptedEmail,
  invitation_declined: invitationDeclinedEmail,
  member_joined: memberJoinedEmail,
  added_to_project: addedToProjectEmail,
  removed_from_project: removedFromProjectEmail,
  removed_from_company: removedFromCompanyEmail,
  project_budget_exceeded: budgetExceededEmail,
  project_delayed: projectDelayedEmail,
  project_status_changed: projectStatusChangedEmail,
};

/** Picks the template for `row.type` (generic fallback) and renders subject, HTML and text. */
export function renderNotificationEmail(row: NotificationEmailRow, ctx: NotificationEmailContext): RenderedEmail {
  const template = Object.prototype.hasOwnProperty.call(TEMPLATES, row.type)
    ? TEMPLATES[row.type]
    : genericNotificationEmail;
  return template(row, ctx);
}
