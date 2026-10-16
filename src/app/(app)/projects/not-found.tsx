import type { Metadata } from "next";
import Link from "next/link";
import { FolderSearch } from "lucide-react";
import { StatusPage, StatusPanel } from "@/components/app-shell/status-page";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Project not found" };

/**
 * A project that doesn't exist, was deleted, or isn't shared with you. RLS hides other
 * companies' projects entirely, so "not found" and "no access" look the same on purpose.
 */
export default function ProjectNotFound() {
  return (
    <StatusPage>
      <StatusPanel
        eyebrow="Project not available"
        icon={<FolderSearch />}
        title="We couldn't open that project"
        description="It may have been deleted, or it hasn't been shared with you. If you need access, ask the project's Project Manager to invite you."
        actions={
          <Button asChild>
            <Link href="/">Back to projects</Link>
          </Button>
        }
      />
    </StatusPage>
  );
}
