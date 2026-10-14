"use server";

/**
 * Work breakdown mutations (spec §6, §9.3, D20–D22). Every action validates with zod, calls the
 * WBS RPCs (which enforce manage rights, depth and concurrency in the database), revalidates the
 * project and returns an `ActionResult`. End dates are recomputed here with the project calendar
 * (D20) so the stored schedule is always authoritative.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildSampleStructure, resolveLeafSchedule, type SchedulePatch } from "@/components/wbs/model";
import { fail, failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { createCalendarIndex, isValidISODate, MAX_DURATION_HOURS } from "@/lib/domain";
import { hasAtMostDecimals, MAX_MONEY } from "@/lib/domain/money";
import type { Json } from "@/lib/supabase/database.types";
import { createClient, type ServerSupabaseClient } from "@/lib/supabase/server";
import { fetchWorkingCalendar } from "@/server/queries/calendar";
import { ACTIVITY_COLUMNS, toWbsActivity, type WbsActivity } from "@/server/queries/wbs";

const uuid = (what: string) => z.uuid({ error: `Choose a valid ${what}.` });

const isoDate = (label: string) =>
  z.string().refine(isValidISODate, `The ${label} isn't a valid date. Pick a date from the calendar.`);

const nameSchema = z
  .string({ error: "Enter a name." })
  .trim()
  .min(1, "Enter a name.")
  .max(200, "Use 200 characters or fewer for the name.");

const durationSchema = z
  .number({ error: "Enter the duration as a number, like 16 or 7.5." })
  .min(0, "Duration can't be negative. Enter 0 for a milestone.")
  .max(MAX_DURATION_HOURS, `Duration can be at most ${MAX_DURATION_HOURS.toLocaleString("en-US")} hours.`)
  .refine((v) => hasAtMostDecimals(v, 2), "Use at most 2 decimal places for the duration.");

const costSchema = z
  .number({ error: "Enter the estimated cost as a number, like 250,000.00." })
  .min(0, "Estimated cost can't be negative. Enter 0 if it isn't known yet.")
  .max(MAX_MONEY, "That cost is too large.")
  .refine((v) => hasAtMostDecimals(v, 2), "Use at most 2 decimal places (centavos).");

function wbsPath(projectId: string) {
  return `/projects/${projectId}`;
}

function revalidateProject(projectId: string) {
  // The layout carries the budget/Delayed badges, so refresh the whole project subtree.
  revalidatePath(wbsPath(projectId), "layout");
}

/** `create_activity` / `move_activity` accept NULL for "top level", but the generated types say string. */
function nullableUuid(value: string | null): string {
  return value as string;
}

async function hasChildren(supabase: ServerSupabaseClient, activityId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", activityId)
    .is("deleted_at", null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

function toSnakePatch(patch: {
  name?: string;
  description?: string | null;
  startDate?: string | null;
  durationHours?: number | null;
  endDate?: string | null;
  estCost?: number | null;
}): Record<string, Json> {
  const out: Record<string, Json> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.description !== undefined) out.description = patch.description;
  if (patch.startDate !== undefined) out.start_date = patch.startDate;
  if (patch.durationHours !== undefined) out.duration_hours = patch.durationHours;
  if (patch.endDate !== undefined) out.end_date = patch.endDate;
  if (patch.estCost !== undefined) out.est_cost = patch.estCost;
  return out;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  projectId: uuid("project"),
  parentId: uuid("parent").nullable(),
  name: nameSchema,
  index: z.number().int().min(0).nullable().optional(),
  startDate: isoDate("start date").nullable().optional(),
  durationHours: durationSchema.nullable().optional(),
  estCost: costSchema.nullable().optional(),
  /** D21: the parent is a leaf with values; move its cost, hours and dates to this first child. */
  carryFromParent: z.boolean().optional(),
});
export type CreateActivityInput = z.input<typeof createSchema>;

export interface CreateActivityResult {
  activity: WbsActivity;
  /** True when the parent's values were moved to the new child (D21). */
  carried: boolean;
}

