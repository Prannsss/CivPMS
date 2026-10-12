"use client";

import { useState } from "react";
import { CalendarDays, ClipboardCheck, Ellipsis, ListTree, MapPin, Plus, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { PageHeader } from "@/components/ui/page-header";
import { getProjectColor } from "@/components/ui/project-color";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { StatCard } from "@/components/ui/stat-card";
import { STATUS_META, StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toaster";
import { CommandPalette } from "@/components/shell/command-palette";
import { ProjectSidebar, getProjectNavItems } from "@/components/shell/project-sidebar";
import { TopBar, TopBarGreeting } from "@/components/shell/top-bar";
import { cn } from "@/lib/utils";
import { MOCK_NOTIFICATION_PROJECTS, MOCK_NOTIFICATIONS, MOCK_NOW, MOCK_PROJECTS, MOCK_USER, type MockProject } from "./mock-data";
import { PALETTE_GROUPS, PALETTE_RECENT } from "./navigation-section";
import { Demo, Section } from "./section";

/**
 * Reference implementation of the home project card (mockup 7, improved): deep gradient so white
 * text passes AA, status + derived badges, dates, progress. The projects feature owns the real one.
 */
function SampleProjectCard({ project }: { project: MockProject }) {
  const color = getProjectColor(project.color);
  const status = STATUS_META[project.status];
  const StatusIcon = status.icon;
  return (
    <a
      href="#shell"
      className={cn(
        "group relative isolate flex min-h-56 flex-col overflow-hidden rounded-2xl p-5 text-white shadow-sm",
        "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-lg focus-ring",
        color.gradient,
      )}
    >
      {/* Decorative rings + bottom scrim (scrim only darkens, so text contrast only improves). */}
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 -z-10 size-48 rounded-full border-[28px] border-white/10" />
      <span aria-hidden className="pointer-events-none absolute -top-4 -right-4 -z-10 size-20 rounded-full border-[10px] border-white/10" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-linear-to-t from-black/30 to-transparent" />

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-black/30 px-2.5 text-[11px] font-semibold">
            <StatusIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
            {status.label}
          </span>
          {project.derived.map((badge) => {
            const meta = STATUS_META[badge];
            const Icon = meta.icon;
            return (
              <span
                key={badge}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold",
                  meta.tone === "warning" ? "bg-warning text-warning-foreground" : "bg-danger text-danger-foreground",
                )}
              >
                <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
                {meta.label}
              </span>
            );
          })}
        </div>
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
          <Ellipsis className="size-4" />
        </span>
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <div className="flex flex-col gap-1">
          <h3 className="line-clamp-2 text-lg leading-6 font-semibold tracking-[-0.01em]">{project.name}</h3>
          <p className="flex items-center gap-1.5 text-[13px] leading-5">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{project.site}</span>
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-xs leading-4 font-medium tabular-nums">
          <CalendarDays aria-hidden className="size-3.5 shrink-0" />
          {project.start} – {project.end}
        </p>
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${project.progress}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums">{project.progress}%</span>
        </div>
      </div>
    </a>
  );
}

function AddProjectCard() {
  return (
    <button
      type="button"
      onClick={() => toast.info("Add project")}
      className="group flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-surface-muted p-5 text-center transition-colors hover:border-primary hover:bg-primary-soft focus-ring"
    >
      <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-105">
        <Plus aria-hidden className="size-6" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground">Add project</span>
        <span className="text-[13px] text-muted-foreground">Scope, dates and budget</span>
      </span>
    </button>
  );
}

function CompanyMark() {
  return (
    <span className="grid size-11 place-items-center rounded-xl bg-foreground text-sm font-bold tracking-tight text-background sm:size-12">
      DB
    </span>
  );
}

function HomePreview() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "attention">("all");
  const projects = MOCK_PROJECTS.filter((p) =>
    filter === "all" ? true : filter === "active" ? p.status === "active" : p.derived.length > 0,
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <TopBar
        sticky={false}
        leading={<TopBarGreeting leading={<CompanyMark />} eyebrow="Dela Cruz Builders" title="Welcome back, Juan" />}
        onSearchClick={() => setPaletteOpen(true)}
        notifications={{
          notifications: MOCK_NOTIFICATIONS,
          projects: MOCK_NOTIFICATION_PROJECTS,
          now: MOCK_NOW,
          viewAllHref: "#shell",
          onMarkAllRead: () => toast.success("All caught up"),
        }}
        user={{ user: MOCK_USER, signOut: { onSignOut: () => toast.message("Signed out (demo)") } }}
      />
      <div className="px-4 pt-4 pb-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Projects"
          description="6 projects · 3 need attention"
          actions={
            <>
              <SegmentedControl
                aria-label="Filter projects"
                value={filter}
                onValueChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: "Active" },
                  { value: "attention", label: "Needs attention" },
                ]}
              />
              <Button>
                <Plus aria-hidden />
                Add project
              </Button>
            </>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((project) => (
            <SampleProjectCard key={project.id} project={project} />
          ))}
          <AddProjectCard />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={PALETTE_GROUPS} recent={PALETTE_RECENT} enableShortcut={false} />
    </div>
  );
}

