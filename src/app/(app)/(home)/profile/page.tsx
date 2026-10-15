import type { Metadata } from "next";
import { ProfileView } from "@/components/profile/profile-view";
import { PageHeader } from "@/components/ui/page-header";
import { getProfilePageData } from "@/server/queries/profile";

export const metadata: Metadata = { title: "Profile" };

/** Your profile (spec §2, §14): photo, name, display preferences, notifications, password. */
export default async function ProfilePage() {
  const data = await getProfilePageData();
  return (
    <div className="flex flex-col">
      <PageHeader title="Profile" description="Your photo, name, display preferences, notifications and password." />
      <ProfileView data={data} />
    </div>
  );
}