export async function createActivity(input: CreateActivityInput): Promise<ActionResult<CreateActivityResult>> {
  return runAction(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();

    let fields: Record<string, Json> = {};
    let carried = false;
    let parent: WbsActivity | null = null;

    if (v.parentId && v.carryFromParent) {
      const { data, error } = await supabase.from("activities").select(ACTIVITY_COLUMNS).eq("id", v.parentId).maybeSingle();
      if (error) return failFrom(error);
      if (!data) return fail("PARENT_NOT_FOUND");
      parent = toWbsActivity(data);
      if (!(await hasChildren(supabase, parent.id))) {
        fields = toSnakePatch({
          startDate: parent.startDate,
          durationHours: parent.durationHours,
          endDate: parent.endDate,
          estCost: parent.estCost,
        });
        carried = true;
      }
    }

    if (!carried && (v.startDate || v.durationHours !== undefined || v.estCost !== undefined)) {
      const calendar = await fetchWorkingCalendar(supabase, v.projectId);
      const resolved = resolveLeafSchedule(
        createCalendarIndex(calendar),
        { startDate: null, durationHours: null, endDate: null },
        { startDate: v.startDate ?? null, durationHours: v.durationHours ?? null },
      );
      if (!resolved.ok) return fail("VALIDATION", resolved.message, { [resolved.field]: resolved.message });
      fields = toSnakePatch({ ...resolved.schedule, estCost: v.estCost ?? undefined });
      for (const key of Object.keys(fields)) if (fields[key] === null) delete fields[key];
    }

    const { data, error } = await supabase.rpc("create_activity", {
      p_project_id: v.projectId,
      p_parent_id: nullableUuid(v.parentId),
      p_name: v.name,
      p_index: v.index ?? undefined,
      p_fields: fields,
    });
    if (error) return failFrom(error);

    if (carried && parent) {
      // The parent's own values no longer count (D21); clear them so they can't resurface.
      await supabase.rpc("update_activity", {
        p_activity_id: parent.id,
        p_patch: { start_date: null, duration_hours: null, end_date: null, est_cost: null },
        p_expected_version: parent.version,
      });
    }

    revalidateProject(v.projectId);
    return ok({ activity: toWbsActivity(data), carried });
  });
}

// ---------------------------------------------------------------------------
// Update (inline edits, rename)
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  projectId: uuid("project"),
  activityId: uuid("activity"),
  expectedVersion: z.number().int(),
  /** "Keep mine" after STALE_VERSION: apply the patch on top of the latest version. */
  overwrite: z.boolean().optional(),
  patch: z
    .object({
      name: nameSchema.optional(),
      description: z.string().trim().max(2000, "Use 2,000 characters or fewer for the description.").nullable().optional(),
      startDate: isoDate("start date").nullable().optional(),
      durationHours: durationSchema.nullable().optional(),
      endDate: isoDate("end date").nullable().optional(),
      estCost: costSchema.nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Nothing to save."),
});
export type UpdateActivityInput = z.input<typeof updateSchema>;

export interface UpdateActivityResult {
  activity: WbsActivity;
  /** The end date was moved to the last working day of the chosen span. */
  endAdjusted: boolean;
}

export async function updateActivity(input: UpdateActivityInput): Promise<ActionResult<UpdateActivityResult>> {
  return runAction(async () => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { projectId, activityId, patch } = parsed.data;
    const supabase = await createClient();

    const { data: row, error: readError } = await supabase
      .from("activities")
      .select(ACTIVITY_COLUMNS)
      .eq("id", activityId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (readError) return failFrom(readError);
    if (!row) return fail("NOT_FOUND", "This activity was deleted or moved. Reload the page.");
    const current = toWbsActivity(row);
    const expectedVersion = parsed.data.overwrite ? current.version : parsed.data.expectedVersion;
    if (!parsed.data.overwrite && current.version !== expectedVersion) {
      return fail("STALE_VERSION");
    }

    const touchesSchedule =
      patch.startDate !== undefined || patch.durationHours !== undefined || patch.endDate !== undefined;
    const touchesValues = touchesSchedule || patch.estCost !== undefined;
    if (touchesValues && (await hasChildren(supabase, activityId))) {
      return fail(
        "VALIDATION",
        "This item has sub-items, so its dates, hours and cost come from its work packages. Edit those instead.",
      );
    }

    let endAdjusted = false;
    const dbPatch = toSnakePatch({ name: patch.name, description: patch.description, estCost: patch.estCost });
    if (touchesSchedule) {
      const calendar = await fetchWorkingCalendar(supabase, projectId);
      const schedulePatch: SchedulePatch = {};
      if (patch.startDate !== undefined) schedulePatch.startDate = patch.startDate;
      if (patch.durationHours !== undefined) schedulePatch.durationHours = patch.durationHours;
      if (patch.endDate !== undefined) schedulePatch.endDate = patch.endDate;
      const resolved = resolveLeafSchedule(createCalendarIndex(calendar), current, schedulePatch);
      if (!resolved.ok) return fail("VALIDATION", resolved.message, { [resolved.field]: resolved.message });
      endAdjusted = resolved.endAdjusted;
      Object.assign(dbPatch, toSnakePatch(resolved.schedule));
    }

    const { data, error } = await supabase.rpc("update_activity", {
      p_activity_id: activityId,
      p_patch: dbPatch,
      p_expected_version: expectedVersion,
    });
    if (error) return failFrom(error);

    revalidateProject(projectId);
    return ok({ activity: toWbsActivity(data), endAdjusted });
  });
}

// ---------------------------------------------------------------------------
// Move (drag & drop, keyboard alternatives, undo)
// ---------------------------------------------------------------------------

const moveSchema = z.object({
  projectId: uuid("project"),
  activityId: uuid("activity"),
  newParentId: uuid("parent").nullable(),
  newIndex: z.number().int().min(0).nullable(),
});
export type MoveActivityInput = z.input<typeof moveSchema>;

export interface MoveActivityResult {
  changed: boolean;
  oldWbsCode: string;
  newWbsCode: string;
}

