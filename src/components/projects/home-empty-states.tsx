"use client";

import { useState } from "react";
import { Check, CircleCheckBig, Copy, FolderPlus, KeyRound, SearchX, UserRoundSearch, Archive } from "lucide-react";
import { InviteCodeForm } from "@/components/invitations/invite-code-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toaster";
import { FILTER_LABELS, type HomeFilter } from "./home-filters";

/** Spec §4.2: first run for a PM / Owner PM. "Not so empty": a 3-step checklist + one action. */
export function FirstRunEmptyState({ onAddProject, isOwner }: { onAddProject: () => void; isOwner: boolean }) {
  return (
    <EmptyState
      data-testid="projects-first-run"
      className="py-14 sm:py-16"
      icon={<FolderPlus />}
      title="No projects yet"
      description={
        isOwner
          ? "Set up your first project in about a minute. Deliverables, costs and your team come after."
          : "Create a project, or ask your Owner PM to add you to one. Projects you're on show up here."
      }
      checklist={[
        { label: "Create a project", description: "Name, dates and budget" },
        { label: "Add deliverables", description: "Break the work into deliverables and work packages" },
        { label: "Invite your team", description: "Add PMs and inspectors to the project" },
      ]}
      action={
        <Button onClick={onAddProject}>
          <FolderPlus aria-hidden />
          Add project
        </Button>
      }
    />
  );
}

/**
 * An inspector who belongs to a company but is on no project yet: explain who adds them, show the
 * email to share, and accept a project invite code.
 */
export function NoAssignedProjectsState({ email, companyName }: { email: string; companyName: string }) {
  const [copied, setCopied] = useState(false);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      toast.success("Email copied", { description: "Send it to your Project Manager." });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", { description: "Select the email and copy it yourself." });
    }
  }

  return (
    <section
      aria-labelledby="no-assigned-heading"
      data-testid="projects-unassigned"
      className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <span
          aria-hidden
          className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-text ring-8 ring-primary-soft/40 [&_svg]:size-7"
        >
          <UserRoundSearch />
        </span>
        <div className="flex flex-col gap-2">
          <h2 id="no-assigned-heading" className="text-h2 text-foreground">
            You haven&apos;t been added to a project yet
          </h2>
          <p className="text-body-lg text-pretty text-muted-foreground">
            You&apos;re part of {companyName}. Ask your Project Manager to add you to a project using this
            email.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-11 max-w-full min-w-0 items-center rounded-full bg-surface-sunken px-4 text-sm font-medium text-foreground sm:h-10">
            <span className="truncate">{email}</span>
          </span>
          <button
            type="button"
            onClick={copyEmail}
            className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary-text transition-colors hover:bg-primary-soft focus-ring sm:h-10"
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? "Copied" : "Copy email"}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-5 border-t border-border bg-surface-muted p-6 sm:p-8 lg:border-t-0 lg:border-l">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-surface text-foreground shadow-xs ring-1 ring-border">
            <KeyRound className="size-5" />
          </span>
          <div className="flex flex-col">
            <h2 className="text-h3 text-foreground">Have a project code?</h2>
            <p className="text-[13px] leading-5 text-muted-foreground">Enter it to join that project right away.</p>
          </div>
        </div>
        <InviteCodeForm submitVariant="outline" hint="Your PM can share a project code, like 7KQ2-M9XA." />
      </div>
    </section>
  );
}

/** Nothing matches the current segment and search. */
export function FilteredEmptyState({
  filter,
  query,
  onReset,
}: {
  filter: HomeFilter;
  query: string;
  onReset: () => void;
}) {
  const q = query.trim();
  if (!q && filter === "attention") {
    return (
      <EmptyState
        data-testid="projects-filter-empty"
        icon={<CircleCheckBig />}
        title="Nothing needs attention"
        description="No open project is delayed, over budget or near its budget limit."
        action={
          <Button variant="outline" onClick={onReset}>
            Show all projects
          </Button>
        }
      />
    );
  }
  if (!q && filter === "archived") {
    return (
      <EmptyState
        data-testid="projects-filter-empty"
        icon={<Archive />}
        title="No archived projects"
        description="Archive completed or cancelled projects to keep your list tidy. You'll find them here."
        action={
          <Button variant="outline" onClick={onReset}>
            Show all projects
          </Button>
        }
      />
    );
  }
  const where = filter === "all" ? "" : ` in “${FILTER_LABELS[filter]}”`;
  return (
    <EmptyState
      data-testid="projects-filter-empty"
      icon={<SearchX />}
      title="No projects match"
      description={
        q
          ? `Nothing${where} matches “${q}”. Check the spelling, or search by site name.`
          : `You have no projects${where} right now.`
      }
      action={
        <Button variant="outline" onClick={onReset}>
          Clear filters
        </Button>
      }
    />
  );
}
