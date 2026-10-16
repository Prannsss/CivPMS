import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { requireOnboarded } from "@/server/context";

export const metadata: Metadata = { title: "Notifications" };

/** Placeholder: the notifications team replaces this page (spec §14). The bell already works. */
export default async function NotificationsPage() {
  await requireOnboarded();
  return (
    <ScreenPlaceholder
      title="Notifications"
      description="Invitations, project alerts and updates"
      icon={<Bell />}
      upcoming="Your full notification history with filters by project and type. Until then, the bell at the top shows your latest notifications."
    />
  );
}
