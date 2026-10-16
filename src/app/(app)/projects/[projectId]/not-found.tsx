import Link from "next/link";
import { SearchX } from "lucide-react";
import { StatusPanel } from "@/components/app-shell/status-page";
import { Button } from "@/components/ui/button";

/** notFound() from a project tab (inside the project shell). */
export default function ProjectPageNotFound() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-12">
      <StatusPanel
        eyebrow="Not found"
        icon={<SearchX />}
        title="We couldn't find that"
        description="It may have been deleted, or you no longer have access to it. Use the project menu to go somewhere else."
        actions={
          <Button variant="outline" asChild>
            <Link href="/">Back to projects</Link>
          </Button>
        }
      />
    </div>
  );
}
