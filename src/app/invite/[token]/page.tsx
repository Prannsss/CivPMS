import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { AuthHeading, AuthIcon } from "@/components/auth/auth-frame";
import { InviteLanding } from "@/components/auth/invite-landing";
import { Button } from "@/components/ui/button";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth-routes";
import { getSessionContext } from "@/server/context";
import { getInvitationPreview } from "@/server/queries/onboarding";

export const metadata: Metadata = {
  title: "Project invitation",
  // Invitation links are personal: keep them out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** /invite/<token>: the link in invitation emails (spec §4.4). Works signed out. */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [invitation, session] = await Promise.all([getInvitationPreview(token), getSessionContext()]);

  if (!invitation) {
    return (
      <div className="flex flex-col gap-8" data-testid="invite-invalid">
        <AuthHeading
          eyebrow={
            <AuthIcon tone="warning">
              <LinkIcon />
            </AuthIcon>
          }
          title="This invitation link doesn't work"
          description="It may be incomplete or out of date. Open the newest invitation email, or ask the person who invited you to send a new one."
        />
        <Button size="lg" className="w-full" asChild>
          <Link href={session.user ? HOME_PATH : LOGIN_PATH}>{session.user ? "Go to CivPMS" : "Log in"}</Link>
        </Button>
      </div>
    );
  }

  return (
    <InviteLanding
      token={token}
      invitation={invitation}
      viewer={
        session.user
          ? {
              email: session.profile?.email ?? session.user.email,
              fullName: session.profile?.full_name ?? "",
              onboarded: !session.needsOnboarding,
              companyName: session.membership?.companyName ?? null,
            }
          : null
      }
    />
  );
}
