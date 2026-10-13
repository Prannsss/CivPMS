import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getInitials } from "@/components/ui/initials";
import { ProjectAvatar } from "@/components/ui/project-color";
import { TopBarGreeting } from "@/components/shell/top-bar";
import { cn } from "@/lib/utils";

/** Company initials tile (the logo slot until companies can upload one, spec §4.2). */
export function CompanyMark({ name, className }: { name: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold tracking-tight sm:size-12",
        name
          ? "bg-foreground text-background"
          : "border border-dashed border-border-strong bg-surface-muted text-muted-foreground",
        className,
      )}
    >
      {name ? getInitials(name) : "?"}
    </span>
  );
}

/** Home top-bar left slot: company (small) above "Welcome back, Juan" (mockups 6–7, D31). */
export function HomeGreeting({ companyName, firstName }: { companyName: string | null; firstName: string }) {
  return (
    <TopBarGreeting
      leading={<CompanyMark name={companyName} className="hidden sm:grid" />}
      eyebrow={companyName ?? "No company yet"}
      title={<>Welcome back, {firstName}</>}
    />
  );
}

/** Project top-bar left slot: "Projects / <project name>" breadcrumb. */
export function ProjectBreadcrumb({ name, color }: { name: string; color: string | null }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-3">
      <ProjectAvatar name={name} color={color} size="md" className="hidden sm:inline-flex lg:hidden" />
      <ol className="flex min-w-0 flex-col">
        <li className="flex items-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-xs text-xs leading-4 font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring sm:text-[13px] sm:leading-5"
          >
            Projects
            <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        </li>
        <li aria-current="page" className="min-w-0">
          <span
            title={name}
            className="block truncate text-base leading-6 font-semibold tracking-[-0.01em] text-foreground sm:text-lg sm:leading-7"
          >
            {name}
          </span>
        </li>
      </ol>
    </nav>
  );
}
