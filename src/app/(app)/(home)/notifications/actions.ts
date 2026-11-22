"use server";

/**
 * Loads an older page of the notifications list ("Show older"). Reads run as the signed-in user,
 * so RLS limits them to their own in-app notifications.
 */
import { z } from "zod";
import { failFrom, fromZodError, ok, runAction, type ActionResult } from "@/lib/action-result";
import {
  getNotificationsPage,
  parseNotificationsFilter,
  type NotificationsPage,
} from "@/server/queries/notifications-page";

const loadSchema = z.object({
  filter: z.enum(["all", "unread"]).default("all"),
  project: z.uuid().nullable().default(null),
  cursor: z.string().min(1).max(200),
});

export async function loadOlderNotifications(input: z.input<typeof loadSchema>): Promise<ActionResult<NotificationsPage>> {
  return runAction(async () => {
    const parsed = loadSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error, "Reload the page to see older notifications.");
    try {
      const page = await getNotificationsPage(parseNotificationsFilter(parsed.data), parsed.data.cursor);
      return ok(page);
    } catch (error) {
      return failFrom(error);
    }
  });
}
