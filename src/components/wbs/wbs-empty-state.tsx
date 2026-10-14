"use client";

import { useState } from "react";
import { ListTree, Plus, Sparkles } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

const LEVELS = [
  { label: "Deliverable", description: "A major output of the project, like Earthworks or Drainage." },
  { label: "Sub-deliverable (optional)", description: "Groups related work inside a deliverable, like Section A." },
  {
    label: "Work package",
    description: "The work you schedule and cost: start date, duration and estimated cost. Parents add these up.",
  },
];

/** First-run WBS: explains the three levels and offers a blank start or a sample structure. */
export function WbsEmptyState({
  canEdit,
  onAdd,
  onSample,
}: {
  canEdit: boolean;
  onAdd: () => void;
  onSample: () => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <EmptyState
      data-testid="wbs-empty"
      icon={<ListTree />}
      title={canEdit ? "Break the project down into deliverables" : "No work breakdown yet"}
      description={
        canEdit
          ? "The work breakdown has up to three levels. Schedule and cost the work packages; everything above them rolls up automatically."
          : "The project's PMs haven't added deliverables yet. They'll appear here with their dates, costs and progress."
      }
      checklist={LEVELS.map((level) => ({ label: level.label, description: level.description }))}
      action={
        canEdit ? (
          <Button onClick={onAdd}>
            <Plus /> Add first deliverable
          </Button>
        ) : undefined
      }
      secondaryAction={
        canEdit ? (
          <Button
            variant="outline"
            loading={adding}
            loadingText="Adding sample…"
            onClick={async () => {
              setAdding(true);
              await onSample();
              setAdding(false);
            }}
          >
            <Sparkles /> Use sample structure
          </Button>
        ) : undefined
      }
    />
  );
}
