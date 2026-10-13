import "server-only";

import { companyPermissions, companyRoleLabel } from "@/lib/domain/permissions";
import { requireOnboarded } from "@/server/context";
import { getNotificationFeed } from "@/server/queries/notifications";
import { getPaletteProjects } from "@/server/queries/palette";
import { greetingName } from "./greeting-name";
import type { ShellData, ShellViewer } from "./types";

/**
 * Everything the connected top bar needs: who is signed in (profile + company), the bell's
 * notifications and the projects for the palette. Redirects to /login or /onboarding first.
 */
export async function loadShellData(): Promise<ShellData> {
  // Start the reads before the session check resolves (they are cache()'d per request and
  // RLS-scoped, so they're safe either way). If the check redirects first, swallow their result.
  const feed = getNotificationFeed();
  const visibleProjects = getPaletteProjects();
  feed.catch(() => undefined);
  visibleProjects.catch(() => undefined);

  const context = await requireOnboarded();
  const [notifications, projects] = await Promise.all([feed, visibleProjects]);

  const email = context.profile.email ?? context.user.email ?? "";
  const name = context.profile.full_name?.trim() || email.split("@")[0] || "there";
  const membership = context.membership;
  const viewer: ShellViewer = {
    id: context.user.id,
    name,
    firstName: greetingName(name),
    email,
    avatarUrl: context.profile.avatar_url,
    company: membership
      ? {
          id: membership.companyId,
          name: membership.companyName,
          role: membership.role,
          roleLabel: companyRoleLabel(membership.role),
        }
      : null,
    permissions: companyPermissions(membership?.role ?? null),
  };

  return { viewer, notifications, projects };
}
