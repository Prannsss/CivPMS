"use server";

/**
 * Notification mutations for the bell (spec §14). Marking read only touches the caller's own
 * rows (`mark_notifications_read` is scoped to auth.uid() in the database).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";

const markReadSchema = z.object({
  /** Omit to mark every notification read ("Mark all as read"). */
  ids: z.array(z.uuid({ error: "Pick notifications from the list." })).min(1).max(200).optional(),
});

export type MarkNotificationsReadInput = z.input<typeof markReadSchema>;

/** Marks the given notifications (or all of the caller's) as read. Returns how many changed. */
export async function markNotificationsRead(
  input: MarkNotificationsReadInput = {},
): Promise<ActionResult<{ marked: number }>> {
  return runAction(async () => {
    const parsed = markReadSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "mark_notifications_read",
      parsed.data.ids ? { p_ids: parsed.data.ids } : {},
    );
    if (error) return failFrom(error);

    revalidatePath("/notifications");
    return ok({ marked: typeof data === "number" ? data : 0 });
  });
}
