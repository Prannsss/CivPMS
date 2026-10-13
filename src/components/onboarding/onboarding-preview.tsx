"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Bell, Check, MailCheck, Search } from "lucide-react";
import { greetingName } from "@/components/app-shell/greeting-name";
import { AuthShowcasePanel } from "@/components/auth/auth-showcase";
import { getInitials } from "@/components/ui/initials";
import { cn } from "@/lib/utils";

export type OnboardingRoleChoice = "pm" | "inspector";

export type OnboardingPreviewState = {
  step: 1 | 2 | 3;
  name: string;
  role: OnboardingRoleChoice | null;
  companyName: string;
};

type PreviewContextValue = {
  state: OnboardingPreviewState;
  setState: (state: OnboardingPreviewState) => void;
};

const INITIAL: OnboardingPreviewState = { step: 1, name: "", role: null, companyName: "" };

const PreviewContext = createContext<PreviewContextValue | null>(null);

/** Shares what the visitor types in onboarding with the live preview in the brand panel. */
export function OnboardingPreviewProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingPreviewState>(INITIAL);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** Setter for the onboarding flow (no-op outside the provider). */
export function useOnboardingPreview(): (state: OnboardingPreviewState) => void {
  return useContext(PreviewContext)?.setState ?? noop;
}

function noop() {}

/** "Engr. Juan Dela Cruz" → "JC" (titles and tags skipped, like the greeting). */
function personInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const first = greetingName(clean);
  const tokens = clean.split(/\s+/);
  const last = tokens[tokens.length - 1];
  const start = tokens.indexOf(first);
  if (start === -1 || start === tokens.length - 1) return getInitials(first);
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

/**
 * The right-hand panel during onboarding: a live preview of the home screen they are setting up
 * ("Welcome back, Juan" under their company) and the remaining steps.
 */
export function OnboardingAside() {
  const state = useContext(PreviewContext)?.state ?? INITIAL;
  const firstName = state.name.trim() ? greetingName(state.name) : "there";
  const company = state.role === "pm" ? state.companyName.trim() : "";
  const companyLabel = state.role === "inspector" ? "Your team's company" : company || "Your company";

  const steps = [
    { label: "Your name", done: state.step > 1 },
    { label: "Your role", done: state.step > 2 },
    { label: state.role === "inspector" ? "Join your team" : "Your company", done: false },
  ];

  return (
    <AuthShowcasePanel>
      <div className="mt-10 flex max-w-[34rem] flex-col gap-3 xl:mt-12">
        <p className="text-h1 text-balance text-white">Your workspace is taking shape.</p>
        <p className="text-body-lg text-pretty text-white">
          A few details and CivPMS is ready: your projects, budgets and inspections in one place.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center py-8">
        <div
          aria-hidden
          className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-surface text-foreground shadow-lg ring-1 ring-black/5 select-none dark:ring-white/10"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold tracking-tight transition-colors",
                company ? "bg-foreground text-background" : "border border-dashed border-border-strong bg-surface-muted text-muted-foreground",
              )}
            >
              {company ? getInitials(company) : "?"}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[11px] leading-4 font-medium text-muted-foreground">{companyLabel}</span>
              <span className="truncate text-sm leading-5 font-semibold">Welcome back, {firstName}</span>
            </span>
            <span className="hidden h-8 w-28 items-center gap-1.5 rounded-full bg-surface-sunken px-3 text-[11px] text-muted-foreground xl:flex">
              <Search className="size-3" /> Search
            </span>
            <span className="grid size-8 place-items-center rounded-full bg-surface-sunken text-muted-foreground">
              <Bell className="size-3.5" />
            </span>
            <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-text">
              {personInitials(state.name)}
            </span>
          </div>
          <div className="flex flex-col gap-3 bg-surface-muted p-4">
            <span className="text-[13px] leading-5 font-semibold">Projects</span>
            {state.role === "inspector" && !company ? (
              <div className="flex h-24 items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
                  <MailCheck className="size-4" />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] leading-5 font-semibold">Your projects appear here</span>
                  <span className="text-xs leading-4 text-muted-foreground">
                    Once you accept an invitation or enter a code.
                  </span>
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(["from-project-blue to-project-blue-to", "from-project-teal to-project-teal-to"] as const).map(
                  (gradient, index) => (
                    <div
                      key={gradient}
                      className={cn("flex h-24 flex-col justify-end gap-1.5 rounded-xl bg-linear-to-b p-3", gradient)}
                    >
                      <span className={cn("h-2 rounded-full bg-white/80", index === 0 ? "w-3/4" : "w-2/3")} />
                      <span className="h-1.5 w-1/2 rounded-full bg-white/50" />
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ol className="grid grid-cols-3 gap-4 border-t border-white/20 pt-6">
        {steps.map((step, index) => {
          const current = !step.done && (index === 0 || steps[index - 1].done);
          return (
            <li key={step.label} className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ring-1 transition-colors",
                  step.done
                    ? "bg-white text-primary-text ring-white"
                    : current
                      ? "bg-white/20 text-white ring-white"
                      : "bg-transparent text-white ring-white/40",
                )}
              >
                {step.done ? <Check aria-hidden className="size-4" strokeWidth={3} /> : index + 1}
              </span>
              <span className={cn("text-sm leading-5", current ? "font-semibold" : "font-medium")}>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </AuthShowcasePanel>
  );
}
