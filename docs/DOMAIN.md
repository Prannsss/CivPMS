# Domain module (`src/lib/domain`)

Pure TypeScript business logic shared by the client (instant feedback) and the server (authoritative recompute on save) — spec §18.4, decision D23. No React, no Supabase, no I/O, no hidden clock: every function that needs "today" or "now" takes it as a parameter. The single clock helper is `todayInManila(now = new Date())`.

Import everything from the barrel:

```ts
import { computeEndDate, createCalendarIndex, formatPeso, rollupTree } from "@/lib/domain";
```

Conventions:

- **Calendar dates** are ISO `YYYY-MM-DD` strings everywhere. Arithmetic runs on UTC midnights, so the machine timezone never shifts a date.
- **Money** is a `number` of pesos with 2 decimals. Round with `roundMoney` (never `Math.round(x * 100) / 100`, which turns 1.005 into 1.00). Sums and comparisons go through centavos (`toCents`, `sumMoney`).
- **Durations** are stored in working hours (D20). Days are only a display unit (`hours ÷ hoursPerDay`).
- **Errors**: functions throw `DomainError` (with a `code`) only for programming/data errors such as an invalid date string. User input is validated by the zod schemas, which return plain-language messages.

Tests live next to each module (`*.test.ts`). Run `npx vitest run` and `npx vitest run --coverage` (threshold: 95 % lines on this folder).

---

## `dates.ts`

| Function | Notes |
|---|---|
| `isValidISODate(v)` | Real calendar date in `YYYY-MM-DD` form (rejects `2026-02-29`, `2026-04-31`). |
| `parseISODate(iso)` / `toISODate(date)` | UTC midnight ↔ string. Throws `DomainError('INVALID_DATE')`. |
| `addDays(iso, n)` | Integer days, negative allowed. |
| `diffDays(a, b)` | `a − b` in days (same argument order as date-fns `differenceInCalendarDays`). |
| `isoWeekday(iso)` | 1 = Monday … 7 = Sunday. |
| `compareISO`, `minISO(...)`, `maxISO(...)` | Min/max ignore `null`/`undefined`/`''`; return `null` when nothing is left. |
| `todayInManila(now?)` | Business "today" (spec §17.1). `2026-10-11T16:30:00Z` → `2026-10-12`. |
| `yearsBetween(start, end)` | Calendar years touched by the range, e.g. `[2026, 2027]` — which years of holidays a schedule needs. |
| `eachDayISO(start, end)`, `zonedParts(instant)` | Helpers for calendars and formatting. |

## `calendar.ts` — working calendar (spec §7, D20)

```ts
type WorkingCalendar = {
  workDays: number[];            // ISO weekdays, default [1,2,3,4,5]
  hoursPerDay: number;           // default 8, may be fractional (7.5)
  holidaysNonWorking: boolean;   // "Mark all holidays as non-working"
  holidays: { date: string; name: string }[];
  overrides: { date: string; kind: "working" | "nonworking"; note?: string }[];
};
```

Build an index once (`createCalendarIndex(cal)`, O(1) lookups) and pass it to every call.

**Working-day precedence** (`isWorkingDay`): a per-date override always wins (both ways) → otherwise a holiday is non-working when `holidaysNonWorking` is on → otherwise the weekday rule. `nonWorkingReason` explains why: `{ reason: 'weekend' | 'holiday' | 'override', holidayName?, note? }` or `null`.

**End date (D20)** — `computeEndDate(index, start, hours)`:

- `0 h` is a milestone: end = start (even on a non-working day).
- Otherwise work starts on the first working day ≥ start and takes `ceil(hours ÷ hoursPerDay)` working days; the end is the last of them.

| Start | Hours | h/day | Calendar | End |
|---|---|---|---|---|
| Mon 12 Oct 2026 | 12 | 8 | Mon–Fri | Tue 13 Oct |
| Mon 12 Oct 2026 | 48 | 8 | Mon–Fri | Mon 19 Oct (skips the weekend) |
| Sat 17 Oct 2026 | 8 | 8 | Mon–Fri | Mon 19 Oct (weekend start moves work) |
| Mon 12 Oct 2026 | 22.5 | 7.5 | Mon–Fri | Wed 14 Oct |
| Mon 12 Oct 2026 | 8 | 8 | Mon is a holiday | Tue 13 Oct |
| Fri 31 Dec 2027 | 16 | 8 | Mon–Fri | Mon 3 Jan 2028 |

