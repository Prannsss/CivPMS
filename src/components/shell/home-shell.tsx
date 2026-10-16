"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CommandPalette, type CommandPaletteProps } from "./command-palette";
import { TopBar, type TopBarProps } from "./top-bar";

export type HomeShellProps = {
  topBar: Omit<TopBarProps, "onSearchClick" | "onMenuClick">;
  /** Command palette data. Omit to hide search entirely. */
  palette?: Omit<CommandPaletteProps, "open" | "onOpenChange">;
  children: React.ReactNode;
  /** Classes for <main> (e.g. a different max width). */
  contentClassName?: string;
};

/** Home/top-bar frame (mockups 6–7): sticky header + centered content (max 80rem). */
export function HomeShell({ topBar, palette, children, contentClassName }: HomeShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar
        {...topBar}
        onSearchClick={palette ? () => setPaletteOpen(true) : undefined}
        innerClassName={cn("mx-auto max-w-[80rem]", topBar.innerClassName)}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn("mx-auto w-full max-w-[80rem] flex-1 px-4 pt-4 pb-12 outline-none sm:px-6 lg:px-8 lg:pt-6", contentClassName)}
      >
        {children}
      </main>
      {palette ? <CommandPalette {...palette} open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
    </div>
  );
}
