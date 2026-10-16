"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TOKEN_PAIRS, pairContrast, requiredRatio } from "../_lib/contrast";
import { Demo, Section } from "./section";

/** Re-renders whenever <html class> changes (theme switch), so computed colors are fresh. */
function useHtmlClass(): string {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    },
    () => document.documentElement.className,
    () => "",
  );
}

/** Reads a token's current value. Returns "" until hydrated (`ready`), so SSR and hydration match. */
function readVar(name: string, ready: boolean): string {
  if (!ready) return "";
  if (name.startsWith("#")) return name;
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

type Swatch = { token: string; on?: string; note?: string };

const GROUPS: { title: string; description: string; swatches: Swatch[] }[] = [
  {
    title: "Neutrals",
    description: "Page, surfaces, borders and text. Ratios are text on the page background.",
    swatches: [
      { token: "background" },
      { token: "surface" },
      { token: "surface-muted" },
      { token: "surface-sunken" },
      { token: "border" },
      { token: "border-strong" },
      { token: "input", on: "background", note: "control borders · 3:1" },
      { token: "foreground", on: "background" },
      { token: "muted-foreground", on: "background" },
    ],
  },
  {
    title: "Brand",
    description: "#0866FF fills buttons and active states; primary-text is the AA-safe blue for links.",
    swatches: [
      { token: "primary", on: "background", note: "UI · 3:1" },
      { token: "primary-hover" },
      { token: "primary-active" },
      { token: "primary-text", on: "background" },
      { token: "primary-soft" },
      { token: "ring", on: "background", note: "focus · 3:1" },
    ],
  },
  {
    title: "Status tones",
    description: "Always paired with an icon and a label. Soft fill + -text for badges; solid fill + -foreground for emphasis.",
    swatches: ["danger", "warning", "orange", "success", "info", "neutral"].flatMap((tone) => [
      { token: tone },
      { token: `${tone}-soft` },
      { token: `${tone}-text`, on: `${tone}-soft` },
    ]),
  },
  {
    title: "Sidebar & inverse",
    description: "Project sidebar (blue in light, near-black in dark) and the snackbar/tooltip surface.",
    swatches: [
      { token: "sidebar-bg" },
      { token: "sidebar-fg", on: "sidebar-bg" },
      { token: "sidebar-hover" },
      { token: "sidebar-active-bg" },
      { token: "sidebar-active-fg", on: "sidebar-active-bg" },
      { token: "inverse" },
      { token: "inverse-foreground", on: "inverse" },
    ],
  },
  {
    title: "Project palette",
    description: "Card colors (no red/orange/yellow — those mean warnings). White text passes on both gradient stops.",
    swatches: ["blue", "green", "pink", "purple", "teal", "graphite"].flatMap((key) => [
      { token: `project-${key}`, note: "white text" },
      { token: `project-${key}-to` },
    ]),
  },
];

function SwatchTile({ swatch, ready }: { swatch: Swatch; ready: boolean }) {
  const value = readVar(swatch.token, ready);
  const isProject = swatch.token.startsWith("project-");
  const on = swatch.on;
  const ratio = !ready
    ? null
    : on
      ? pairContrast(value, readVar(on, ready), readVar("background", ready))
      : isProject
        ? pairContrast("#ffffff", value, "#ffffff")
        : null;
  const need = swatch.note?.includes("3:1") ? 3 : 4.5;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div
        className="relative flex h-16 items-end p-2.5"
        style={{ background: `var(--${swatch.token})` }}
      >
        {isProject ? <span className="text-xs font-semibold text-white">Aa</span> : null}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border px-2.5 py-2">
        <code className="truncate font-mono text-[12px] leading-4 font-medium text-foreground">{swatch.token}</code>
        <span className="truncate font-mono text-[11px] leading-4 text-muted-foreground">{value || "—"}</span>
        {ratio !== null ? (
          <span
            className={cn(
              "mt-0.5 text-[11px] leading-4 font-semibold tabular-nums",
              ratio >= need ? "text-success-text" : "text-danger-text",
            )}
          >
            {ratio.toFixed(2)}:1 {on ? `on ${on}` : "white"} {ratio >= need ? "✓" : "✗"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function TokensSection() {
  const htmlClass = useHtmlClass();
  const ready = htmlClass !== "";
  const theme = htmlClass.includes("dark") ? "dark" : "light";
  const rows = TOKEN_PAIRS.map((pair) => {
    const ratio = ready
      ? pairContrast(readVar(pair.fg, ready), readVar(pair.bg, ready), readVar(pair.base ?? "background", ready))
      : null;
    return { pair, ratio, need: requiredRatio(pair.kind) };
  });
  const failing = rows.filter((r) => r.ratio !== null && r.ratio < r.need).length;

  return (
    <Section
      id="tokens"
      title="Color tokens"
      description={
        <>
          Every color is a CSS variable (light + dark) exposed as a Tailwind color: <code>bg-primary</code>,{" "}
          <code>text-muted-foreground</code>, <code>bg-danger-soft</code>… Values and ratios below are read live from the
          current <strong>{theme}</strong> theme.
        </>
      }
    >
      {GROUPS.map((group) => (
        <Demo key={group.title} title={group.title} description={group.description} bodyClassName="p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {group.swatches.map((swatch) => (
              <SwatchTile key={`${theme}-${swatch.token}`} swatch={swatch} ready={ready} />
            ))}
          </div>
        </Demo>
      ))}

      <Demo
        title="WCAG AA contrast — every text/background pair"
        description={<>Text needs 4.5:1; UI parts (borders, focus ring, icons) need 3:1. Same list as <code className="font-mono">node src/app/dev/styleguide/_lib/check-contrast.mjs</code>.</>}
        bodyClassName="p-0 sm:p-0 border-0"
      >
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={failing === 0 ? "success" : "danger"} variant="soft">
            {!ready ? "Measuring…" : failing === 0 ? `All ${rows.length} pairs pass (${theme})` : `${failing} failing (${theme})`}
          </Badge>
        </div>
        <TableContainer className="max-h-[28rem]">
          <Table dense zebra>
            <TableHeader>
              <TableRow>
                <TableHead>Sample</TableHead>
                <TableHead>Foreground</TableHead>
                <TableHead>Background</TableHead>
                <TableHead>Use</TableHead>
                <TableHead numeric>Ratio</TableHead>
                <TableHead numeric>Needs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ pair, ratio, need }) => (
                <TableRow key={`${theme}-${pair.fg}-${pair.bg}-${pair.base ?? ""}-${pair.note ?? ""}`}>
                  <TableCell>
                    <span
                      className="inline-flex h-6 items-center rounded-xs px-2 text-xs font-semibold"
                      style={{
                        color: pair.fg.startsWith("#") ? pair.fg : `var(--${pair.fg})`,
                        background: `var(--${pair.bg})`,
                        boxShadow: "inset 0 0 0 1px var(--border)",
                      }}
                    >
                      {pair.kind === "text" ? "Aa" : "■ ■"}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{pair.fg}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {pair.bg}
                    {pair.base ? <span className="text-muted-foreground"> on {pair.base}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pair.note ?? (pair.kind === "text" ? "text" : "UI")}</TableCell>
                  <TableCell numeric className={cn("font-semibold", ratio !== null && ratio >= need ? "text-success-text" : "text-danger-text")}>
                    {ratio === null ? "—" : ratio.toFixed(2)}
                  </TableCell>
                  <TableCell numeric className="text-muted-foreground">
                    {need}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Demo>
    </Section>
  );
}
