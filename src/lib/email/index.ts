import "server-only";

/**
 * Email entry point for server code: Brevo sending, branded templates, and the invitation email
 * the app sends itself (the only email that needs the plaintext token).
 */
import { serverEnv } from "@/lib/env";
import { sendEmail, type SendEmailOptions, type SendEmailResult } from "./brevo";
import { invitationEmail } from "./templates";

export * from "./brevo";
export * from "./templates";

/** The jsonb returned by `invite_to_project` / `resend_invitation`. */
export interface InvitationRpcResult {
  invitation_id: string;
  token: string;
  resent: boolean;
  existing_user: boolean;
  email: string;
  role: string;
  company_name: string;
  project_name: string;
  inviter_name: string | null;
  expires_at: string;
}

/**
 * Emails a project invitation right after `invite_to_project` / `resend_invitation`.
 *
 * People without an account get the token link (`/invite/<token>`). People who already have an
 * account are skipped here: the database queued an `invitation_received` notification for them,
 * which the outbox sends (call `queueEmailDispatch()` from `@/server/email-dispatch`).
 */
export async function sendInvitationEmail(
  invite: InvitationRpcResult,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  if (invite.existing_user) {
    return { ok: false, skipped: true, error: "Existing user: sent through the notification outbox" };
  }
  const email = invitationEmail({
    appUrl: serverEnv().appUrl,
    email: invite.email,
    inviterName: invite.inviter_name,
    companyName: invite.company_name,
    projectName: invite.project_name,
    role: invite.role,
    expiresAt: invite.expires_at,
    token: invite.token,
  });
  return sendEmail(
    { to: { email: invite.email }, subject: email.subject, html: email.html, text: email.text, tags: email.tags },
    options,
  );
}
