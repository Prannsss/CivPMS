"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { pluralize } from "@/lib/domain/format";
import { deleteProject, restoreProject } from "@/server/actions/project-settings";

/**
 * Delete project (Owner PM, spec §17.2): type-the-name confirmation, soft delete with a 30-day
 * restore, then home with an Undo snackbar that points to Recently deleted.
 */
export function DangerZone({
  projectId,
  projectName,
  activityCount,
  memberCount,
}: {
  projectId: string;
  projectName: string;
  activityCount: number;
  memberCount: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);

  async function onDelete() {
    const impact = [
      activityCount > 0 ? pluralize(activityCount, "activity", "activities") : null,
      memberCount > 0 ? `access for ${pluralize(memberCount, "collaborator")}` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: `Delete "${projectName}"?`,
      description: `Moves the project${impact.length ? ` with ${impact.join(" and ")}` : ""} to Recently deleted. Nobody can open it until it's restored. The Owner PM can restore it within 30 days; after that it's gone for good.`,
      tone: "danger",
      confirmLabel: "Delete project",
      confirmText: projectName,
    });
    if (!ok) return;
    setPending(true);
    const result = await deleteProject({ projectId });
    if (!result.ok) {
      setPending(false);
      toast.error("Couldn't delete the project", { description: result.error.message });
      return;
    }
    router.push("/");
    toast.undo(`"${result.data.name || projectName}" moved to Recently deleted`, () => {
      void restoreProject({ projectId }).then((restored) => {
        if (!restored.ok) {
          toast.error("Couldn't restore the project", { description: restored.error.message });
          return;
        }
        toast.success("Project restored", { description: restored.data.name });
        router.push(`/projects/${restored.data.projectId}`);
      });
    }, { description: "Restore it from Recently deleted within 30 days." });
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">Delete this project</p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Removes it for everyone. Restorable for 30 days from Recently deleted; the audit trail is kept.
        </p>
      </div>
      <Button variant="danger-outline" onClick={onDelete} loading={pending} loadingText="Deleting…" className="w-full shrink-0 sm:w-auto">
        <Trash2 aria-hidden />
        Delete project
      </Button>
    </div>
  );
}
