"use client";

/**
 * "Recently deleted" (spec §6, activity_trash): deleted deliverables / work packages from the last
 * 30 days, restorable at their original position. Children of a deleted parent must wait for it.
 */
import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import {
  Button,
  EmptyState,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui";
import { formatDate, formatRelativeTime, levelLabel, pluralize } from "@/lib/domain";
import type { TrashItem } from "./types";

function contents(item: TrashItem): string {
  const parts: string[] = [];
  if (item.subDeliverables > 0) parts.push(pluralize(item.subDeliverables, "sub-deliverable"));
  if (item.workPackages > 0 && item.level < 3) parts.push(pluralize(item.workPackages, "work package"));
  return parts.length > 0 ? `With ${parts.join(" and ")}` : levelLabel(item.level);
}

export function TrashSheet({
  open,
  onOpenChange,
  items,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TrashItem[];
  onRestore: (batchId: string, label?: string) => Promise<boolean>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md" data-testid="wbs-trash">
        <SheetHeader>
          <SheetTitle>Recently deleted</SheetTitle>
          <SheetDescription>Restore deleted items to where they were, within 30 days of deleting them.</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyState
              variant="plain"
              size="sm"
              icon={<History />}
              headingLevel="h3"
              title="Nothing deleted lately"
              description="Deleted deliverables and work packages stay here for 30 days, so you can bring them back."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.batchId}
                  className="flex items-start gap-3 rounded-md border border-border bg-surface p-3"
                  data-testid="wbs-trash-item"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="flex min-w-0 items-baseline gap-2 text-sm leading-5 font-medium text-foreground">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.wbsCode}</span>
                      <span className="truncate" title={item.name}>
                        {item.name}
                      </span>
                    </p>
                    <p className="text-xs leading-4 text-muted-foreground">
                      {contents(item)} · deleted {formatRelativeTime(item.deletedAt, now)}
                      {item.deletedByName ? ` by ${item.deletedByName}` : ""}
                    </p>
                    <p className="text-xs leading-4 text-muted-foreground tabular-nums">
                      {item.parentDeleted
                        ? "Its parent is deleted too — restore the parent first."
                        : `Restorable until ${formatDate(item.restoreUntil.slice(0, 10))}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={item.parentDeleted || (pending !== null && pending !== item.batchId)}
                    loading={pending === item.batchId}
                    loadingText="Restoring…"
                    aria-label={`Restore ${item.wbsCode} ${item.name}`}
                    onClick={async () => {
                      setPending(item.batchId);
                      await onRestore(item.batchId, item.name);
                      setPending(null);
                    }}
                  >
                    <RotateCcw /> Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
