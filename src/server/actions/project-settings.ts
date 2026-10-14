"use server";

/**
 * Project Settings mutations (spec §5): details with optimistic concurrency, status changes
 * (§5.2), archive (A8) and delete/restore (Owner PM, 30-day trash). Every action validates with
 * zod, calls the RPC (which checks the caller's role) and returns an ActionResult.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/domain";
import { parseNumericInput } from "@/lib/domain/money";
import { projectStatusChangeSchema, projectUpdateSchema } from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import {
  PROJECT_DETAIL_FIELDS,
  type ProjectDetailsValues,
  rpcFieldToFormField,
} from "@/components/project-settings/details-schema";

const projectId = z.uuid({ error: "This project link is not valid. Reload the page." });

const thresholdField = z.preprocess(
  (value) => parseNumericInput(value),
  z
    .number({ error: "Enter the warning threshold as a percentage, like 90." })
    .min(0.5, "Use a threshold between 50% and 100% of the budget.")
    .max(1, "Use a threshold between 50% and 100% of the budget."),
);

const detailsInputSchema = z.object({
  projectId,
  expectedVersion: z.number({ error: "Reload the page and try again." }).int().nonnegative(),
  values: projectUpdateSchema.and(z.object({ nearBudgetThreshold: thresholdField.optional() })),
});

function remapFieldErrors(fieldErrors: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fieldErrors) return undefined;
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const field = key.startsWith("values.") ? key.slice("values.".length) : key;
    out[rpcFieldToFormField(field)] = message;
  }
  return out;
}

function revalidateProject(id: string): void {
  revalidatePath(`/projects/${id}`, "layout");
  revalidatePath("/");
}

export interface SavedProjectDetails {
  version: number;
  values: ProjectDetailsValues;
}

type ProjectRow = {
  name: string;
  start_date: string;
  end_date: string;
  budget: number;
  site_name: string | null;
  site_address: string | null;
  description: string | null;
  color: ProjectDetailsValues["color"];
  weighting: ProjectDetailsValues["weighting"];
  near_budget_threshold: number;
  version: number;
};

function toDetails(row: ProjectRow): SavedProjectDetails {
  return {
    version: row.version,
    values: {
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      budget: Number(row.budget),
      siteName: row.site_name ?? "",
      siteAddress: row.site_address ?? "",
      description: row.description ?? "",
      color: row.color,
      weighting: row.weighting,
      nearBudgetThreshold: Number(row.near_budget_threshold),
    },
  };
}

/** Saves the details form. STALE_VERSION when someone else saved first (the UI offers Reload / Keep mine). */
export async function updateProjectDetails(input: {
  projectId: string;
  expectedVersion: number;
  values: Record<string, unknown>;
}): Promise<ActionResult<SavedProjectDetails>> {
  return runAction(async () => {
    const parsed = detailsInputSchema.safeParse(input);
    if (!parsed.success) {
      const failure = fromZodError(parsed.error);
      return fail(failure.error.code, failure.error.message, remapFieldErrors(failure.error.fieldErrors));
    }
    const { values } = parsed.data;
    const patch: Record<string, Json> = {};
    for (const field of PROJECT_DETAIL_FIELDS) {
      const value = values[field.form];
      if (value !== undefined) patch[field.rpc] = value as Json;
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_project", {
      p_project_id: parsed.data.projectId,
      p_patch: patch,
      p_expected_version: parsed.data.expectedVersion,
    });
    if (error) {
      const failure = failFrom(error);
      return fail(failure.error.code, failure.error.message, remapFieldErrors(failure.error.fieldErrors));
    }
    revalidateProject(parsed.data.projectId);
    return ok(toDetails(data));
  });
}

/** The current saved details and version (used by "Keep mine" after a conflict, and by Reload). */
export async function loadProjectDetails(input: { projectId: string }): Promise<ActionResult<SavedProjectDetails>> {
  return runAction(async () => {
    const parsed = z.object({ projectId }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("name, start_date, end_date, budget, site_name, site_address, description, color, weighting, near_budget_threshold, version")
      .eq("id", parsed.data.projectId)
      .maybeSingle();
    if (error) return failFrom(error);
    if (!data) return fail("NOT_FOUND");
    return ok(toDetails(data));
  });
}

const statusInputSchema = z.object({ projectId }).and(projectStatusChangeSchema);

/** Changes the status (§5.2). The database enforces who may do what and the completion rule. */
export async function changeProjectStatus(input: {
  projectId: string;
  status: ProjectStatus;
  reason?: string | null;
}): Promise<ActionResult<{ status: ProjectStatus }>> {
  return runAction(async () => {
    const parsed = statusInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_project_status", {
      p_project_id: parsed.data.projectId,
      p_status: parsed.data.status,
      p_reason: parsed.data.reason ?? undefined,
    });
    if (error) return failFrom(error);
    revalidateProject(parsed.data.projectId);
    const status = (PROJECT_STATUSES as readonly string[]).includes(data.status) ? data.status : parsed.data.status;
    return ok({ status });
  });
}

/** Archives or unarchives a Completed/Cancelled project (A8). */
export async function setProjectArchived(input: {
  projectId: string;
  archived: boolean;
}): Promise<ActionResult<{ archived: boolean }>> {
  return runAction(async () => {
    const parsed = z.object({ projectId, archived: z.boolean() }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_project_archived", {
      p_project_id: parsed.data.projectId,
      p_archived: parsed.data.archived,
    });
    if (error) return failFrom(error);
    revalidateProject(parsed.data.projectId);
    return ok({ archived: data.is_archived });
  });
}

export interface DeletedProject {
  projectId: string;
  name: string;
  restoreUntil: string | null;
}

/** Moves the project to the trash (Owner PM). It can be restored for 30 days. */
export async function deleteProject(input: { projectId: string }): Promise<ActionResult<DeletedProject>> {
  return runAction(async () => {
    const parsed = z.object({ projectId }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_project", { p_project_id: parsed.data.projectId });
    if (error) return failFrom(error);
    const result = (data ?? {}) as Record<string, unknown>;
    revalidatePath("/", "layout");
    return ok({
      projectId: parsed.data.projectId,
      name: typeof result.name === "string" ? result.name : "",
      restoreUntil: typeof result.restore_until === "string" ? result.restore_until : null,
    });
  });
}

/** Undo for deleteProject (Owner PM, within 30 days). */
export async function restoreProject(input: { projectId: string }): Promise<ActionResult<{ projectId: string; name: string }>> {
  return runAction(async () => {
    const parsed = z.object({ projectId }).safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_project", { p_project_id: parsed.data.projectId });
    if (error) return failFrom(error);
    revalidatePath("/", "layout");
    return ok({ projectId: data.id, name: data.name });
  });
}
