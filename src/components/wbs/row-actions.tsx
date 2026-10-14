"use client";

import {
  ArrowDown,
  ArrowUp,
  IndentDecrease,
  IndentIncrease,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@/components/ui";
import { childLevelLabel, levelLabel } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWbs, type MoveCommand } from "./wbs-context";
import type { WbsNode } from "./types";

const MOVE_ITEMS: { command: MoveCommand; label: string; icon: React.ReactNode }[] = [
  { command: "up", label: "Move up", icon: <ArrowUp /> },
  { command: "down", label: "Move down", icon: <ArrowDown /> },
  { command: "indent", label: "Indent (make sub-item)", icon: <IndentIncrease /> },
  { command: "outdent", label: "Outdent (move up a level)", icon: <IndentDecrease /> },
];

/** Row actions: add child / sibling, rename, keyboard-friendly moves and delete (managers only). */
export function RowActions({ node, className, size = "sm" }: { node: WbsNode; className?: string; size?: "sm" | "md" }) {
  const wbs = useWbs();
  if (!wbs.canEdit) return null;
  const childLabel = childLevelLabel(node.level);
  const ownLabel = levelLabel(node.level);
  const availability = wbs.moveAvailability(node);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size={size}
          aria-label={`Actions for ${node.wbsCode} ${node.name}`}
          tooltip={false}
          className={cn("nodrag nopan", className)}
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate">
          {node.wbsCode} {node.name}
        </DropdownMenuLabel>
        {childLabel ? (
          <DropdownMenuItem onSelect={() => wbs.addChild(node)}>
            <Plus /> Add {childLabel.toLowerCase()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => wbs.addSibling(node)}>
          <Plus /> Add {ownLabel.toLowerCase()} below
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => wbs.rename(node)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {MOVE_ITEMS.map((item) => {
          const state = availability[item.command];
          return (
            <DropdownMenuItem
              key={item.command}
              disabled={!state.ok}
              onSelect={() => wbs.moveBy(node, item.command)}
              title={state.ok ? undefined : state.reason}
            >
              {item.icon}
              <span className="flex min-w-0 flex-col">
                <span>{item.label}</span>
                {!state.ok ? <span className="truncate text-xs text-muted-foreground">{state.reason}</span> : null}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={() => wbs.remove(node)}>
          <Trash2 /> Delete {ownLabel.toLowerCase()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
