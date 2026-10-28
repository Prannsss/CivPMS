# CivPMS database (Phase 0–1)

Supabase project **CivPMS** (ref `bxfohhwvzbvmyokcsmwq`, ap-southeast-1, Postgres 17). Everything lives in `supabase/migrations/*.sql`; the generated client types are in `src/lib/supabase/database.types.ts`. Spec sections (§) refer to `SPEC.md`, decisions (D*) to `docs/DECISIONS.md`.

**Contents:** [Conventions](#conventions) · [Migrations](#migrations) · [Entities](#entities) · [Visibility and RLS](#visibility-and-rls) · [RPC catalog](#rpc-catalog) · [Error codes](#error-codes) · [Triggers and jobs](#triggers-and-jobs) · [Activity log](#activity-log) · [Notifications and email](#notifications-and-email) · [Storage](#storage) · [Philippine holidays](#philippine-holidays) · [Applying migrations from Windows](#applying-migrations-from-windows) · [SQL tests](#sql-tests) · [Advisors](#advisors)

---

## Conventions

- **Schemas.** Client-callable objects (tables, the `project_overview` view, RPCs) live in `public`. Internal helpers live in `private`, which the Data API does not expose. `anon`/`authenticated`/`public` have no rights on `private`, except `USAGE` plus `EXECUTE` on the six RLS helper functions, which `authenticated` needs while policies are evaluated.
- **Reads** go through RLS (`select` on tables and `project_overview`). **Writes go through RPCs.** Clients have no `INSERT`/`UPDATE`/`DELETE` on any table. The one exception is a column-limited `UPDATE` of your own `profiles` row (`full_name`, `avatar_url`, `duration_unit`).
- **RPCs** are `SECURITY DEFINER` with `search_path = ''` and fully-qualified names. Each one checks the caller's role itself. `EXECUTE` is revoked from `public` and `anon` and granted to `authenticated` and `service_role`. Exceptions: `get_invitation_by_token` is also granted to `anon`; `claim_email_batch`, `complete_email` and `run_daily_checks` are granted to `service_role` only.
- **Errors.** Every failure the app can act on is raised as `ERRCODE 'P0001'`, `MESSAGE = '<CODE>'`, `DETAIL = '<plain-language message that says how to fix it>'`, `HINT = '<field name or empty>'`. PostgREST returns them as `{ code: "P0001", message: "<CODE>", details: "...", hint: "..." }`. `src/lib/errors.ts` maps `message` to `ErrorCode` and `hint` to `fieldErrors[hint] = details`. See [Error codes](#error-codes).
- **Optimistic concurrency.** `projects.version` and `activities.version` are bumped by triggers on every meaningful change. Renumbering (`wbs_code`, `sort_order`) and notification markers do not count. `update_project` and `update_activity` take `p_expected_version` and raise `STALE_VERSION` when it differs.
- **Dates** are `date` (ISO `YYYY-MM-DD`). Business "today" is `(now() at time zone 'Asia/Manila')::date`. **Money** is `numeric(14,2)` and **durations** are working hours `numeric(10,2)` (D20).
- **Names** (company, project) are stored trimmed with internal whitespace collapsed. Uniqueness uses a generated `name_key` (lower-cased, collapsed) column.
- **Soft delete**: `projects.deleted_at` and `activities.deleted_at` / `deleted_batch`. Restore is possible for 30 days, then the daily job purges the rows. The daily job is the only place that hard-deletes.

## Migrations

| File | Content |
|---|---|
| `20261012000100_foundation.sql` | `private` schema, default privileges, enums, error/format helpers |
| `20261012000200_core_tables.sql` | All tables, indexes, `updated_at`/`version` triggers, auth→profile sync, RLS enabled, base grants |
| `20261012000300_access_rls.sql` | Access helpers (`private.*`), all RLS policies, append-only guard on `activity_logs` |
| `20261012000400_audit_log.sql` | Activity-log writer + AFTER triggers on audited tables |
| `20261012000500_notifications.sql` | `private.notify`, notification RPCs, email outbox RPCs, realtime publication |
| `20261012000600_rpc_onboarding_company.sql` | Profile/onboarding/company/membership RPCs |
| `20261012000700_rpc_invitations.sql` | Email invitations + invite codes |
| `20261012000800_rpc_projects.sql` | Project RPCs, Baseline v1 capture, budget-crossing triggers, project trash |
| `20261012000900_project_overview.sql` | `project_overview` view |
| `20261012001000_rpc_wbs.sql` | WBS RPCs, renumbering, `apply_schedule`, activity trash |
| `20261012001100_rpc_calendar.sql` | `save_calendar` |
| `20261012001200_daily_jobs.sql` | `private.run_daily_checks()` + `public.run_daily_checks()` (service_role) |
| `20261012001210_schedule_daily_checks.sql` | `pg_cron` enabled, job `civpms-daily-checks` at 16:05 UTC (00:05 Manila) |
| `20261012001300_seed_ph_holidays.sql` | PH holidays 2026–2027 |
| `20261012001400_storage_avatars.sql` | `avatars` bucket + policies |
| `20261012001500_hardening.sql` | Stricter log immutability, Owner PM invite guard, https-only avatars, anon default privileges |
| `20261012001600_advisor_fixes.sql` | Explicit deny-all policy on `invite_code_attempts` |
| `20261014090000_notification_email_digest.sql` | Daily email digest: `notification_prefs.email_digest` (`off`\|`daily`), outbox states `digest`/`digested`, `private.send_email_digests()`, pg_cron job `civpms-email-digest` at 22:55 UTC (06:55 Manila) |
| `20261015100000_project_media_bucket.sql` | Private `project-media` bucket (WebP, 3 MB) + Storage policies for the media service (`backend/`) |
| `20261023090000_plan_lock.sql` | Plan lock: `private.assert_plan_open()`; `private.lock_wbs()` and `private.get_managed_activity()` call it, so every WBS RPC and `save_calendar` refuse Completed/Cancelled projects with `FORBIDDEN` (after the permission check) |

All of these are applied to the live project. `supabase_migrations.schema_migrations` holds the same versions and byte-identical statements as these files. Add changes as **new** migrations with a later timestamp; never edit an applied file.

---

## Entities

Every table has `created_at` and `updated_at` (`timestamptz`, the latter maintained by trigger), except `invite_code_attempts`, `activity_logs` (`recorded_at`) and `baseline_activities`.

### Enums

| Enum | Values |
|---|---|
| `company_role` | `owner_pm`, `pm`, `inspector` |
| `project_role` | `pm`, `inspector` |
| `project_status` | `planning`, `active`, `on_hold`, `completed`, `cancelled` |
| `activity_status` | `not_started`, `ongoing`, `delayed`, `on_hold`, `completed` |
| `weighting_basis` | `cost`, `hours` |
| `invitation_status` | `pending`, `accepted`, `declined`, `expired`, `revoked` |
| `calendar_date_kind` | `holiday`, `override_nonworking`, `override_working` |
| `duration_unit` | `hours`, `days` |
| `project_color` | `blue`, `green`, `pink`, `purple`, `teal`, `graphite` |

### Tables

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= `auth.users.id`, cascade), `full_name`, `email` (lower-case copy), `avatar_url` (https only), `role_pref` (`pm`\|`inspector`), `duration_unit`, `onboarded_at`, `notification_prefs` jsonb | Created and updated by a trigger on `auth.users` (name from `full_name`\|`name`, avatar from `avatar_url`\|`picture`; app-chosen values are never overwritten). |
| `companies` | `id`, `name`, `name_key` (generated, **unique**), `owner_id`, `default_work_days` smallint[] (ISO 1=Mon…7=Sun), `default_hours_per_day` | Calendar template that new projects copy. |
| `company_members` | `company_id`, `user_id` (**unique**: one company per user, D13), `role` | At most one `owner_pm` per company (partial unique index). |
| `projects` | `company_id`, `name` (3–120), `name_key`, `site_name`, `site_address`, `description`, `start_date`, `end_date` (≥ start), `budget` (> 0), `status`, `status_reason`, `is_archived` (completed/cancelled only), `weighting`, `near_budget_threshold` (default 0.9), `color`, `version`, `created_by`, `closed_at`, `budget_exceeded_notified_at`, `delayed_notified_at`, `deleted_at`, `deleted_by` | `UNIQUE (company_id, name_key) WHERE deleted_at IS NULL`. `closed_at` is set on completed/cancelled and cleared on reopen (retention clock, spec §19). |
| `project_members` | `project_id`, `user_id`, `role`, `invited_by`, `UNIQUE (project_id, user_id)` | The creator is added as `pm`. Members must belong to the project's company (trigger). The Owner PM sees every project without a row here. |
| `calendars` | `project_id` (PK), `work_days` smallint[], `holidays_nonworking`, `hours_per_day` (1–24) | One per project. |
| `calendar_dates` | `project_id`, `date`, `kind`, `name`, `UNIQUE (project_id, date, kind)` | At most one override per date. Holidays are copied from `ph_holidays` when a project is created or its dates move into new years. |
| `ph_holidays` | `date`, `name`, `type` (`regular`\|`special_non_working`), `year` (generated), `source`, `UNIQUE (date, name)` | Readable by every signed-in user. |
| `activities` | `project_id`, `parent_id` (same project, composite FK), `level` 1–3, `sort_order`, `wbs_code`, `name` (1–200), `description`, `start_date`, `duration_hours` (≥ 0), `end_date` (≥ start), `est_cost` (≥ 0), `status`, `percent` 0–100, `delayed_reported`, `version`, `created_by`, `deleted_at`, `deleted_by`, `deleted_batch` | `level`/`sort_order`/`wbs_code` are maintained by the WBS RPCs. Parents keep whatever cost, hours and dates are stored, but rollups ignore them (D21). |
| `baselines` | `project_id`, `version_no`, `reason`, `is_active` (one active per project), `created_by` | Baseline v1 is captured on planning → active. |
| `baseline_activities` | `baseline_id`, `project_id`, `activity_id`, `parent_activity_id`, `level`, `is_leaf`, `wbs_code`, `name`, `start_date`, `end_date`, `hours`, `cost`, `weight` | A frozen plan. Parents hold rolled-up values. |
| `invitations` | `company_id`, `project_id`, `email` (lower-case), `role`, `invited_by`, `token_hash` (sha256 hex, unique), `status`, `expires_at` (+7 days), `responded_at`, `accepted_by` | At most one pending invitation per (project, email). Only the hash is stored. |
| `invite_codes` | `company_id`, `project_id` (NULL = company-wide), `code` (`XXXX-XXXX`, Crockford base32, unique), `role` (always `inspector`), `expires_at`, `max_uses`, `use_count`, `revoked_at`, `created_by` | D11. |
| `invite_code_attempts` | `user_id`, `attempted_at`, `success` | Rate limiting. Clients have no access. |
| `activity_logs` | `company_id`, `project_id`, `entity_type`, `entity_id`, `activity_id`, `action`, `field`, `old_value`, `new_value`, `summary`, `note`, `via`, `actor_id`, `actor_name`, `wbs_code`, `activity_name`, `is_escalation`, `recorded_at`, `observed_at`, `client_id` (unique) | Append-only (see [Activity log](#activity-log)). Foreign keys are `ON DELETE SET NULL`, so purges keep the snapshots. |
| `notifications` | `user_id`, `project_id`, `company_id`, `type`, `title`, `body`, `link` (app path), `payload`, `in_app`, `read_at`, `email_status` (`pending`\|`sending`\|`sent`\|`skipped`\|`failed`\|`digest`\|`digested`), `email_attempts`, `emailed_at`, `email_error` | Inserted only by `private.notify`. Included in the `supabase_realtime` publication. |

### View `project_overview` (security_invoker)

The view returns one row per **visible, non-deleted** project. It has all the card and header columns of `projects` (id, company_id, name, site_*, description, dates, budget, status, status_reason, is_archived, weighting, near_budget_threshold, color, version, created_by, closed_at, created_at, updated_at), plus:

| Column | Definition |
|---|---|
| `allocated` | Σ `est_cost` of non-deleted **leaves** (a leaf has no non-deleted children) |
| `remaining` | `budget − allocated` |
| `leaf_count`, `activity_count`, `completed_count` | Leaves; non-deleted activities at every level; of those, the ones with status `completed` |
| `percent_complete` | Σ(w·percent)/Σw over leaves, rounded to 2 decimals, 0 when there are no leaves. w = primary basis (`weighting`) if > 0, else the other basis if > 0, else 1 (spec §6.5) |
| `budget_state` | `'exceeded'` if allocated > budget; `'near'` if allocated ≥ budget × `near_budget_threshold`; else `'ok'`. Exactly 100 % is `near`. |
| `is_delayed` | Manila today > `end_date` and status not completed/cancelled |
| `unscheduled_count` | Leaves missing `start_date`, `duration_hours` or `est_cost` |
| `my_project_role`, `my_company_role` | The caller's roles (NULL when none) |

The TS rollup module (`src/lib/domain`) must produce the same numbers (D23). Test 08 pins the reference values.

---

## Visibility and RLS

RLS is enabled on every `public` table. All policies are `SELECT` only, except one: `profiles_update_own`, which is column-limited by grants.

| Data | Who can read it |
|---|---|
| Projects (non-deleted) and everything under them: members, calendar, calendar dates, activities, baselines, project-scoped log rows | **Owner PM**: every project of the company. **PM / Inspector**: only the projects where they have a `project_members` row (spec Q12). |
| Soft-deleted projects | Owner PM only (trash / restore). Soft-deleted **activities** are hidden from everyone; use `activity_trash()`. |
| `companies`, `company_members` | Members of that company |
| `profiles` | Your own row plus everyone in your company. Inviter names on your pending invitations come only through `my_pending_invitations()`. |
| `invitations` | People who can manage the project (Owner PM, project PMs). Invitees use `my_pending_invitations()` / `get_invitation_by_token()`. |
| `invite_codes` | Company-wide codes: Owner PM and PMs. Project codes: managers of that project. |
| `activity_logs` | Project-scoped rows: anyone who can view the project. Company-scoped rows (`project_id IS NULL`): Owner PM only. |
| `notifications` | Your own rows (with `in_app = true`) |
| `ph_holidays` | Every signed-in user |
| `invite_code_attempts` | Nobody (deny-all policy, no grants) |

**Manage rights** (edit project, WBS, calendar, invitations, project members, archive, non-cancel status changes) belong to the Owner PM of the company or a `pm` member of that project. **Owner-PM-only**: cancel, delete and restore a project; rename the company; change company defaults; remove company members; change company roles. **Create project**: Owner PM or company PM. **Invite codes**: company-wide codes by the Owner PM or any company PM; project codes by managers of that project.

Helpers in `private` (STABLE, SECURITY DEFINER, `search_path = ''`): `my_company_id()`, `company_role(company_id)`, `is_company_member(company_id)`, `is_owner_pm(company_id)`, `owner_company_id()`, `pm_company_id()`, `company_peer_ids()`, `visible_project_ids()`, `manageable_project_ids()`, `can_view_project(project_id)`, `can_manage_project(project_id)`, `assert_can_manage_project(project_id)` (raises `NOT_FOUND` when the caller cannot see the project, `FORBIDDEN` when they can see it but not manage it), `project_manager_ids(project_id)`, `project_audience_ids(project_id)`. Policies call them as `(select private.fn())` so they run once per query.

---

## RPC catalog

Every RPC raises `UNAUTHENTICATED` without a signed-in user (except `get_invitation_by_token` and the service-role functions). For managed objects, `NOT_FOUND` means "doesn't exist or you can't see it" (other companies never learn that a row exists), and `FORBIDDEN` means "you can see it but your role can't do this". "Manager" means Owner PM or a `pm` member of the project.

### Onboarding, profile, company

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `company_name_available(p_name text)` | signed in | `boolean` (case/whitespace-insensitive) | — |
| `complete_profile(p_full_name text, p_role_pref text)` (`'pm'`\|`'inspector'`) | self | `profiles` row. Sets the name and `role_pref`; does **not** set `onboarded_at`. | `VALIDATION`, `NOT_FOUND` |
| `update_profile(p_patch jsonb)` (keys `full_name`, `avatar_url` (https), `duration_unit`) | self | `profiles` row | `VALIDATION`, `NOT_FOUND` |
| `create_company(p_name text)` | signed in, no company | `companies` row. The caller becomes `owner_pm`; `onboarded_at` set. | `ALREADY_IN_COMPANY`, `COMPANY_NAME_TAKEN`, `VALIDATION` |
| `finish_onboarding_without_company()` | self | `profiles` row (`onboarded_at` set: the "No company yet" state, D12) | `NOT_FOUND` |
| `rename_company(p_name text)` | Owner PM | `companies` row | `FORBIDDEN`, `VALIDATION`, `COMPANY_NAME_TAKEN` |
| `update_company_defaults(p_work_days smallint[], p_hours_per_day numeric)` | Owner PM | `companies` row (days de-duplicated and sorted) | `FORBIDDEN`, `NO_WORKING_DAYS`, `VALIDATION` |

### Members

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `add_project_member(p_project_id uuid, p_user_id uuid, p_role project_role)` | Manager | `project_members` row. For people already in the company (e.g. joined with a company-wide code). Notifies `added_to_project`. | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `ROLE_NOT_ALLOWED` (company inspector as project PM), `ALREADY_MEMBER` |
| `remove_project_member(p_project_id uuid, p_user_id uuid)` | Manager | `void`. Notifies `removed_from_project`. | `NOT_FOUND`, `FORBIDDEN`, `CANNOT_REMOVE_OWNER` |
| `remove_company_member(p_user_id uuid)` | Owner PM | `void`. Removes all project memberships; the person returns to "No company yet"; logs stay. Notifies `removed_from_company`. | `FORBIDDEN`, `NOT_FOUND`, `CANNOT_REMOVE_OWNER` |
| `set_company_member_role(p_user_id uuid, p_role company_role)` (`pm`\|`inspector`) | Owner PM | `company_members` row. Demoting to inspector also demotes that person's project PM roles. | `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `CANNOT_CHANGE_OWNER_ROLE` |

### Email invitations (spec §4.4)

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `invite_to_project(p_project_id uuid, p_email text, p_role project_role)` | Manager | `jsonb {invitation_id, token, resent, existing_user, email, role, company_name, project_name, inviter_name, expires_at}`. `token` is plaintext and returned **once**, for the email link. Re-inviting a pending email refreshes the token and expiry (`resent: true`). Existing users get `invitation_received`. | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `CANNOT_INVITE_SELF`, `INVITEE_IN_OTHER_COMPANY` (message never names the other company), `ALREADY_MEMBER` (also for the company's Owner PM) |
| `resend_invitation(p_invitation_id uuid)` | Manager | Same jsonb (works for pending or expired) | `NOT_FOUND`, `FORBIDDEN`, `INVITE_NOT_PENDING`, plus the invitee checks above |
| `revoke_invitation(p_invitation_id uuid)` | Manager | `void` | `NOT_FOUND`, `FORBIDDEN`, `INVITE_NOT_PENDING` |
| `my_pending_invitations()` | signed in | `setof (id, company_id, company_name, project_id, project_name, role, inviter_name, expires_at, created_at)`: pending, unexpired, matched on the auth email (case-insensitive) | — |
| `get_invitation_by_token(p_token text)` | **anon** + signed in | `jsonb {company_name, project_name, role, inviter_name, email_hint ("j***@gmail.com"), status, expired, expires_at, project_available}` (no ids) | `NOT_FOUND` |
| `accept_invitation(p_token text default null, p_invitation_id uuid default null)` | invitee (same email) | `jsonb {company_id, project_id, company_name, project_name, role}`. Joins the company. The company role is the higher of existing and invited (owner_pm > pm > inspector). Adds project membership, sets `onboarded_at`, notifies the inviter (`invitation_accepted`). | `VALIDATION`, `NOT_FOUND` (also wrong email by id), `INVITE_EMAIL_MISMATCH` (by token; shows the masked address), `INVITE_EXPIRED`, `INVITE_NOT_PENDING`, `INVITEE_IN_OTHER_COMPANY` |
| `decline_invitation(p_invitation_id uuid default null, p_token text default null)` | invitee | `void`. Notifies the inviter (`invitation_declined`). | `VALIDATION`, `NOT_FOUND`, `INVITE_EMAIL_MISMATCH`, `INVITE_NOT_PENDING` |

### Invite codes (D11)

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `create_invite_code(p_project_id uuid default null, p_expires_in_days int default null, p_max_uses int default null)` | Company-wide: Owner PM / PM. Project: Manager. | `invite_codes` row (`code` like `7K2M-Q9XD`) | `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` (expiry 1–365 days, uses 1–1000) |
| `revoke_invite_code(p_id uuid)` | Same as create | `invite_codes` row | `NOT_FOUND`, `FORBIDDEN` |
| `preview_invite_code(p_code text)` | signed in | `jsonb {valid, reason, message, code, company_name, project_name, scope ('company'\|'project')}`. Names only for usable codes. **Counts as an attempt.** | `RATE_LIMITED` |
| `redeem_invite_code(p_code text)` | signed in | `jsonb {ok, error_code, error_message, company_id, project_id, company_name, project_name, already_member}`. On success: joins as inspector (and the project for project codes), sets `onboarded_at`, increments `use_count`, notifies the creator (`member_joined`). | **Returned** (not raised, so the failed attempt is kept for rate limiting): `INVALID_CODE`, `CODE_EXPIRED`, `CODE_REVOKED`, `CODE_EXHAUSTED`. **Raised:** `RATE_LIMITED`, `INVITEE_IN_OTHER_COMPANY`. |

Input normalisation: upper-case, spaces and dashes stripped, `O→0`, `I/L→1`, dash re-inserted. Rate limit: 10 **failed** attempts (previews + redeems) per user per rolling hour.

### Projects (spec §5)

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `create_project(p_name text, p_start_date date, p_end_date date, p_budget numeric, p_site_name text default null, p_site_address text default null, p_description text default null, p_color project_color default 'blue')` | Owner PM / PM | `projects` row. Adds the creator as `pm`, creates the calendar from company defaults, and copies PH holidays for every year in [min(start year, Manila year) .. max(end year, Manila year + 1)]. | `FORBIDDEN`, `VALIDATION`, `INVALID_DATES`, `INVALID_BUDGET`, `PROJECT_NAME_TAKEN` |
| `update_project(p_project_id uuid, p_patch jsonb, p_expected_version int)` (keys `name`, `site_name`, `site_address`, `description`, `start_date`, `end_date`, `budget`, `weighting`, `near_budget_threshold` (0.5–1), `color`) | Manager | `projects` row | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `STALE_VERSION`, `INVALID_DATES`, `INVALID_BUDGET`, `PROJECT_NAME_TAKEN` |
| `set_project_status(p_project_id uuid, p_status project_status, p_reason text default null)` | Manager. `cancelled`: Owner PM. | `projects` row. Allowed: planning→active (captures **Baseline v1**), active↔on_hold (reason required for on_hold), active/on_hold→completed (≥ 1 activity and **every** non-deleted activity at every level completed), planning/active/on_hold→cancelled (reason required), completed→active (reopen). Notifies the audience (`project_status_changed`). | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `INVALID_TRANSITION`, `REASON_REQUIRED`, `PROJECT_HAS_INCOMPLETE_ACTIVITIES` (detail lists up to 10 `"<wbs> <name>"` + "and N more") |
| `set_project_archived(p_project_id uuid, p_archived boolean)` | Manager | `projects` row | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `NOT_CLOSED` |
| `delete_project(p_project_id uuid)` | Owner PM | `jsonb {project_id, name, deleted_at, restore_until}` (soft delete) | `NOT_FOUND`, `FORBIDDEN` |
| `restore_project(p_project_id uuid)` | Owner PM | `projects` row | `NOT_FOUND`, `RESTORE_EXPIRED` (> 30 days), `PROJECT_NAME_TAKEN` |
| `project_trash()` | Owner PM (others get no rows) | `setof (id, name, color, status, deleted_at, deleted_by, deleted_by_name, restore_until, name_conflict)`, deleted ≤ 30 days ago | — |

### WBS (spec §6)

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `create_activity(p_project_id uuid, p_parent_id uuid, p_name text, p_index int default null, p_fields jsonb default '{}')` (`p_parent_id` NULL = deliverable. `p_index` is 0-based among siblings; NULL or past the end = append. `p_fields` keys: `description`, `start_date`, `duration_hours`, `end_date`, `est_cost`) | Manager | `activities` row (with its final `wbs_code`) | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `INVALID_DATES`, `PARENT_NOT_FOUND`, `MAX_DEPTH_EXCEEDED` |
| `update_activity(p_activity_id uuid, p_patch jsonb, p_expected_version int)` (keys `name`, `description`, `start_date`, `duration_hours`, `end_date`, `est_cost`) | Manager | `activities` row | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `STALE_VERSION`, `INVALID_DATES` |
| `move_activity(p_activity_id uuid, p_new_parent_id uuid, p_new_index int default null)` | Manager | `jsonb {activity_id, changed, old_wbs_code, new_wbs_code, parent_id, index, level, renumbered}`. Reorders old and new siblings, recomputes levels and codes, logs **one** `move` entry (no-ops are not logged). | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `PARENT_NOT_FOUND`, `INVALID_MOVE` (self, own descendant, other project), `MAX_DEPTH_EXCEEDED` (new level + subtree height > 3) |
| `delete_activity(p_activity_id uuid)` | Manager | `jsonb {batch_id, activity_id, wbs_code, name, total, counts: {deliverables, sub_deliverables, work_packages}, deleted_at, restore_until}`. Soft-deletes the non-deleted subtree as one batch, renumbers, logs one `delete` entry. | `NOT_FOUND`, `FORBIDDEN` |
| `restore_activity(p_batch_id uuid)` | Manager | `jsonb {batch_id, activity_id, wbs_code, name, total, counts}`. Restores the batch at its original position, renumbers, logs one `restore` entry. | `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `RESTORE_EXPIRED`, `PARENT_DELETED` (restore the parent first), `MAX_DEPTH_EXCEEDED` |
| `apply_schedule(p_project_id uuid, p_rows jsonb)` (`[{id, start_date?, duration_hours?, end_date?}]`; a missing key keeps the stored value, `null` clears it) | Manager | `integer`: rows actually changed. All or nothing; every id must be a non-deleted activity of the project. Logged with `via = 'schedule'`. | `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `INVALID_DATES` |
| `activity_trash(p_project_id uuid)` | Manager | `setof (batch_id, activity_id, wbs_code, name, level, total, deliverables, sub_deliverables, work_packages, deleted_at, deleted_by, deleted_by_name, restore_until, parent_deleted)`, deleted ≤ 30 days ago | `NOT_FOUND`, `FORBIDDEN` |

The schedule math (end date from start + duration + calendar, D20) and the rollups (D21, D23) are done by the TS module. The database validates basic constraints and stores leaf values.

**Plan lock:** every WBS RPC above that changes data (and `save_calendar`) raises `FORBIDDEN` with "This project is completed, so its plan is locked. Reopen it from Project settings to make changes." or "This project is cancelled, so its plan can't be changed." while the project is Completed or Cancelled. Reads (`activity_trash`) still work; reopening (Completed → Active) unlocks the plan.

### Calendar (spec §7)

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `save_calendar(p_project_id uuid, p_work_days smallint[], p_holidays_nonworking boolean, p_hours_per_day numeric, p_dates jsonb, p_schedule jsonb default '[]')` | Manager | `jsonb {calendar, dates_added, dates_removed, dates_updated, activities_rescheduled}`. Runs in one transaction: settings, the **full replacement** date list `[{date, kind, name?}]` (only real differences are written and logged), and the app's rescheduled rows (`apply_schedule` shape, logged with `via = 'calendar'`). | `NOT_FOUND`, `FORBIDDEN`, `NO_WORKING_DAYS`, `VALIDATION` (bad/duplicate entries, both overrides on one date, hours outside 1–24), `INVALID_DATES` |

### Notifications

| RPC | Who | Returns | Errors |
|---|---|---|---|
| `notification_catalog()` | signed in | `setof (type, label, description, in_app_default, email_default)` | — |
| `mark_notifications_read(p_ids uuid[] default null)` (NULL = all mine) | self | `integer` (rows marked) | — |
| `update_notification_prefs(p_prefs jsonb)` (`{"<type>": {"in_app": bool, "email": bool}}`, merged per key; optional top-level `"email_digest": "off" \| "daily"`) | self | `jsonb`, the full stored preferences | `VALIDATION`, `NOT_FOUND` |
| `claim_email_batch(p_limit int default 20)` | **service_role** | `setof (id, type, title, body, link, payload, recipient_email, recipient_name, attempts)`. Claims `pending` rows (and `sending` rows stuck > 15 min) with `FOR UPDATE SKIP LOCKED` and marks them `sending`. | — |
| `complete_email(p_id uuid, p_status text, p_error text default null)` (`sent`\|`failed`\|`skipped`) | **service_role** | `void`. `failed` goes back to `pending` until 5 attempts. | `VALIDATION` |

### Jobs

| RPC | Who | Returns |
|---|---|---|
| `run_daily_checks()` | **service_role** (pg_cron calls `private.run_daily_checks()`) | `jsonb {ran_at, projects_delayed, delayed_markers_cleared, invitations_expired, activities_purged, projects_purged, code_attempts_trimmed}` |

---

## Error codes

`MESSAGE` = code, `DETAIL` = the specific human message (show it when present), `HINT` = field name for inline errors.

| Code | Meaning | Suggested UI message (fallback when there's no detail) |
|---|---|---|
| `UNAUTHENTICATED` | No signed-in user | "Please sign in to continue." |
| `FORBIDDEN` | You can see it, but your role can't do this | "You don't have permission to do that. Ask a project PM or the Owner PM." |
| `NOT_FOUND` | Doesn't exist, was deleted, or you have no access | "We couldn't find that. It may have been deleted or you no longer have access." |
| `VALIDATION` | Input invalid (see `hint` for the field) | Show `detail` inline on the field in `hint`. |
| `STALE_VERSION` | Someone changed the row since you loaded it | "Changed by someone else just now. Reload / Keep mine" |
| `ALREADY_IN_COMPANY` | Creating a company while already in one | "You already belong to a company." |
| `COMPANY_NAME_TAKEN` | Company name exists (case/space-insensitive) | "A company with this name already exists. Ask its Owner PM to invite you." |
| `NO_WORKING_DAYS` | Empty working-day set | "Pick at least one working day." |
| `ROLE_NOT_ALLOWED` | Company inspector made project PM | "Only company PMs can be project PMs. Ask the Owner PM to change their role first." |
| `ALREADY_MEMBER` | Person is already on the project (or is the Owner PM) | "This person is already on the project." |
| `CANNOT_REMOVE_OWNER` | Removing the Owner PM | "The Owner PM can't be removed." |
| `CANNOT_CHANGE_OWNER_ROLE` | Changing the Owner PM's role | "The Owner PM's role can't be changed." |
| `CANNOT_INVITE_SELF` | Inviting your own email | "That's your own email. Enter the person you want to invite." |
| `INVITEE_IN_OTHER_COMPANY` | Invitee/acceptor belongs to another company | "This person already belongs to another company." (never name it) |
| `INVITE_EMAIL_MISMATCH` | Signed in with a different email than invited | "This invitation was sent to j***@gmail.com. Sign in with that email." |
| `INVITE_EXPIRED` | Invitation past its 7 days | "This invitation expired. Ask for a new one." |
| `INVITE_NOT_PENDING` | Already accepted/declined/revoked | "This invitation was already used or cancelled." |
| `RATE_LIMITED` | 10 failed code attempts within the hour | "Too many incorrect codes. Try again in N minutes." |
| `INVALID_CODE` | Unknown code (or its project is gone) | "This code is not valid. Codes look like ABCD-2345." |
| `CODE_EXPIRED` | Code past its expiry | "This code has expired. Ask your PM for a new one." |
| `CODE_REVOKED` | Code turned off | "This code was turned off. Ask your PM for a new one." |
| `CODE_EXHAUSTED` | Code reached `max_uses` | "This code has reached its usage limit." |
| `INVALID_DATES` | End date before start date | "End date must be on or after <start>." |
| `INVALID_BUDGET` | Budget ≤ 0, > 2 decimals, or too large | "Enter a budget greater than ₱0.00." |
| `PROJECT_NAME_TAKEN` | Another non-deleted project in the company has this name | "Your company already has a project with this name." |
| `INVALID_TRANSITION` | Status change not allowed (§5.2) | "A project can't move from X to Y." |
| `REASON_REQUIRED` | On-Hold / Cancelled without a reason | "Add a reason." |
| `PROJECT_HAS_INCOMPLETE_ACTIVITIES` | Completing with open activities or none at all | Show `detail` (lists up to 10 open activities, with links). |
| `NOT_CLOSED` | Archiving an open project | "Only completed or cancelled projects can be archived." |
| `RESTORE_EXPIRED` | Trash item older than 30 days | "This was deleted more than 30 days ago and can't be restored." |
| `PARENT_NOT_FOUND` | Parent activity missing/deleted | "The parent was deleted or moved. Reload." |
| `PARENT_DELETED` | Restoring a child whose parent is in the trash | "Restore its parent first." |
| `MAX_DEPTH_EXCEEDED` | Would create a 4th WBS level | "The WBS has 3 levels: Deliverable → Sub-deliverable → Work package." |
| `INVALID_MOVE` | Moving under itself, a descendant, or another project | "You can't move an activity there." |
| `LOG_IMMUTABLE` | Attempt to change/delete activity-log rows | (should never reach the UI) |

Other Postgres errors the app can see: `42501` (permission denied, e.g. a direct table write) → treat as `FORBIDDEN`; `23514` (check violation on a direct `profiles` update) → `VALIDATION`; anything else → `UNEXPECTED` with a logged reference id.

---

## Triggers and jobs

| Trigger | Table | Purpose |
|---|---|---|
| `on_auth_user_change` | `auth.users` (insert / update of email, metadata) | Create and sync `profiles` |
| `set_updated_at` | all tables with `updated_at` | Maintain `updated_at` |
| `projects_before_update` | `projects` | Bump `version` (except for notification markers); maintain `closed_at`; clear `is_archived` on reopen; reset `delayed_notified_at` when the project closes or the end date moves to today or later |
| `activities_before_update` | `activities` | Bump `version` (except `wbs_code` / `sort_order` renumbering) |
| `project_members_check_company` | `project_members` | Members must belong to the project's company |
| `audit_*` | companies, company_members, projects, project_members, calendars, calendar_dates, activities, invitations, invite_codes | Write `activity_logs` (one row per meaningful field) |
| `activity_logs_no_update` / `_no_delete` / `_no_truncate` | `activity_logs` | Raise `LOG_IMMUTABLE` for any role. The only UPDATE allowed is `ON DELETE SET NULL` clearing an FK whose referenced row is really gone. |
| `activities_budget_insert` / `_update` / `_delete` (statement level) and `projects_budget_check` | `activities`, `projects.budget` | **Budget crossing.** When allocated goes from ≤ budget to > budget, notify the Owner PM + project PMs once (`project_budget_exceeded`, `budget_exceeded_notified_at`); the marker resets when allocated is back under. |

**Daily job** `private.run_daily_checks()` runs via pg_cron job `civpms-daily-checks` (`5 16 * * *` UTC = 00:05 Asia/Manila):
1. Projects that became Delayed (not deleted, not completed/cancelled, `end_date` < Manila today, not yet notified): set `delayed_notified_at`, log `delayed` (escalation, `via = 'system'`), notify Owner PM + project PMs (`project_delayed`). Also clears stale markers.
2. Pending invitations past `expires_at` become `expired`.
3. Purge: activities and projects soft-deleted more than 30 days ago are hard-deleted (children cascade). Log rows survive with NULL FKs and their text snapshots. A company-scoped `purge` entry is written for each project.
4. Trim `invite_code_attempts` older than 2 days.

**Daily email digest** `private.send_email_digests()` runs via pg_cron job `civpms-email-digest` (`55 22 * * *` UTC = 06:55 Asia/Manila). While a person has `email_digest = 'daily'`, `private.notify()` stores their email-eligible notifications with `email_status = 'digest'` (in-app delivery is unchanged); the job turns each person's held rows into one `email_digest` outbox row (up to 20 titles + "and N more", link `/notifications`, `in_app = false`) and marks the held rows `digested`.

Fallback if pg_cron is ever unavailable: a protected Vercel cron route (`Authorization: Bearer $CRON_SECRET`) calls `rpc('run_daily_checks')` with the secret-key client. Inspect runs with `select * from cron.job_run_details order by start_time desc limit 20;`.

---

## Activity log

- **Who / when / where:** `actor_id`, `actor_name` (snapshot; `System` for jobs), `recorded_at`, `observed_at` (offline sync, later), `wbs_code` + `activity_name` snapshots.
- **What:** `entity_type` ∈ `company`, `company_member`, `project`, `project_member`, `calendar`, `calendar_date`, `activity`, `invitation`, `invite_code`. `action` ∈ `create`, `update`, `rename`, `status_change`, `archive`, `unarchive`, `delete`, `restore`, `move`, `invite`, `resend`, `accept`, `decline`, `revoke`, `expire`, `join`, `remove`, `delayed`, `purge`. Updates write one row per changed field (`field`, `old_value`, `new_value`, readable `summary` such as `Budget: ₱1,000,000.00 → ₱1,200,000.00`). Renumbering is never logged per row: move, delete and restore write one summary entry each. Copying holidays into a new project is not logged.
- **Via:** `direct` (default), `invitation`, `invite_code`, `company_removal`, `schedule`, `calendar`, `system`. RPCs set it with `set_config('pms.via', …, true)`. Later phases add `cascade`, `inspection`, `offline_sync`, `import`. `pms.note` (transaction-local) fills `note`. Setting `pms.audit = 'off'` suppresses trigger logging inside an RPC that writes its own entry.
- **Escalations** (`is_escalation`): project → on_hold/cancelled; activity → delayed/on_hold; `percent` decreased; `delayed_reported` set; project became delayed.
- **Scope:** rows with `project_id` are visible to everyone who can view the project. Company-level rows (company, company members, company-wide codes, purges) have `project_id IS NULL` and are visible to the Owner PM only.

---

## Notifications and email

`private.notify(user_id, type, title, body, link, payload, project_id, company_id)` applies the user's `notification_prefs`. If both channels are off, nothing is stored. If in-app is off but email is on, the row is stored with `in_app = false` (hidden from the bell) and `read_at` set.

| Type | Recipient | In-app | Email (default) |
|---|---|:-:|:-:|
| `invitation_received` | Invitee with an existing account | ✓ | ✓ |
| `invitation_accepted` / `invitation_declined` | Inviter | ✓ | ✓ / — |
| `member_joined` | Creator of the invite code used | ✓ | — |
| `added_to_project` | Company member added by a PM | ✓ | — |
| `removed_from_project` / `removed_from_company` | Affected user | ✓ | ✓ |
| `project_budget_exceeded` | Owner PM + project PMs | ✓ | ✓ |
| `project_delayed` | Owner PM + project PMs | ✓ | ✓ |
| `project_status_changed` | Everyone on the project except the actor | ✓ | — |

Invitation emails to people **without** an account are sent by the app right after `invite_to_project` (it gets the plaintext token). Everything else goes through the outbox. A protected job route calls `claim_email_batch(n)`, sends each row via Brevo, then calls `complete_email(id, 'sent' | 'failed' | 'skipped', error)`. The bell can subscribe to Realtime `INSERT`s on `notifications` (RLS applies).

## Storage

Bucket `avatars`: public read through the public URL, 2 MB limit, `image/png`, `image/jpeg`, `image/webp`. Signed-in users can select, insert, update and delete only objects under `<their uid>/…` (e.g. `<uid>/avatar.webp`). After uploading, save the public URL with `update_profile({"avatar_url": "https://…"})`.

Bucket `project-media` (migration `20261015100000`): **private**, 3 MB limit, `image/webp` only. Objects are written by the media service (`backend/`) with the caller's own JWT under `<project_id>/<yyyy>/<mm>/<uuid>.webp` (+ `<uuid>_thumb.webp`); the INSERT policy accepts only names of exactly that shape. SELECT and INSERT: anyone in `private.visible_project_ids()` (Owner PM, project PMs, inspectors); DELETE: `private.manageable_project_ids()` (Owner PM, project PMs); no UPDATE policy (objects are immutable). The first path segment is compared as text, so malformed names cannot make a policy raise. Read objects through short-lived signed URLs. Because INSERT is granted to project members (the service uploads with the caller's token), members can also write objects directly, so treat every object as untrusted input (D48).

## Philippine holidays

`ph_holidays` is seeded by `20261012001300_seed_ph_holidays.sql`:
- **2026:** Proclamation No. 1006, s. 2025: 10 regular holidays and 8 special non-working days. Plus Eid'l Fitr (20 Mar 2026, Proclamation No. 1189, s. 2026) and Eid'l Adha (27 May 2026, Proclamation No. 1264, s. 2026). 25 Feb 2026 (EDSA anniversary) is a special **working** day and is not listed.
- **2027:** Proclamation No. 1427, s. 2026 (signed 8 Sep 2026): 10 regular holidays and 8 special non-working days. **Eid'l Fitr and Eid'l Adha 2027 are not included yet**; they are proclaimed separately. Add them, and any later ad-hoc proclamations, with a new migration (`insert … on conflict (date, name) do update`).
- Movable dates were cross-checked: Holy Week from Easter (5 Apr 2026, 28 Mar 2027); National Heroes Day is the last Monday of August.

Projects copy holidays per year only when that year has no `holiday` rows yet, so a PM's deliberate removals are never undone. Holidays added to `ph_holidays` later do **not** reach existing projects automatically. PMs edit their project's list, as spec A12 expects.

---

## Applying migrations from Windows

Prerequisites: Node 20+ (or Scoop), a Supabase access token, and the database password (Dashboard → Project Settings → Database).

```powershell
# 1. Install the CLI (pick one)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
#   …or run it through npx without installing:  npx supabase@latest <command>

# 2. From the repository root
supabase login                                   # opens the browser (or set $env:SUPABASE_ACCESS_TOKEN)
supabase link --project-ref bxfohhwvzbvmyokcsmwq # asks for the database password
supabase migration list                          # LOCAL and REMOTE columns must match
supabase db push --dry-run                       # shows what would be applied
supabase db push                                 # applies new files in supabase/migrations
```

- Create a new migration with `supabase migration new <name>` (it creates `supabase/migrations/<timestamp>_<name>.sql`). Keep timestamps increasing and never edit an applied file.
- If `migration list` ever shows a mismatch for a file that **is** applied (for example after an MCP `apply_migration`, which records its own timestamp), run `supabase migration repair --status applied <version>` for the file's version and `--status reverted <wrong version>` for the stray one. That is how versions `20261012000800`+ were aligned to these filenames.
- Regenerate types after every schema change: `npm run db:types` (writes `src/lib/supabase/database.types.ts`), then `npx tsc --noEmit -p .`.

## SQL tests

`supabase/tests/*.sql`: each file is self-contained. It runs in **one transaction**, creates a throwaway `tests` schema and `auth.users` rows, impersonates users with `set local role authenticated` + `request.jwt.claims`, asserts with `tests.ok` / `tests.eq` / `tests.expect_error` (which raise `ASSERTION FAILED: …`), and ends with `ROLLBACK`. On success the last result row is `NN_name: all assertions passed`. Nothing is left behind, so they can run against the live project.

| File | Covers |
|---|---|
| `01_privileges.sql` | RLS on every table; no anon table rights; only `get_invitation_by_token` executable by anon; service-role-only RPCs; `search_path` pinned on every function; view is security_invoker; realtime, pg_cron job, avatars bucket, holiday seed |
| `02_onboarding_company.sql` | Profile sync, `complete_profile`, "No company yet", `create_company`, case/whitespace-insensitive names, one company per user, owner-only settings, company defaults → new project calendar, role changes, company removal, column-limited profile updates, notification prefs |
| `03_isolation_rls.sql` | Owner sees all / PM and inspector only their projects; a non-member PM sees nothing; company B sees nothing of A and gets `NOT_FOUND` from every RPC; inspectors get `FORBIDDEN` for WBS/project/calendar/team changes; direct writes blocked; soft-deleted projects owner-only; private notifications; `activity_logs` immutable even for postgres |
| `04_invitations.sql` | Invite/resend/refresh token, hashing, `CANNOT_INVITE_SELF`, other-company block without leaking the name, Owner PM guard, anon preview, `INVITE_EMAIL_MISMATCH`, accept/decline/revoke/expire/resend, keep-the-higher role |
| `05_invite_codes.sql` | Code format, who can create and see codes, normalisation (O→0, I/L→1), redeem company-wide and project codes, exhausted/expired/revoked/invalid, other company, rate limit and window |
| `06_projects_status.sql` | Create validation, holiday copy, `STALE_VERSION`, per-field logs with ₱ formatting, every status transition, Baseline v1 rollups, completion blocked with the capped list, cancel by owner only, archive/reopen, delete/restore/name conflict/30-day expiry |
| `07_wbs_calendar.sql` | Codes and levels, insert at index, renumbering without version bumps or log noise, move (self/descendant/depth/cross-project), one move entry, delete/restore batches and positions, `PARENT_DELETED`, restore depth guard, `apply_schedule` atomicity, `save_calendar` diffing, logging and override flip |
| `08_overview_jobs.sql` | `project_overview` numbers (allocated, parents ignored, cost/hours weights with fallbacks, `budget_state` at 90 % and exactly 100 %), budget-crossing alerts once and again after reset, delayed detection and reset, purge keeping log snapshots, email outbox claim/complete, preferences |
| `09_notification_digest.sql` | `email_digest` validation and merge, digest hold in `notify()` only for email-eligible rows, one summary row per person with the capped list, held rows marked `digested`, job revoked from clients |
| `10_project_media_storage.sql` | `project-media` bucket config and policies: owner/project PM/inspector read + upload under their project, generated-name pattern enforced, non-member PM and other company see and write nothing, inspectors cannot delete, PMs and the Owner PM can, avatars bucket unaffected |
| `11_plan_lock.sql` | Completed project: create/update/move/delete/restore, `apply_schedule` and `save_calendar` all `FORBIDDEN` with the reason and nothing changes; trash still readable, archive still works; outsiders still get `NOT_FOUND` first; reopening unlocks; Cancelled stays locked |

Run them with psql (PowerShell). Use the **Session pooler** connection string from Dashboard → Connect, and never commit it:

```powershell
# paste the exact "Session pooler" URI from Dashboard → Connect (shape shown below)
$env:SUPABASE_DB_URL = "postgresql://postgres.bxfohhwvzbvmyokcsmwq:<password>@<pooler-host>:5432/postgres"
Get-ChildItem supabase/tests/*.sql | Sort-Object Name | ForEach-Object {
  psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -q -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "$($_.Name) failed" }
}
```

You can also paste a file into the Dashboard SQL editor, or run it through the Supabase MCP `execute_sql` tool. All eight passed against the live project on 2026-10-12; 10 on 2026-10-15; 11 on 2026-10-28 (through MCP `execute_sql`, ending in a raised sentinel instead of `ROLLBACK`, see `CLAUDE.md`).

## Advisors

Last run 2026-10-12 after all migrations:

- **Security:** two WARN lints remain, both intentional.
  - `0028 anon_security_definer_function_executable` on `get_invitation_by_token`: the invite landing page must show context before sign-in. It needs the 64-hex-char random token (256 bits), returns no ids and masks the email.
  - `0029 authenticated_security_definer_function_executable` on the 39 client RPCs: this is the "RPC-only writes" design. Every RPC checks the caller's company and project role and raises `NOT_FOUND`/`FORBIDDEN`. Tests 03–07 cover this.
  - `0008 rls_enabled_no_policy` was fixed with an explicit deny-all policy on `invite_code_attempts`.
- **Performance:** only `0005 unused_index` (INFO) on foreign-key and policy indexes. The database is still empty; these indexes are required (FK cascades/purges, RLS lookups) and stay.
