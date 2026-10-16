"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, Search, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AUDIT_TYPE_LABELS,
  AUDIT_TYPES,
  activeFilterCount,
  auditFiltersToSearchParams,
  cleanSearch,
  type AuditFilters,
  type AuditType,
} from "./audit-filters";

const ALL = "all";

/**
 * Audit Trail filters, synced to the URL (shareable, back-button friendly): text search (debounced),
 * person, type, date range and "Escalations only", plus CSV export of exactly what is shown.
 */
export function AuditFiltersBar({
  filters,
  actors,
  exportHref,
  canExport,
}: {
  filters: AuditFilters;
  actors: { id: string; name: string }[];
  exportHref: string;
  canExport: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [expanded, setExpanded] = useState(false);
  const lastPushed = useRef(filters.q ?? "");
  const count = activeFilterCount(filters);
  const panelCount = count - (filters.q ? 1 : 0);

  function apply(next: Partial<AuditFilters>) {
    const params = auditFiltersToSearchParams({ ...filters, ...next });
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  // Debounced text search.
  useEffect(() => {
    const cleaned = cleanSearch(q) ?? "";
    if (cleaned === lastPushed.current) return;
    const timer = window.setTimeout(() => {
      lastPushed.current = cleaned;
      apply({ q: cleaned || null });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` reads the latest filters from props
  }, [q]);

  const personName = actors.find((actor) => actor.id === filters.person)?.name;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5" role="search" aria-label="Filter the audit trail">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && q) {
              event.preventDefault();
              setQ("");
            }
          }}
          aria-label="Search the audit trail"
          placeholder="Search changes, people or notes…"
          leading={pending ? <Spinner size="sm" label={null} /> : <Search aria-hidden className="size-4" />}
          trailing={
            q ? (
              <IconButton aria-label="Clear search" variant="ghost" size="sm" tooltip={false} onClick={() => setQ("")}>
                <X />
              </IconButton>
            ) : undefined
          }
          wrapperClassName="flex-1"
          maxLength={100}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 lg:hidden"
            aria-expanded={expanded}
            aria-controls="audit-filter-panel"
            onClick={() => setExpanded((value) => !value)}
          >
            <SlidersHorizontal aria-hidden />
            Filters
            {panelCount > 0 ? (
              <Badge tone="primary" size="sm" className="tabular-nums">
                {panelCount}
              </Badge>
            ) : null}
          </Button>
          {canExport ? (
            <Button variant="outline" asChild className="flex-1 sm:flex-none">
              <a href={exportHref} download>
                <Download aria-hidden />
                Export CSV
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div
        id="audit-filter-panel"
        className={cn(
          "grid gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end",
          expanded ? "grid" : "hidden",
        )}
      >
        <Field label="Person">
          <Select value={filters.person ?? ALL} onValueChange={(value) => apply({ person: value === ALL ? null : value })}>
            <SelectTrigger>
              <SelectValue placeholder="Everyone">{filters.person ? (personName ?? "Selected person") : "Everyone"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Everyone</SelectItem>
              {actors.length > 0 ? <SelectSeparator /> : null}
              {actors.map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Type">
          <Select value={filters.type ?? ALL} onValueChange={(value) => apply({ type: value === ALL ? null : (value as AuditType) })}>
            <SelectTrigger>
              <SelectValue placeholder="All changes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All changes</SelectItem>
              <SelectSeparator />
              {AUDIT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {AUDIT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="From">
          <DateInput value={filters.from ?? ""} max={filters.to ?? undefined} onValueChange={(value) => apply({ from: value || null })} />
        </Field>
        <Field label="To">
          <DateInput value={filters.to ?? ""} min={filters.from ?? undefined} onValueChange={(value) => apply({ to: value || null })} />
        </Field>
        <div className="flex h-11 items-center sm:col-span-2 sm:h-10 lg:col-span-1">
          <Switch
            checked={filters.escalations}
            onCheckedChange={(checked) => apply({ escalations: checked })}
            label={
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <TriangleAlert aria-hidden className="size-4 text-orange-text" />
                Escalations only
              </span>
            }
          />
        </div>
      </div>

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
          <span>
            {count} filter{count === 1 ? "" : "s"} applied
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setQ("");
              lastPushed.current = "";
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            Clear all filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}
