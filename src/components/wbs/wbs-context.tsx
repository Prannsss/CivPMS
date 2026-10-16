"use client";

import { createContext, useContext } from "react";
import type { CalendarIndex, DurationUnit } from "@/lib/domain";
import type { WbsActivity, WbsNode } from "./types";
import type { ActivityPatch } from "./use-wbs-controller";

export type MoveCommand = "up" | "down" | "indent" | "outdent";

/** Whether a keyboard move is possible, with the reason when it isn't. */
export type MoveAvailability = Record<MoveCommand, { ok: true } | { ok: false; reason: string }>;

/**
 * Stable handlers + display settings shared by list rows and graph nodes, so rows can be memoised
 * (500+ rows stay smooth) without threading a dozen callbacks through props.
 */
export interface WbsHandlers {
  canEdit: boolean;
  unit: DurationUnit;
  hoursPerDay: number;
  calendarIndex: CalendarIndex | null;
  update: (activity: WbsActivity, patch: ActivityPatch) => Promise<boolean>;
  addChild: (node: WbsNode) => void;
  addSibling: (node: WbsNode) => void;
  rename: (node: WbsNode) => void;
  remove: (node: WbsNode) => void;
  moveBy: (node: WbsNode, command: MoveCommand) => void;
  moveAvailability: (node: WbsNode) => MoveAvailability;
  toggle: (id: string) => void;
  draftCost: (id: string, value: number | null | undefined) => void;
}

const WbsContext = createContext<WbsHandlers | null>(null);

export const WbsProvider = WbsContext.Provider;

export function useWbs(): WbsHandlers {
  const value = useContext(WbsContext);
  if (!value) throw new Error("useWbs() must be used inside <WbsProvider>.");
  return value;
}
