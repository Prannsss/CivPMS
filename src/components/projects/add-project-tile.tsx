"use client";

import { Plus } from "lucide-react";

/** Dashed "Add project" tile at the end of the grid (mockup 6, styleguide home composition). */
export function AddProjectTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="add-project-tile"
      className="group flex h-full min-h-56 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-surface-muted p-5 text-center transition-colors duration-150 hover:border-primary hover:bg-primary-soft focus-ring"
    >
      <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-150 motion-safe:group-hover:scale-105">
        <Plus aria-hidden className="size-6" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] leading-6 font-semibold text-foreground">Add project</span>
        <span className="text-[13px] leading-5 text-muted-foreground">Name, dates and budget</span>
      </span>
    </button>
  );
}
