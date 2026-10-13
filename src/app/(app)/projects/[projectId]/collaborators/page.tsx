import type { Metadata } from "next";
import { Users } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Collaborators" };

/** Placeholder: the collaborators team replaces this page (spec §4.4). */
export default async function CollaboratorsPage({ params }: PageProps<"/projects/[projectId]/collaborators">) {
  const { projectId } = await params;
  await getProjectAccess(projectId);
  return (
    <ScreenPlaceholder
      title="Collaborators"
      description="The people on this project"
      icon={<Users />}
      upcoming="See who's on the project, invite Project Managers and inspectors by email, and share invite codes."
    />
  );
}
