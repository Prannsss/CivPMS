import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { requireOnboarded } from "@/server/context";

export const metadata: Metadata = { title: "Profile" };

/** Placeholder: the profile team replaces this page. */
export default async function ProfilePage() {
  const context = await requireOnboarded();
  return (
    <ScreenPlaceholder
      title="Profile"
      description={context.profile.email ?? context.user.email ?? undefined}
      icon={<UserRound />}
      upcoming="Change your name and photo, choose hours or days for durations, and pick which notifications reach you in the app and by email."
    />
  );
}
