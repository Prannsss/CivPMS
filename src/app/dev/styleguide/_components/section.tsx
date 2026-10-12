import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-border pt-10 pb-4 first:border-t-0 first:pt-0">
      <div className="mb-6 flex flex-col gap-1.5">
        <h2 id={`${id}-title`} className="text-h2 text-foreground">
          {title}
        </h2>
        {description ? <p className="max-w-3xl text-body text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}

/** A labelled demo area. */
export function Demo({
  title,
  description,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-label text-foreground">{title}</h3>
        {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
      </div>
      <div className={cn("min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-6", bodyClassName)}>{children}</div>
    </div>
  );
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>;
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-caption text-muted-foreground">{children}</p>;
}
