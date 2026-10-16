import "server-only";

/**
 * Email invitations addressed to the signed-in user (spec §4.4). Pending and unexpired only,
 * matched on the auth email by `my_pending_invitations()`; the invitee cannot read the
 * `invitations` table itself.
 */
import { cache } from "react";
import type { ProjectRole } from "@/lib/domain/permissions";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface PendingInvitation {
  id: string;
  companyId: string;
  companyName: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  inviterName: string;
  /** ISO timestamp. */
  expiresAt: string;
  createdAt: string;
}

/** Pending invitations for the caller, newest first. */
export const getMyPendingInvitations = cache(async (): Promise<PendingInvitation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_invitations");
  if (error) {
    const appError = toAppError(error);
    throw new AppException(appError.code, appError.message, { cause: error });
  }
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      projectId: row.project_id,
      projectName: row.project_name,
      role: row.role,
      inviterName: row.inviter_name,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});