Other functions: `nextWorkingDay(index, date, { inclusive })` (the option is required so callers state which they mean), `countWorkingDays(index, start, end)` (inclusive), `durationHoursFromDates(index, start, end)` = working days × hours/day (used when a user edits a leaf's end date, spec §6.2), `workingDaysForHours`, and `rescheduleLeaves(leaves, index)` which keeps each leaf's start and duration, recomputes the end, and returns only the changed rows `{ id, startDate, durationHours, endDate, previousEndDate }` — the "14 activities will move" preview of §7.

**Never loops forever**: when no working day exists within 3,660 days (or the calendar has no work days and no "working" override) it throws `CalendarError('NO_WORKING_DAYS')`. Invalid hours/day, durations or dates throw `CalendarError` with `INVALID_HOURS_PER_DAY`, `INVALID_DURATION`, `INVALID_DATE`.

## `wbs.ts` — work breakdown tree (spec §6.1, §9.3, §17.2, D22)

- `ActivityRecord` is a camelCased `activities` row; `ActivityNode<T>` adds `children`, plus `level` (1–3) and `wbsCode` recomputed from the tree position.
- `buildTree(records)` → `{ roots, orphanIds }`. Siblings sort by `sortOrder`, then name, then id. Soft-deleted rows and everything below them are dropped. Rows whose parent is missing are attached as roots and reported in `orphanIds`, and parent cycles are broken the same way, so a corrupt table still renders.
- `computeWbsCodes(roots)` → `Map<id, '1.2.3'>`. Codes renumber automatically after reorders and moves.
- `flattenTree(roots, collapsedIds?)` → pre-order rows `{ node, depth, level, wbsCode, hasChildren, isLastChild, isCollapsed, ancestorIsLast }` for the list view (children of collapsed rows are skipped).
- `findNode`, `ancestorsOf` (root first), `descendantsOf`, `leavesOf`, `subtreeHeight` (leaf = 1), `depthOf` (1-based).
- `canMove(roots, id, newParentId)` → `{ ok: true }` or `{ ok: false, reason }`. The reason is `SELF`, `DESCENDANT` (would create a loop), `MAX_DEPTH` (new parent level + subtree height > 3, D22) or `NOT_FOUND`. `canMoveMessage(reason)` gives the user-facing text.
- `countDescendantsByLevel(node)` and `describeDeleteImpact(node)` give the text for the delete confirmation dialog: `"Deletes 4 sub-deliverables and 11 work packages"`, `"Deletes 1 sub-deliverable and 1 work package"`, `"Deletes 3 work packages"`, and `"Deletes this work package"` when nothing is below it.
- `levelLabel(1|2|3)` → `Deliverable` / `Sub-deliverable` / `Work package`. `childLevelLabel(level)` gives the label for "+ Add …" buttons, or `null` at level 3.

## `rollup.ts` — parent values (spec §6.2, §6.5, §10.4, D21, D23)

`rollupTree(roots, { weighting, delayedIds?, today? })` → `Map<id, Rollup>`:

| Field | Leaf | Parent |
|---|---|---|
| `startDate` / `endDate` | its own (null-safe) | min / max over descendant leaves |
| `hours` / `cost` | its own (`null` → 0) | Σ leaves (cost summed in centavos) |
| `percent` | its own, clamped 0–100 | Σ(w·p) ÷ Σw over descendant leaves |
| `status` | its own | all Completed → completed; all Not Started → not_started; all On-Hold → on_hold; otherwise ongoing |
| `hasDelayed` | status `delayed`, `delayedReported`, in `delayedIds`, or derived-Delayed against `today` | any descendant leaf delayed |
| `usedFallbackWeight` | its weight needed a fallback | any leaf in the subtree did |

A parent's own stored cost, hours and dates are ignored (D21).

**Leaf weight** (`leafWeight`): the primary basis (cost by default, or hours) when > 0. Otherwise the other basis when > 0. Otherwise an equal weight of 1. Both fallbacks set `usedFallbackWeight` so the UI can warn that progress accuracy is reduced.

Example: two leaves with cost ₱30,000 at 100 % and ₱10,000 at 50 % give a parent at (30000·100 + 10000·50) ÷ 40000 = **87.5 %**.

`projectRollup(roots, opts)` returns the same totals over all leaves (empty project: dates `null`, `0 %`, `not_started`), plus `activityCount`, `incompleteCount` and `incompleteIds` (all levels, WBS order). These feed the "Complete these activities first" message of §5.2.

## `status.ts` — activity statuses (spec §10)

- `ACTIVITY_STATUSES = ['not_started', 'ongoing', 'delayed', 'on_hold', 'completed']`, `activityStatusLabel` (`Not Started`, `Ongoing`, `Delayed`, `On-Hold`, `Completed`).
- `validateStatusPercent(status, percent)` (§10.3): % must be an integer 0–100. Not Started = 0, Ongoing = 1–99, Delayed = 0–99, On-Hold = 0–99, Completed = 100. Returns `null` or a message such as *"Ongoing activities need at least 1% progress. Enter 1–99% or choose Not Started."*
- `percentForStatus(status, current)` pre-fills a consistent % when the status changes. `statusChangeRequiresNote(before, after)` is true for → Delayed or On-Hold (A14) and for reopening a Completed activity (§10.3).
- `derivedDelayed({ status, startDate, endDate, today })` (§10.5, A15) returns `{ delayed, reason, days }`. `END_PASSED` means today > end and the activity is not Completed. `START_PASSED` means today > start and it is still Not Started. End-passed wins when both apply. On the end date itself the activity is not delayed yet.
- `isEscalation(before, after)` (§10.6) is true when the status changes to Delayed or On-Hold, or when the % decreases.

## `project.ts` — project status and badges (spec §5.2–5.4, §6.4)

`projectTransitions(from, { companyRole, projectRole, activityCount, incompleteCount })` lists every edge of the §5.2 graph out of `from`. Each entry is `{ to, allowed, requiresReason, requiresConfirmation, capturesBaseline, blockedReason? }`:

| From | To | Who | Extra rules |
|---|---|---|---|
| planning | active | PM on the project or Owner PM | captures Baseline v1 |
| active | on_hold | PM | reason required |
| on_hold | active | PM | |
| active / on_hold | completed | PM | blocked unless ≥ 1 activity and none incomplete |
| planning / active / on_hold | cancelled | **Owner PM only** | reason + confirmation |
| completed | active (reopen) | PM | |
| cancelled | — | | terminal |

Blocked entries carry plain-language reasons, e.g. *"12 activities are not completed yet. Complete them before completing the project."* `findProjectTransition(from, to, ctx)` picks one edge. Other helpers: `isOpenProjectStatus`, `canArchiveProjectStatus` (Completed/Cancelled only, A8) and `projectStatusRequiresReason`.

`budgetAllocation(budget, allocated, threshold = 0.9)` → `{ budget, allocated, remaining, ratio, state }`, compared in centavos:

| Allocated of ₱1,000,000 | state |
|---|---|
| ₱899,999.99 | `ok` |
| ₱900,000.00 (exactly 90 %) | `near` |
| ₱1,000,000.00 (exactly 100 %) | `near` |
| ₱1,000,000.01 | `exceeded` |

`isProjectDelayed({ status, endDate, today })` (§5.3) is true when today (Manila) > end date and the status is not Completed or Cancelled. Moving the end date into the future clears it (§5.4). `projectBadges(...)` → `{ delayed, budgetState, overdueDays }`.

## `permissions.ts` — UI permission flags (spec §2.2)

These only hide or disable controls. RLS and RPCs remain the security boundary.

- `companyPermissions(role)`:
  - `owner_pm` gets everything.
  - `pm` can create projects (A1), create inspector invite codes (D11) and view the trash.
  - `inspector` and `null` get nothing.
- `projectPermissions({ companyRole, projectRole })`:
  - **Owner PM**: every capability on every company project.
  - **Project PM**: view, edit project, WBS and calendar, invite, manage members, change status, archive, log, progress, export and import. Cancelling and deleting a project stay with the Owner PM.
  - **Inspector**: view, log, update progress at any level, and export (A4).
  - **Anyone else**, including a company PM who is not on the project (Q12): nothing.

## `format.ts` — display (CLAUDE.md formatting, spec §17.1)

| Call | Result |
|---|---|
| `formatPeso(1234567.89)` | `₱1,234,567.89` |
| `formatPeso(-1000)` | `-₱1,000.00` |
| `formatPeso(1.005)` | `₱1.01` |
| `formatPesoCompact(1_234_567)` / `(950_000)` | `₱1.2M` / `₱950K` |
| `formatDate('2026-10-10')` | `10 Oct 2026` |
| `formatDateRange('2026-10-10', '2026-12-12')` | `10 Oct – 12 Dec 2026` |
| `formatDateRange('2026-12-20', '2027-01-15')` | `20 Dec 2026 – 15 Jan 2027` |
| `formatDateTime('2026-10-10T06:32:00Z')` | `10 Oct 2026, 2:32 PM` (Asia/Manila) |
| `formatRelativeTime(ts, now)` | `just now`, `5 min ago`, `3 h ago`, `yesterday`, `3 Oct`, `3 Oct 2025` |
| `formatPercent(33.333, { decimals: 1 })` | `33.3%` |
| `formatDuration(12, 'days', 8)` | `1.5 d` (`12 h` in hours) |
| `parseDurationInput('2d', 'hours', 8)` | `16` (a suffix wins; a bare number uses the unit; invalid → `null`) |
| `initials('Maria Santos')` | `MS` |
| `pluralize(4, 'work package')` | `4 work packages` (`pluralWord` gives the word only) |

Missing or invalid inputs render as `—`.

## `invite-code.ts` — invite codes (D11)

- `INVITE_CODE_ALPHABET` is Crockford base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- `normalizeInviteCode(input)` uppercases the input and strips spaces, dashes (including pasted en dashes) and underscores. It maps `O → 0` and `I/L → 1`, then re-inserts the dash. Anything that isn't 8 alphabet characters gives `null`. Examples: `' 7kq2 m9xa '` → `7KQ2-M9XA`, `'oiLl-0000'` → `0111-0000`, `'UUUU-UUUU'` → `null`.
- `isInviteCodeFormat(v)` accepts canonical codes only.
- `inviteCodeFromBytes(bytes)` encodes 5 random bytes, which the caller supplies so that randomness stays outside the module.

## `schemas.ts` — zod v4 schemas

Every message says what is wrong and how to fix it (§17.2), e.g. *"End date must be on or after 12 Jan 2026."* Numeric fields accept form strings (`'1,250,000.50'` → `1250000.5`, `'₱ 1,000'` → `1000`). Empty optional text becomes `null`. Each schema exports `XxxInput` (`z.input`) and `XxxValues` (`z.output`) types.

| Schema | Rules |
|---|---|
| `signInSchema` | email (trimmed, lowercased, valid), password required |
| `signUpSchema` | email, password 10–72 characters |
| `forgotPasswordSchema` | email |
| `resetPasswordSchema` | password and `confirmPassword` must match |
| `onboardingProfileSchema` | `fullName` 2–100, `role` `pm` or `inspector` |
| `companyNameSchema` / `companyCreateSchema` | 2–100, trimmed, inner whitespace collapsed |
| `inviteCodeSchema` / `redeemInviteCodeSchema` | normalized to `XXXX-XXXX` |
| `inviteSchema` | email (lowercased), role `pm` or `inspector` |
| `projectCreateSchema` | name 3–120, start, end ≥ start, budget > 0 and ≤ ₱999,999,999,999.99 with at most 2 decimals, site name ≤ 200, address ≤ 500, description ≤ 2000, color from `PROJECT_COLOR_KEYS` |
| `projectUpdateSchema` | partial, plus `weighting`; date order checked when both dates are sent |
| `projectStatusChangeSchema` | reason required for `on_hold` and `cancelled` |
| `activityCreateSchema` | name 1–200, description ≤ 2000, start, duration 0–100,000 h (2 decimals), optional end ≥ start, cost ≥ 0 (empty → 0, 2 decimals), optional `parentId` |
| `activityUpdateSchema` | partial; absent fields stay absent |
| `activityProgressSchema` | §10.2–10.3: status ↔ %, note for Delayed, On-Hold and reopen |
| `calendarSettingsSchema` | `workDays` non-empty, unique, 1–7 (returned sorted); hours/day 1–24; `holidaysNonWorking` |
| `calendarDateSchema` | `holiday` (name required), `override_nonworking` or `override_working` |
| `profileUpdateSchema` | `fullName`, optional `https` `avatarUrl` |
| `notificationPrefsSchema` | in-app and email per §14 event type, daily digest on or off; `DEFAULT_NOTIFICATION_PREFS` |

`fieldErrorsFrom(zodError)` flattens issues to `{ field: firstMessage }` for `ActionResult.fieldErrors`.

## `money.ts` and `errors.ts`

- **`money.ts`**: `roundTo` and `roundMoney` round half away from zero and are float-safe. Also `toCents`, `sumMoney`, `hasAtMostDecimals`, `parseNumericInput` and `MAX_MONEY`.
- **`errors.ts`**: `DomainError(code, message?)` and `isDomainError(e, code?)`. The codes are `INVALID_DATE`, `INVALID_NUMBER`, `INVALID_DURATION`, `INVALID_HOURS_PER_DAY` and `NO_WORKING_DAYS`. `CalendarError` extends it.
