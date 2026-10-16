import "server-only";

/**
 * Projects the signed-in user can see, for the command palette (spec §15) and the bell's
 * per-project filter (spec §14). RLS on `project_overview` decides visibility, so results are
 * permission-aware by construction.
 */
import { cache } from "react";
import type { ProjectColorKey } from "@/lib/constants";
import { PROJECT_COLOR_KEYS } from "@/lib/constants";
import type { ProjectStatus } from "@/lib/domain/project";
import { AppException, toAppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface PaletteProject {
  id: string;
  name: string;
  color: ProjectColorKey;
  status: ProjectStatus;
  siteName: string | null;
  isArchived: boolean;
  isDelayed: boolean;
  budgetState: "ok" | "near" | "exceeded";
}

/** Upper bound for the palette; global search (later phase) covers the long tail. */
export const PALETTE_PROJECT_LIMIT = 200;

function isColor(value: unknown): value is ProjectColorKey {
  return typeof value === "string" && (PROJECT_COLOR_KEYS as readonly string[]).includes(value);
}

function toBudgetState(value: unknown): PaletteProject["budgetState"] {
  return value === "near" || value === "exceeded" ? value : "ok";
}

/** Visible, non-deleted projects: open ones first (most recently updated), archived last. */
export const getPaletteProjects = cache(async (): Promise<PaletteProject[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_overview")
    .select("id, name, color, status, site_name, is_archived, is_delayed, budget_state, updated_at")
    .order("is_archived", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(PALETTE_PROJECT_LIMIT);
  if (error) {
    const appError = toAppError(error);
    throw new AppException(appError.code, appError.message, { cause: error });
  }

  const projects: PaletteProject[] = [];
  for (const row of data ?? []) {
    if (!row.id || !row.name || !row.status) continue;
    projects.push({
      id: row.id,
      name: row.name,
      color: isColor(row.color) ? row.color : "blue",
      status: row.status,
      siteName: row.site_name,
      isArchived: row.is_archived === true,
      isDelayed: row.is_delayed === true,
      budgetState: toBudgetState(row.budget_state),
    });
  }
  return projects;
});
