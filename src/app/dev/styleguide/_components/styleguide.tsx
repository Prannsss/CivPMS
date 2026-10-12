"use client";

import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/shell/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ButtonsSection, TypographySection } from "./basics-section";
import { BadgesSection, DisplaySection } from "./display-section";
import { FeedbackSection } from "./feedback-section";
import { FormsSection } from "./forms-section";
import { NavigationSection } from "./navigation-section";
import { ShellSection } from "./shell-section";
import { TokensSection } from "./tokens-section";

const TOC = [
  { id: "tokens", label: "Color tokens" },
  { id: "typography", label: "Typography" },
  { id: "buttons", label: "Buttons" },
  { id: "forms", label: "Forms" },
  { id: "badges", label: "Badges & status" },
  { id: "display", label: "Data display" },
  { id: "feedback", label: "Feedback & overlays" },
  { id: "navigation", label: "Navigation & menus" },
  { id: "shell", label: "App shell" },
];

export function Styleguide() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Logo size="sm" priority />
          <span aria-hidden className="h-5 w-px bg-border" />
          <span className="text-sm font-medium text-muted-foreground">Design system</span>
          <Badge tone="warning" size="sm" className="hidden sm:inline-flex">
            Dev only
          </Badge>
          <div className="ml-auto">
            <ThemeToggle variant="segmented" className="hidden sm:inline-flex" />
            <ThemeToggle className="sm:hidden" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem] gap-10 px-4 sm:px-6 lg:px-8">
        <nav aria-label="Styleguide sections" className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-52 shrink-0 overflow-y-auto py-10 xl:block">
          <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
          <ul className="flex flex-col gap-0.5">
            {TOC.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground focus-ring"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 py-8 sm:py-10">
          <div className="mb-10 flex flex-col gap-3">
            <h1 className="text-display text-foreground">CivPMS design system</h1>
            <p className="max-w-3xl text-body-lg text-muted-foreground">
              Tokens, primitives and shell components for a calm, high-contrast project workspace. Brand blue{" "}
              <code className="rounded-xs bg-surface-sunken px-1 py-0.5 font-mono text-[13px]">#0866FF</code>, Poppins, white/black
              backgrounds, red for danger, yellow/orange/red for warnings. Everything here works in light and dark mode and meets
              WCAG 2.1 AA.
            </p>
          </div>
          <div className="flex flex-col gap-10">
            <TokensSection />
            <TypographySection />
            <ButtonsSection />
            <FormsSection />
            <BadgesSection />
            <DisplaySection />
            <FeedbackSection />
            <NavigationSection />
            <ShellSection />
          </div>
        </main>
      </div>
    </div>
  );
}
