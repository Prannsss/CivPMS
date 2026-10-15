/**
 * Project details form (spec §5.1, §6.5, §5.3): shared by the client form and the Server Action.
 * Pure: zod + field mapping between form names (camelCase) and `update_project` patch keys.
 */
import { z } from "zod";
import type { ProjectColorKey } from "@/lib/constants";
import { parseNumericInput } from "@/lib/domain/money";
import { PROGRESS_WEIGHTINGS, projectCreateSchema } from "@/lib/domain/schemas";

export interface ProjectDetailsValues {
  name: string;
  startDate: string;
  endDate: string;
  budget: number;
  siteName: string;
  siteAddress: string;
  description: string;
  color: ProjectColorKey;
  weighting: (typeof PROGRESS_WEIGHTINGS)[number];
  /** Fraction 0.5–1 (stored as `near_budget_threshold`). */
  nearBudgetThreshold: number;
}

/** Form field ↔ RPC patch key. */
export const PROJECT_DETAIL_FIELDS = [
  { form: "name", rpc: "name" },
  { form: "startDate", rpc: "start_date" },
  { form: "endDate", rpc: "end_date" },
  { form: "budget", rpc: "budget" },
  { form: "siteName", rpc: "site_name" },
  { form: "siteAddress", rpc: "site_address" },
  { form: "description", rpc: "description" },
  { form: "color", rpc: "color" },
  { form: "weighting", rpc: "weighting" },
  { form: "nearBudgetThreshold", rpc: "near_budget_threshold" },
] as const;

const RPC_TO_FORM: Record<string, string> = Object.fromEntries(PROJECT_DETAIL_FIELDS.map((f) => [f.rpc, f.form]));

/** `near_budget_threshold` → `nearBudgetThreshold` (RPC `hint` names); unknown names pass through. */
export function rpcFieldToFormField(field: string): string {
  return RPC_TO_FORM[field] ?? field;
}

/** What the form edits: the threshold is shown as a whole percentage (50–100). */
export const detailsFormSchema = projectCreateSchema.and(
  z.object({
    weighting: z.enum(PROGRESS_WEIGHTINGS, { error: "Choose how progress is weighted: by cost or by hours." }),
    thresholdPercent: z.preprocess(
      (value) => parseNumericInput(value) ?? undefined,
      z
        .number({ error: "Enter a percentage between 50 and 100, like 90." })
        .int("Use a whole percentage, like 90.")
        .min(50, "Use at least 50%. Lower values would warn on almost every project.")
        .max(100, "Use 100% or less. Above 100% the budget is already exceeded."),
    ),
  }),
);

export type DetailsFormInput = z.input<typeof detailsFormSchema>;
export type DetailsFormValues = z.output<typeof detailsFormSchema>;

/** Saved values → form defaults. */
export function toFormDefaults(values: ProjectDetailsValues): DetailsFormInput {
  return {
    name: values.name,
    startDate: values.startDate,
    endDate: values.endDate,
    budget: values.budget,
    siteName: values.siteName,
    siteAddress: values.siteAddress,
    description: values.description,
    color: values.color,
    weighting: values.weighting,
    thresholdPercent: Math.round(values.nearBudgetThreshold * 100),
  };
}

/** Parsed form → the values the action saves. */
export function fromFormValues(values: DetailsFormValues): ProjectDetailsValues {
  return {
    name: values.name,
    startDate: values.startDate,
    endDate: values.endDate,
    budget: values.budget,
    siteName: values.siteName ?? "",
    siteAddress: values.siteAddress ?? "",
    description: values.description ?? "",
    color: values.color,
    weighting: values.weighting,
    nearBudgetThreshold: values.thresholdPercent / 100,
  };
}
