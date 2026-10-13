import type { Metadata } from "next";
import { History } from "lucide-react";
import { ScreenPlaceholder } from "@/components/app-shell/screen-placeholder";
import { getProjectAccess } from "@/server/context";

export const metadata: Metadata = { title: "Audit Trail" };

/** Placeholder: the audit team replaces this page (spec §10.6). */
export default async function AuditPage({ params }: PageProps<"/projects/[projectId]/audit">) {
  const { projectId } = await params;
  await getProjectAccess(projectId);
  return (
    <ScreenPlaceholder
      title="Audit Trail"
      description="Every change, who made it and when"
      icon={<History />}
      upcoming="An append-only history of this project: edits, status changes, moves and deletions, with filters and export."
    />
  );
}