function ProjectWorkspacePreview() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const project = MOCK_PROJECTS[0];
  const sidebarProps = {
    project: { name: project.name, color: project.color, status: project.status, derivedBadges: project.derived },
    items: getProjectNavItems(project.id),
    activeId: "dashboard",
    allProjectsHref: "#shell",
    signOut: { onSignOut: () => toast.message("Signed out (demo)") },
  };
  return (
    <div className="flex overflow-hidden rounded-2xl border border-border bg-background shadow-sm lg:h-[46rem]">
      <div className={cn("hidden shrink-0 p-3 pr-0 transition-[width] duration-200 lg:block", collapsed ? "w-[5.75rem]" : "w-[18.5rem]")}>
        <ProjectSidebar
          {...sidebarProps}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          className="rounded-2xl shadow-md dark:border dark:border-sidebar-border"
        />
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="border-sidebar-border bg-sidebar-bg p-0"
          closeClassName="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg focus-visible:outline-sidebar-fg"
        >
          <SheetTitle className="sr-only">{project.name} navigation</SheetTitle>
          <SheetDescription className="sr-only">Project sections</SheetDescription>
          <ProjectSidebar {...sidebarProps} mode="sheet" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <TopBar
          sticky={false}
          onMenuClick={() => setMobileOpen(true)}
          onSearchClick={() => {}}
          leading={<TopBarGreeting eyebrow="Projects" title={project.name} />}
          notifications={{ notifications: MOCK_NOTIFICATIONS, now: MOCK_NOW, onMarkAllRead: () => {} }}
          user={{ user: MOCK_USER, signOut: { onSignOut: () => {} } }}
        />
        <div className="flex flex-col gap-6 px-4 pt-2 pb-8 sm:px-6 lg:px-8">
          <PageHeader
            className="pb-0 sm:pb-0"
            title="Dashboard"
            description="Talisay, Cebu · 12 Jan 2026 – 30 Jun 2027"
            meta={<StatusBadge status="active" />}
            actions={
              <>
                <Button variant="outline">Export</Button>
                <Button>
                  <ClipboardCheck aria-hidden />
                  Propose inspection
                </Button>
              </>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <StatCard label="Overall progress" value="42.0%" icon={<TrendingUp />} delta={{ value: "+3.1%", trend: "up", sentiment: "positive" }} hint="vs 45.5% planned" />
            <StatCard label="Budget allocated" value="₱82.4M" icon={<Wallet />} tone="info" hint="of ₱120M" />
            <StatCard label="Delayed activities" value="3" icon={<ListTree />} tone="danger" hint="2.1 Bored piles +2 more" />
            <StatCard label="Next inspection" value="14 Oct" icon={<ClipboardCheck />} tone="success" hint="Rebar, Footing F-12" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Budget</CardTitle>
                <CardDescription>Σ leaf estimated cost vs project budget</CardDescription>
              </CardHeader>
              <CardContent>
                <Meter allocated={project.allocated} budget={project.budget} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
                <CardDescription>Activities past their end date</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {[
                  ["2.1", "Bored piles", "delayed"],
                  ["2.1.1", "Rebar inspection, F-12", "on_hold"],
                ].map(([code, name, status]) => (
                  <div key={code} className="flex items-center gap-3">
                    <span className="w-12 font-mono text-xs text-muted-foreground">{code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <StatusBadge status={status as "delayed" | "on_hold"} size="sm" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShellSection() {
  return (
    <Section
      id="shell"
      title="App shell"
      description="TopBar, NotificationBell, UserMenu, CommandPalette and ProjectSidebar composed like the real screens (mockups 6–8). HomeShell and ProjectShell wrap exactly this."
    >
      <Demo title="Home — projects (mockup 7)" bodyClassName="border-0 bg-transparent p-0 sm:p-0">
        <HomePreview />
      </Demo>
      <Demo
        title="Project workspace (mockup 8)"
        description="Blue sidebar with white active pill, Soon tags and red Log out. Collapses to icons on desktop; becomes a drawer below 1024px (hamburger)."
        bodyClassName="border-0 bg-transparent p-0 sm:p-0"
      >
        <ProjectWorkspacePreview />
      </Demo>
    </Section>
  );
}
