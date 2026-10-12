"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Command, defaultFilter } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CornerDownLeft, History, Search, SearchX } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type CommandPaletteItem = {
  id: string;
  label: string;
  /** Secondary text, e.g. WBS code, project name or "Action". */
  hint?: string;
  icon?: React.ReactNode;
  /** Extra search terms (synonyms, codes). */
  keywords?: string[];
  /** Navigate here on select… */
  href?: string;
  /** …or run this. */
  onSelect?: () => void;
  /** Keys shown on the right, e.g. ["G", "W"]. Display only. */
  shortcut?: string[];
  disabled?: boolean;
};

export type CommandPaletteGroup = { id: string; heading: string; items: ReadonlyArray<CommandPaletteItem> };

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ReadonlyArray<CommandPaletteGroup>;
  /** Shown (as "Recent") only while the query is empty. */
  recent?: ReadonlyArray<CommandPaletteItem>;
  placeholder?: string;
  /** Register the global ⌘K / Ctrl+K toggle (default true). Disable when another palette owns it. */
  enableShortcut?: boolean;
  /** For server-side search: receives the query; pass `shouldFilter={false}` results via `groups`. */
  onQueryChange?: (query: string) => void;
  /** Disable cmdk's built-in fuzzy filter (when results are already filtered server-side). */
  shouldFilter?: boolean;
  loading?: boolean;
  /** Scope chips or other controls under the input (e.g. This project / All projects). */
  toolbar?: React.ReactNode;
};

/** Toggles on ⌘K (macOS) / Ctrl+K (Windows/Linux) anywhere on the page. */
export function useCommandPaletteShortcut(toggle: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, enabled]);
}

const noopSubscribe = () => () => {};

/** "⌘" on Apple platforms, "Ctrl" elsewhere (server renders "Ctrl" and corrects after hydration). */
export function useModifierKeyLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

/** Global search & actions (spec §15). Data comes in through props; this component only renders. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  recent,
  placeholder = "Search projects, people, actions…",
  enableShortcut = true,
  onQueryChange,
  shouldFilter = true,
  loading = false,
  toolbar,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  useCommandPaletteShortcut(() => onOpenChange(!open), enableShortcut);

  const run = (item: CommandPaletteItem) => {
    onOpenChange(false);
    setQuery("");
    if (item.onSelect) item.onSelect();
    else if (item.href) router.push(item.href);
  };

  const showRecent = query.trim() === "" && recent && recent.length > 0;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-3 top-3 z-50 flex max-h-[min(36rem,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-lg outline-none",
            "sm:inset-x-auto sm:top-[12vh] sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2",
            "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <Command
            label="Search and commands"
            loop
            shouldFilter={shouldFilter}
            // Match on label/hint/keywords only — the item value carries internal ids.
            filter={(_value, search, keywords) => defaultFilter(keywords?.join(" ") ?? "", search)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <Command.Input
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  onQueryChange?.(value);
                }}
                placeholder={placeholder}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {loading ? <Spinner size="sm" label="Searching" className="text-muted-foreground" /> : null}
              <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            </div>
            {toolbar ? <div className="flex items-center gap-2 border-b border-border px-4 py-2">{toolbar}</div> : null}
            <Command.List className="min-h-0 flex-1 scroll-py-2 overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <span aria-hidden className="grid size-11 place-items-center rounded-full bg-surface-sunken text-muted-foreground">
                  <SearchX className="size-5" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {query ? <>No results for “{query}”</> : "Start typing to search"}
                </span>
                <span className="text-[13px] text-muted-foreground">Try a project name, a WBS code like 1.2.3, or a person.</span>
              </Command.Empty>

              {showRecent ? (
                <PaletteGroup heading="Recent">
                  {recent.map((item) => (
                    <PaletteItem key={`recent-${item.id}`} item={{ ...item, icon: item.icon ?? <History /> }} valuePrefix="recent" onRun={run} />
                  ))}
                </PaletteGroup>
              ) : null}

              {groups.map((group) =>
                group.items.length > 0 ? (
                  <PaletteGroup key={group.id} heading={group.heading}>
                    {group.items.map((item) => (
                      <PaletteItem key={item.id} item={item} valuePrefix={group.id} onRun={run} />
                    ))}
                  </PaletteGroup>
                ) : null,
              )}
            </Command.List>
            <div className="hidden items-center gap-4 border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-muted-foreground sm:flex">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                to navigate
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>
                  <CornerDownLeft aria-hidden className="size-3" />
                </Kbd>
                to open
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
                to close
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({
  item,
  valuePrefix,
  onRun,
}: {
  item: CommandPaletteItem;
  valuePrefix: string;
  onRun: (item: CommandPaletteItem) => void;
}) {
  return (
    <Command.Item
      value={`${valuePrefix}:${item.id}:${item.label}`}
      keywords={[item.label, ...(item.hint ? [item.hint] : []), ...(item.keywords ?? [])]}
      disabled={item.disabled}
      onSelect={() => onRun(item)}
      className={cn(
        "flex min-h-11 cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm outline-none select-none",
        "data-[selected=true]:bg-primary-soft data-[disabled=true]:opacity-50",
      )}
    >
      {item.icon ? (
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground [&_svg]:size-4"
        >
          {item.icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-foreground">{item.label}</span>
        {item.hint ? <span className="truncate text-xs leading-4 text-muted-foreground">{item.hint}</span> : null}
      </span>
      {item.shortcut ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {item.shortcut.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ) : null}
    </Command.Item>
  );
}
