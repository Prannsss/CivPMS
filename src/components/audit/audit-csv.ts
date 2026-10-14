/**
 * Audit Trail CSV (spec §10.6, §16.1): project name and generation time (Asia/Manila) on top, then
 * one row per entry with Manila times and ₱ formatting. Pure, so it is unit-tested.
 */
import { formatDateTime } from "@/lib/domain/format";
import type { AuditEntry } from "@/server/queries/audit";
import { actionLabel, entityLabel, formatLogValue, observedDiffers, viaLabel } from "./audit-format";

export const AUDIT_CSV_HEADER = [
  "Recorded (Asia/Manila)",
  "Observed (Asia/Manila)",
  "Person",
  "Type",
  "Action",
  "WBS code",
  "Activity",
  "Change",
  "Field",
  "Old value",
  "New value",
  "Note",
  "Via",
  "Escalation",
] as const;

/** RFC 4180 quoting; also neutralises spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) && !/^-₱/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvCell).join(",");
}

export function auditEntryRow(entry: AuditEntry): string {
  return csvRow([
    formatDateTime(entry.recordedAt),
    observedDiffers(entry.recordedAt, entry.observedAt) ? formatDateTime(entry.observedAt) : "",
    entry.actorName,
    entityLabel(entry.entityType),
    actionLabel(entry.action),
    entry.wbsCode,
    entry.activityName,
    entry.summary,
    entry.field,
    formatLogValue(entry.field, entry.oldValue),
    formatLogValue(entry.field, entry.newValue),
    entry.note,
    viaLabel(entry.via),
    entry.isEscalation ? "Yes" : "",
  ]);
}

/** The whole file: a UTF-8 BOM (so Excel shows ₱ correctly), a short preamble, header and rows. */
export function buildAuditCsv(input: {
  projectName: string;
  generatedAt: Date;
  filterSummary: string;
  entries: ReadonlyArray<AuditEntry>;
  truncated: boolean;
}): string {
  const lines = [
    csvRow(["Project", input.projectName]),
    csvRow(["Audit trail exported", `${formatDateTime(input.generatedAt)} (Asia/Manila)`]),
    csvRow(["Filters", input.filterSummary]),
    csvRow(["Entries", input.truncated ? `${input.entries.length} (limit reached; narrow the filters for older entries)` : input.entries.length]),
    "",
    csvRow([...AUDIT_CSV_HEADER]),
    ...input.entries.map(auditEntryRow),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `cebu-coastal-road-widening-audit-2026-10-13.csv` */
export function auditCsvFilename(projectName: string, day: string): string {
  const slug =
    projectName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project";
  return `${slug}-audit-${day}.csv`;
}