export async function moveActivity(input: MoveActivityInput): Promise<ActionResult<MoveActivityResult>> {
  return runAction(async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("move_activity", {
      p_activity_id: v.activityId,
      p_new_parent_id: nullableUuid(v.newParentId),
      p_new_index: v.newIndex ?? undefined,
    });
    if (error) return failFrom(error);
    const result = (data ?? {}) as { changed?: boolean; old_wbs_code?: string; new_wbs_code?: string };
    revalidateProject(v.projectId);
    return ok({
      changed: result.changed === true,
      oldWbsCode: result.old_wbs_code ?? "",
      newWbsCode: result.new_wbs_code ?? "",
    });
  });
}

// ---------------------------------------------------------------------------
// Delete / restore
// ---------------------------------------------------------------------------

const deleteSchema = z.object({ projectId: uuid("project"), activityId: uuid("activity") });
export type DeleteActivityInput = z.input<typeof deleteSchema>;

export interface DeleteActivityResult {
  batchId: string;
  name: string;
  wbsCode: string;
  total: number;
}

export async function deleteActivity(input: DeleteActivityInput): Promise<ActionResult<DeleteActivityResult>> {
  return runAction(async () => {
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_activity", { p_activity_id: parsed.data.activityId });
    if (error) return failFrom(error);
    const result = (data ?? {}) as { batch_id?: string; name?: string; wbs_code?: string; total?: number };
    if (!result.batch_id) return fail("UNEXPECTED");
    revalidateProject(parsed.data.projectId);
    return ok({
      batchId: result.batch_id,
      name: result.name ?? "",
      wbsCode: result.wbs_code ?? "",
      total: typeof result.total === "number" ? result.total : 1,
    });
  });
}

const restoreSchema = z.object({ projectId: uuid("project"), batchId: uuid("deleted item") });
export type RestoreActivityInput = z.input<typeof restoreSchema>;

export async function restoreActivity(
  input: RestoreActivityInput,
): Promise<ActionResult<{ name: string; wbsCode: string; total: number }>> {
  return runAction(async () => {
    const parsed = restoreSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_activity", { p_batch_id: parsed.data.batchId });
    if (error) return failFrom(error);
    const result = (data ?? {}) as { name?: string; wbs_code?: string; total?: number };
    revalidateProject(parsed.data.projectId);
    return ok({
      name: result.name ?? "",
      wbsCode: result.wbs_code ?? "",
      total: typeof result.total === "number" ? result.total : 1,
    });
  });
}

// ---------------------------------------------------------------------------
// Sample structure (empty state)
// ---------------------------------------------------------------------------

const sampleSchema = z.object({ projectId: uuid("project") });

export async function createSampleStructure(
  input: z.input<typeof sampleSchema>,
): Promise<ActionResult<{ deliverables: number; workPackages: number }>> {
  return runAction(async () => {
    const parsed = sampleSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { projectId } = parsed.data;
    const supabase = await createClient();

    const [{ data: project, error: projectError }, { count, error: countError }] = await Promise.all([
      supabase.from("projects").select("start_date").eq("id", projectId).maybeSingle(),
      supabase.from("activities").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("deleted_at", null),
    ]);
    if (projectError) return failFrom(projectError);
    if (countError) return failFrom(countError);
    if (!project) return fail("NOT_FOUND");
    if ((count ?? 0) > 0) {
      return fail("VALIDATION", "This project already has a work breakdown. The sample is only for empty projects.");
    }

    const calendar = await fetchWorkingCalendar(supabase, projectId);
    const sample = buildSampleStructure(createCalendarIndex(calendar), project.start_date);
    let workPackages = 0;
    for (const deliverable of sample) {
      const { data: created, error } = await supabase.rpc("create_activity", {
        p_project_id: projectId,
        p_parent_id: nullableUuid(null),
        p_name: deliverable.name,
      });
      if (error) return failFrom(error);
      for (const pkg of deliverable.workPackages) {
        const { error: childError } = await supabase.rpc("create_activity", {
          p_project_id: projectId,
          p_parent_id: created.id,
          p_name: pkg.name,
          p_fields: { start_date: pkg.startDate, duration_hours: pkg.durationHours, end_date: pkg.endDate },
        });
        if (childError) return failFrom(childError);
        workPackages += 1;
      }
    }

    revalidateProject(projectId);
    return ok({ deliverables: sample.length, workPackages });
  });
}

// ---------------------------------------------------------------------------
// Hours | Days preference (spec §6.3) — stored on the profile
// ---------------------------------------------------------------------------

const unitSchema = z.object({ unit: z.enum(["hours", "days"], { error: "Choose hours or days." }) });

export async function setDurationUnit(input: z.input<typeof unitSchema>): Promise<ActionResult<{ unit: "hours" | "days" }>> {
  return runAction(async () => {
    const parsed = unitSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_profile", { p_patch: { duration_unit: parsed.data.unit } });
    if (error) return failFrom(error);
    return ok({ unit: parsed.data.unit });
  });
}
