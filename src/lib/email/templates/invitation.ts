/**
 * Project invitation email (spec §4.4).
 *
 * - `token` set: the person has no account yet. The app sends this right after
 *   `invite_to_project` (it is the only moment the plaintext token exists); the button opens
 *   `/invite/<token>`.
 * - no `token`: the person already has an account (outbox type `invitation_received`); the
 *   button opens the app, where pending invitations are listed.
 */
import { APP_NAME } from "@/lib/constants";
import { formatDateTime } from "@/lib/domain";
import { absoluteUrl, singleLine } from "./escape";
import { renderEmailHtml, renderEmailText, type EmailLayoutInput } from "./layout";
import { roleLabel, type RenderedEmail } from "./types";

export interface InvitationEmailInput {
  appUrl: string;
  /** The invited address (the invitation only works for this email). */
  email: string;
  inviterName: string | null | undefined;
  companyName: string;
  projectName: string;
  role: string;
  expiresAt: string | null | undefined;
  /** Plaintext invitation token (new users). Omit for people who already have an account. */
  token?: string | null;
  /** App path for the button when there is no token. Defaults to "/". */
  link?: string | null;
}

export function invitationEmail(input: InvitationEmailInput): RenderedEmail {
  const inviter = singleLine(input.inviterName, 80) || "A project manager";
  const project = singleLine(input.projectName, 120) || "a project";
  const company = singleLine(input.companyName, 120) || "their company";
  const email = singleLine(input.email, 254);
  const role = roleLabel(input.role);
  const expires = formatDateTime(input.expiresAt);
  const hasExpiry = expires !== "—";
  const isNewUser = Boolean(input.token);

  const url = isNewUser
    ? absoluteUrl(input.appUrl, `/invite/${encodeURIComponent(String(input.token))}`)
    : absoluteUrl(input.appUrl, input.link ?? "/");

  const notes = isNewUser
    ? [
        `Sign up or sign in with ${email}. The invitation only works for this email address.`,
        "Not expecting this? You can ignore this email; nothing happens until you accept.",
      ]
    : [
        `Sign in to ${APP_NAME} with ${email} to accept or decline.`,
        "Not expecting this? You can decline it in the app or ignore this email.",
      ];

  const layout: EmailLayoutInput = {
    appUrl: input.appUrl,
    preheader: `${inviter} invited you to join ${project} at ${company} as ${role}.`,
    heading: `You're invited to ${project}`,
    paragraphs: [
      [{ bold: inviter }, " invited you to join ", { bold: project }, " at ", { bold: company }, ` as ${role}.`],
      `${APP_NAME} is where the team plans the work breakdown, schedule and budget for this project.`,
    ],
    details: [
      { label: "Project", value: project },
      { label: "Company", value: company },
      { label: "Your role", value: role },
      { label: "Invited by", value: inviter },
      ...(hasExpiry ? [{ label: "Expires", value: `${expires} (Philippine time)` }] : []),
    ],
    cta: { label: isNewUser ? "Accept invitation" : "Review invitation", url },
    notes,
    footer: isNewUser
      ? { reason: `${inviter} invited ${email} to a project on ${APP_NAME}`, manageSettings: false }
      : { reason: `someone invited you to a project on ${APP_NAME}`, manageSettings: true },
  };

  return {
    subject: singleLine(`${inviter} invited you to ${project} on ${APP_NAME}`, 150),
    html: renderEmailHtml(layout),
    text: renderEmailText(layout),
    tags: [isNewUser ? "invitation" : "invitation_received"],
  };
}
