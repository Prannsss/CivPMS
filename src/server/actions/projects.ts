"use server";

/**
 * Project mutations used by the projects home (spec §5.1, §5.2 archive, §17.2 soft delete).
 * Every action validates with zod, calls the RPC (which checks the caller's role itself), revalidates
 * the home and returns an ActionResult. RPC field hints (`start_date`, `site_name`, …) are mapped
 * onto the form's camelCase field names so errors land on the right input.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { projectCreateSchema, type ProjectCreateInput } from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/server";

const HOME_PATH = "/";

/** RPC `hint` → create-project form field. */
const FIELD_FROM_HINT: Record<string, string> = {
  name: "name",
  start_date: "startDate",
  end_date: "endDate",
  budget: "budget",
  site_name: "siteName",
  site_address: "siteAddress",
  description: "description",
  color: "color",
};

/** Re-keys snake_case field errors from the database to the form's field names. */
function mapFieldErrors(result: ReturnType<typeof failFrom>): ReturnType<typeof failFrom> {
  const fieldErrors = result.error.fieldErrors;
  if (!fieldErrors) return result;
  const mapped: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    mapped[FIELD_FROM_HINT[key] ?? key] = message;
  }
  return fail(result.error.code, result.error.message, mapped);
}

const projectIdSchema = z.object({
  projectId: z.uuid({ error: "Pick a project from the list." }),
});

export type CreatedProject = { id: string; name: string };

/** Creates a project (Owner PM or company PM); the creator becomes its PM. */
export async function createProject(input: ProjectCreateInput): Promise<ActionResult<CreatedProject>> {
  return runAction(async () => {
    const parsed = projectCreateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const values = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_project", {
      p_name: values.name,
      p_start_date: values.startDate,
      p_end_date: values.endDate,
      p_budget: values.budget,
      p_site_name: values.siteName ?? undefined,
      p_site_address: values.siteAddress ?? undefined,
      p_description: values.description ?? undefined,
      p_color: values.color,
    });
    if (error) return mapFieldErrors(failFrom(error));
    if (!data) return fail("UNEXPECTED");

    revalidatePath(HOME_PATH, "layout");
    return ok({ id: data.id, name: data.name });
  });
}

export type DeletedProject = { projectId: string; name: string; restoreUntil: string };

/** Soft-deletes a project (Owner PM only). It stays restorable for 30 days. */
export async function deleteProject(input: { projectId: string }): Promise<ActionResult<DeletedProject>> {
  return runAction(async () => {
    const parsed = projectIdSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_project", { p_project_id: parsed.data.projectId });
    if (error) return failFrom(error);

    const row = (data ?? {}) as { project_id?: unknown; name?: unknown; restore_until?: unknown };
    revalidatePath(HOME_PATH, "layout");
    return ok({
      projectId: typeof row.project_id === "string" ? row.project_id : parsed.data.projectId,
      name: typeof row.name === "string" ? row.name : "",
      restoreUntil: typeof row.restore_until === "string" ? row.restore_until : "",
    });
  });
}

/** Restores a project from the trash (Owner PM only, within 30 days, name must still be free). */
export async function restoreProject(input: { projectId: string }): Promise<ActionResult<CreatedProject>> {
  return runAction(async () => {
    const parsed = projectIdSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_project", { p_project_id: parsed.data.projectId });
    if (error) return failFrom(error);
    if (!data) return fail("UNEXPECTED");

    revalidatePath(HOME_PATH, "layout");
    return ok({ id: data.id, name: data.name });
  });
}

const archiveSchema = projectIdSchema.extend({
  archived: z.boolean({ error: "Choose archive or unarchive." }),
});

/** Archives or unarchives a completed/cancelled project (project managers, spec §5.2 A8). */
export async function setProjectArchived(input: {
  projectId: string;
  archived: boolean;
}): Promise<ActionResult<{ id: string; isArchived: boolean }>> {
  return runAction(async () => {
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_project_archived", {
      p_project_id: parsed.data.projectId,
      p_archived: parsed.data.archived,
    });
    if (error) return failFrom(error);
    if (!data) return fail("UNEXPECTED");

    revalidatePath(HOME_PATH, "layout");
    return ok({ id: data.id, isArchived: data.is_archived });
  });
}
