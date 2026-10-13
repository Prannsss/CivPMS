import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export type ScreenPlaceholderProps = {
  /** Page title (the page's h1). */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Badges next to the title (status first). */
  meta?: React.ReactNode;
  /** Icon of the feature this screen will hold. */
  icon?: React.ReactNode;
  /** What the finished screen will let people do, in one or two plain sentences. */
  upcoming: React.ReactNode;
  /** A useful way out while the screen is being built. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
};

/**
 * Temporary body for app routes whose feature team has not shipped yet. The route, shell,
 * permissions, loading and error states are real; only this content gets replaced.
 */
export function ScreenPlaceholder({
  title,
  description,
  meta,
  icon,
  upcoming,
  action,
  secondaryAction,
}: ScreenPlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} meta={meta} />
      <EmptyState
        data-testid="screen-placeholder"
        icon={icon ?? <Construction />}
        title="This screen is being built"
        description={upcoming}
        action={action}
        secondaryAction={secondaryAction}
        className="py-14 sm:py-20"
      />
    </>
  );
}
