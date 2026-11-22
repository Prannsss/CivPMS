import type { Metadata } from "next";
import { NotificationsView } from "@/components/notifications-page/notifications-view";
import { requireOnboarded } from "@/server/context";
import {
  getNotificationsOverview,
  getNotificationsPage,
  parseNotificationsFilter,
} from "@/server/queries/notifications-page";

export const metadata: Metadata = { title: "Notifications" };

/** All your notifications (spec §14), newest first, with filters in the URL. */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await requireOnboarded();
  const params = await searchParams;
  const filter = parseNotificationsFilter({ filter: params.filter, project: params.project });
  const [page, overview] = await Promise.all([getNotificationsPage(filter), getNotificationsOverview()]);
  const key = `${filter.unread ? "unread" : "all"}:${filter.projectId ?? "all"}`;
  return <NotificationsView key={key} page={page} filter={filter} overview={overview} now={new Date().toISOString()} />;
}
