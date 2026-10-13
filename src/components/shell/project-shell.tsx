"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CommandPalette, type CommandPaletteProps } from "./command-palette";
import { ProjectSidebar, useSidebarCollapsed, type ProjectSidebarProps } from "./project-sidebar";
import { TopBar, type TopBarProps } from "./top-bar";

export type ProjectShellProps = {
  sidebar: Omit<ProjectSidebarProps, "collapsed" | "onCollapsedChange" | "onNavigate" | "mode">;
  topBar: Omit<TopBarProps, "onSearchClick" | "onMenuClick">;
  palette?: Omit<CommandPaletteProps, "open" | "onOpenChange">;
  children: React.ReactNode;
  contentClassName?: string;
};

/**
 * Project workspace frame (mockup 8): floating blue sidebar (collapsible to icons on lg),
 * top bar and content. Below lg the sidebar becomes an off-canvas sheet opened from the
 * top bar's hamburger.
 */
export function ProjectShell({ sidebar, topBar, palette, children, contentClassName }: ProjectShellProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside
        aria-label="Project navigation"
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 p-3 pr-0 transition-[width] duration-200 ease-out lg:block",
          collapsed ? "w-[5.75rem]" : "w-[18.5rem]",
        )}
      >
        <ProjectSidebar
          {...sidebar}
          mode="rail"
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          className="rounded-2xl border border-transparent shadow-md dark:border-sidebar-border"
        />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="border-sidebar-border bg-sidebar-bg p-0 lg:hidden"
          closeClassName="text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg focus-visible:outline-sidebar-fg"
        >
          <SheetTitle className="sr-only">{sidebar.project.name} navigation</SheetTitle>
          <SheetDescription className="sr-only">Project sections</SheetDescription>
          <ProjectSidebar {...sidebar} mode="sheet" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          {...topBar}
          onMenuClick={() => setMobileOpen(true)}
          onSearchClick={palette ? () => setPaletteOpen(true) : undefined}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn("w-full flex-1 px-4 pt-2 pb-12 outline-none sm:px-6 lg:px-8 lg:pt-4", contentClassName)}
        >
          {children}
        </main>
      </div>

      {palette ? <CommandPalette {...palette} open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
    </div>
  );
}
