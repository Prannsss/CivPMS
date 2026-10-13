/**
 * Branded, responsive email layout (table-based with inline styles, as email clients require).
 *
 * Templates pass plain text only; this module escapes everything, so a name such as
 * `<script>` or `"><img onerror=…>` renders as text. Colors mirror the design tokens in
 * src/app/globals.css (emails cannot use CSS variables, so the hex values live here).
 */
import { APP_NAME } from "@/lib/constants";
import { absoluteUrl, appOrigin, escapeHtml, httpUrl } from "./escape";

/** Where people manage which emails they get (linked from every notification email footer). */
export const NOTIFICATION_SETTINGS_PATH = "/profile#notifications";

const COLORS = {
  page: "#F1F5F9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0A0A0A",
  body: "#334155",
  muted: "#475569",
  primary: "#0866FF",
  // Blue text uses the darker primary-text token: #0866FF is only 4.2:1 on primary-soft.
  primaryText: "#0656D6",
  primarySoft: "#E7F0FF",
  dangerSoft: "#FEE2E2",
  dangerText: "#B91C1C",
  warningSoft: "#FEF3C7",
  warningText: "#92400E",
  neutralSoft: "#F1F5F9",
  neutralText: "#334155",
} as const;

const FONT = "Poppins, 'Segoe UI', Roboto, Arial, Helvetica, sans-serif";

/** A run of text; `{ bold }` renders as <strong>. */
export type TextSegment = string | { bold: string };
export type Paragraph = string | TextSegment[];

export type CalloutTone = "info" | "warning" | "danger" | "neutral";

export interface EmailLayoutInput {
  appUrl: string;
  /** Hidden preview line shown by inbox lists. */
  preheader: string;
  heading: string;
  paragraphs: Paragraph[];
  details?: { label: string; value: string }[];
  callout?: { tone: CalloutTone; text: string };
  cta?: { label: string; url: string };
  /** Small print under the button. */
  notes?: string[];
  footer: {
    /** "You're receiving this email because …" (finish the sentence). */
    reason: string;
    /** Link to notification settings (off for people without an account). */
    manageSettings: boolean;
  };
}

const CALLOUT_STYLES: Record<CalloutTone, { background: string; color: string; border: string }> = {
  info: { background: COLORS.primarySoft, color: COLORS.primaryText, border: COLORS.primary },
  warning: { background: COLORS.warningSoft, color: COLORS.warningText, border: "#F59E0B" },
  danger: { background: COLORS.dangerSoft, color: COLORS.dangerText, border: "#DC2626" },
  neutral: { background: COLORS.neutralSoft, color: COLORS.neutralText, border: COLORS.border },
};

function paragraphText(paragraph: Paragraph): string {
  if (typeof paragraph === "string") return paragraph;
  return paragraph.map((segment) => (typeof segment === "string" ? segment : segment.bold)).join("");
}

function paragraphHtml(paragraph: Paragraph): string {
  if (typeof paragraph === "string") return escapeHtml(paragraph);
  return paragraph
    .map((segment) =>
      typeof segment === "string"
        ? escapeHtml(segment)
        : `<strong style="font-weight:600;color:${COLORS.text};">${escapeHtml(segment.bold)}</strong>`,
    )
    .join("");
}

function reasonSentence(reason: string): string {
  const trimmed = reason.trim().replace(/\.$/, "");
  return `You're receiving this email because ${trimmed}.`;
}

export function renderEmailHtml(input: EmailLayoutInput): string {
  const origin = appOrigin(input.appUrl);
  const logoUrl = `${origin}/brand/logo-mark.png`;
  const homeUrl = absoluteUrl(origin, "/");
  const settingsUrl = absoluteUrl(origin, NOTIFICATION_SETTINGS_PATH);
  const ctaUrl = input.cta ? httpUrl(input.cta.url, homeUrl) : null;

  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${COLORS.body};">${paragraphHtml(p)}</p>`,
    )
    .join("\n");

  const callout = input.callout
    ? (() => {
        const style = CALLOUT_STYLES[input.callout.tone];
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:separate;">
  <tr>
    <td style="background:${style.background};border-left:4px solid ${style.border};border-radius:8px;padding:12px 16px;font-family:${FONT};font-size:14px;line-height:22px;font-weight:500;color:${style.color};">${escapeHtml(input.callout.text)}</td>
  </tr>
</table>`;
      })()
    : "";

  const details =
    input.details && input.details.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border:1px solid ${COLORS.border};border-radius:12px;border-collapse:separate;">
${input.details
  .map(
    (row, index) => `  <tr>
    <td valign="top" style="padding:10px 16px;${index > 0 ? `border-top:1px solid ${COLORS.border};` : ""}font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};width:38%;">${escapeHtml(row.label)}</td>
    <td valign="top" style="padding:10px 16px;${index > 0 ? `border-top:1px solid ${COLORS.border};` : ""}font-family:${FONT};font-size:14px;line-height:22px;font-weight:500;color:${COLORS.text};">${escapeHtml(row.value)}</td>
  </tr>`,
  )
  .join("\n")}
</table>`
      : "";

  const cta =
    input.cta && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
  <tr>
    <td align="center" bgcolor="${COLORS.primary}" style="border-radius:12px;background:${COLORS.primary};">
      <a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${escapeHtml(input.cta.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 20px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener" style="color:${COLORS.primaryText};word-break:break-all;">${escapeHtml(ctaUrl)}</a></p>`
      : "";

  const notes = (input.notes ?? [])
    .map(
      (note) =>
        `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">${escapeHtml(note)}</p>`,
    )
    .join("\n");

  const settingsLine = input.footer.manageSettings
    ? `<br><a href="${escapeHtml(settingsUrl)}" target="_blank" rel="noopener" style="color:${COLORS.primaryText};text-decoration:underline;">Manage email notifications</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.heading)}</title>
<!--[if !mso]><!-->
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&amp;display=swap" rel="stylesheet">
<!--<![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${COLORS.primaryText}; }
  @media only screen and (max-width: 620px) {
    .container { width:100% !important; }
    .card-pad { padding:24px 20px !important; }
    .outer-pad { padding:16px 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
  <tr>
    <td align="center" class="outer-pad" style="padding:32px 16px;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td style="padding:0 4px 16px;">
            <a href="${escapeHtml(homeUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">
              <img src="${escapeHtml(logoUrl)}" width="36" height="36" alt="" style="display:inline-block;vertical-align:middle;width:36px;height:36px;">
              <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-family:${FONT};font-size:18px;line-height:26px;font-weight:600;color:${COLORS.text};letter-spacing:-0.01em;">${escapeHtml(APP_NAME)}</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-top:4px solid ${COLORS.primary};border-radius:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="card-pad" style="padding:32px;">
                  <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.01em;color:${COLORS.text};">${escapeHtml(input.heading)}</h1>
${callout}
${paragraphs}
${details}
${cta}
${notes}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
            ${escapeHtml(reasonSentence(input.footer.reason))}${settingsLine}
            <br><br>${escapeHtml(APP_NAME)} · Project management for engineering and construction teams
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderEmailText(input: EmailLayoutInput): string {
  const origin = appOrigin(input.appUrl);
  const lines: string[] = [APP_NAME, "", input.heading, ""];
  if (input.callout) lines.push(input.callout.text, "");
  for (const paragraph of input.paragraphs) lines.push(paragraphText(paragraph), "");
  if (input.details && input.details.length > 0) {
    for (const row of input.details) lines.push(`${row.label}: ${row.value}`);
    lines.push("");
  }
  if (input.cta) lines.push(`${input.cta.label}: ${httpUrl(input.cta.url, absoluteUrl(origin, "/"))}`, "");
  for (const note of input.notes ?? []) lines.push(note, "");
  lines.push("--", reasonSentence(input.footer.reason));
  if (input.footer.manageSettings) {
    lines.push(`Manage email notifications: ${absoluteUrl(origin, NOTIFICATION_SETTINGS_PATH)}`);
  }
  return `${lines.join("\n").trim()}\n`;
}
