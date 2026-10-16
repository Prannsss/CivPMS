-- CivPMS core tables (Phase 0–1). Spec §18.2; names stay compatible with later
-- phases (dependencies, inspections, media, viewers are added later).

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  email text check (email is null or email = lower(email)),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  role_pref text check (role_pref is null or role_pref in ('pm', 'inspector')),
  duration_unit public.duration_unit not null default 'hours',
  onboarded_at timestamptz,
  notification_prefs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(notification_prefs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user. email is a lowercase copy of auth.users.email kept in sync by trigger.';
comment on column public.profiles.notification_prefs is 'Per event type {"<type>": {"in_app": bool, "email": bool}}; missing entries use defaults.';
create index profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- companies & membership (one company per user, D13)
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  name_key text generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  default_work_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(default_work_days) between 1 and 7 and default_work_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  default_hours_per_day numeric(4,2) not null default 8 check (default_hours_per_day between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_name_key_key on public.companies (name_key);
create index companies_owner_id_idx on public.companies (owner_id);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role public.company_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index company_members_company_id_idx on public.company_members (company_id, role);
-- Exactly one owner per company: at most one here, at least one enforced by the RPCs.
create unique index company_members_one_owner_key on public.company_members (company_id) where role = 'owner_pm';

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 3 and 120),
  name_key text generated always as (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) stored,
  site_name text check (site_name is null or char_length(site_name) <= 200),
  site_address text check (site_address is null or char_length(site_address) <= 500),
  description text check (description is null or char_length(description) <= 5000),
  start_date date not null,
  end_date date not null,
  budget numeric(14,2) not null check (budget > 0),
  status public.project_status not null default 'planning',
  status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  is_archived boolean not null default false,
  weighting public.weighting_basis not null default 'cost',
  near_budget_threshold numeric(4,3) not null default 0.9
    check (near_budget_threshold > 0 and near_budget_threshold <= 1),
  color public.project_color not null default 'blue',
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  budget_exceeded_notified_at timestamptz,
  delayed_notified_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_check check (end_date >= start_date),
  constraint projects_archive_check check (not is_archived or status in ('completed', 'cancelled'))
);
comment on column public.projects.closed_at is 'Set when the project becomes completed/cancelled, cleared on reopen (1-year retention clock, spec §19).';
create unique index projects_company_name_key_key on public.projects (company_id, name_key) where deleted_at is null;
create index projects_company_id_idx on public.projects (company_id) where deleted_at is null;
create index projects_deleted_idx on public.projects (company_id, deleted_at) where deleted_at is not null;
create index projects_created_by_idx on public.projects (created_by);
create index projects_deleted_by_idx on public.projects (deleted_by);
create index projects_open_end_date_idx on public.projects (end_date)
  where deleted_at is null and status not in ('completed', 'cancelled');

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_members_project_user_key unique (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members (user_id, project_id, role);
create index project_members_invited_by_idx on public.project_members (invited_by);

-- ---------------------------------------------------------------------------
-- Working calendar (spec §7)
-- ---------------------------------------------------------------------------
create table public.calendars (
  project_id uuid primary key references public.projects (id) on delete cascade,
  work_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(work_days) between 1 and 7 and work_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  holidays_nonworking boolean not null default true,
  hours_per_day numeric(4,2) not null default 8 check (hours_per_day between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.calendars.work_days is 'ISO weekdays: 1 = Monday … 7 = Sunday.';

create table public.calendar_dates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date date not null,
  kind public.calendar_date_kind not null,
  name text check (name is null or char_length(name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_dates_project_date_kind_key unique (project_id, date, kind)
);
-- A date cannot be overridden both ways.
create unique index calendar_dates_one_override_key on public.calendar_dates (project_id, date)
  where kind <> 'holiday';

create table public.ph_holidays (
  id bigint generated always as identity primary key,
  date date not null,
  name text not null,
  type text not null check (type in ('regular', 'special_non_working')),
  year smallint generated always as (extract(year from date)::smallint) stored,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_holidays_date_name_key unique (date, name)
);
create index ph_holidays_year_idx on public.ph_holidays (year);

-- ---------------------------------------------------------------------------
-- WBS activities (spec §6). Level = depth (1 deliverable, 2 sub-deliverable,
-- 3 work package), maintained by RPCs together with sort_order and wbs_code.
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid,
  level smallint not null check (level between 1 and 3),
  sort_order integer not null default 0 check (sort_order >= 0),
  wbs_code text not null default '',
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  start_date date,
  duration_hours numeric(10,2) check (duration_hours is null or duration_hours >= 0),
  end_date date,
  est_cost numeric(14,2) check (est_cost is null or est_cost >= 0),
  status public.activity_status not null default 'not_started',
  percent smallint not null default 0 check (percent between 0 and 100),
  delayed_reported boolean not null default false,
  version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_batch uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_project_id_id_key unique (project_id, id),
  constraint activities_parent_fkey foreign key (project_id, parent_id)
    references public.activities (project_id, id) on delete cascade,
  constraint activities_parent_level_check check ((parent_id is null) = (level = 1)),
  constraint activities_not_own_parent_check check (parent_id is null or parent_id <> id),
  constraint activities_dates_check check (start_date is null or end_date is null or end_date >= start_date),
  constraint activities_deleted_check check ((deleted_at is null) = (deleted_batch is null))
);
comment on column public.activities.duration_hours is 'Working hours (D20). Parents ignore their own cost/hours/dates once they have children (D21).';
comment on column public.activities.deleted_batch is 'One id per delete action so a subtree restores together.';
create index activities_tree_idx on public.activities (project_id, parent_id, sort_order) where deleted_at is null;
create index activities_parent_id_idx on public.activities (parent_id);
create index activities_deleted_batch_idx on public.activities (deleted_batch) where deleted_batch is not null;
create index activities_created_by_idx on public.activities (created_by);
create index activities_deleted_by_idx on public.activities (deleted_by);

-- ---------------------------------------------------------------------------
-- Baselines (spec §8.4). v1 is captured automatically on planning → active.
-- ---------------------------------------------------------------------------
create table public.baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  reason text check (reason is null or char_length(reason) <= 1000),
  is_active boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint baselines_project_version_key unique (project_id, version_no)
);
create unique index baselines_one_active_key on public.baselines (project_id) where is_active;
create index baselines_created_by_idx on public.baselines (created_by);

create table public.baseline_activities (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references public.baselines (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  parent_activity_id uuid,
  level smallint not null,
  is_leaf boolean not null,
  wbs_code text not null,
  name text not null,
  start_date date,
  end_date date,
  hours numeric(12,2),
  cost numeric(16,2),
  weight numeric(18,4),
  created_at timestamptz not null default now(),
  constraint baseline_activities_baseline_activity_key unique (baseline_id, activity_id)
);
comment on table public.baseline_activities is 'Frozen plan per activity. Parents hold rolled-up values (min start, max end, sums); weight follows the project weighting with fallbacks.';
create index baseline_activities_project_id_idx on public.baseline_activities (project_id);
create index baseline_activities_activity_id_idx on public.baseline_activities (activity_id);

-- ---------------------------------------------------------------------------
-- Email invitations (spec §4.4)
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.project_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invitations_one_pending_key on public.invitations (project_id, email) where status = 'pending';
create index invitations_email_pending_idx on public.invitations (email) where status = 'pending';
create index invitations_company_id_idx on public.invitations (company_id);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_accepted_by_idx on public.invitations (accepted_by);
create index invitations_expiry_idx on public.invitations (expires_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Invite codes for inspectors (D11)
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  code text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  role public.project_role not null default 'inspector' check (role = 'inspector'),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.invite_codes.project_id is 'NULL = company-wide code.';
create index invite_codes_company_id_idx on public.invite_codes (company_id, project_id);
create index invite_codes_project_id_idx on public.invite_codes (project_id);
create index invite_codes_created_by_idx on public.invite_codes (created_by);

create table public.invite_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null
);
comment on table public.invite_code_attempts is 'Rate limiting for invite-code redemption. No client access.';
create index invite_code_attempts_user_idx on public.invite_code_attempts (user_id, attempted_at desc);

-- ---------------------------------------------------------------------------
-- Activity log: append-only audit trail (spec §10.6)
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  activity_id uuid references public.activities (id) on delete set null,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  summary text,
  note text,
  via text not null default 'direct',
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  wbs_code text,
  activity_name text,
  is_escalation boolean not null default false,
  recorded_at timestamptz not null default now(),
  observed_at timestamptz,
  client_id text unique
);
comment on table public.activity_logs is 'Append-only. Written by SECURITY DEFINER triggers; UPDATE/DELETE/TRUNCATE are blocked for every role.';
create index activity_logs_project_idx on public.activity_logs (project_id, recorded_at desc, id desc);
create index activity_logs_company_idx on public.activity_logs (company_id, recorded_at desc, id desc);
create index activity_logs_activity_idx on public.activity_logs (activity_id, recorded_at desc);
create index activity_logs_actor_idx on public.activity_logs (actor_id);
create index activity_logs_entity_idx on public.activity_logs (entity_id);

-- ---------------------------------------------------------------------------
-- Notifications + email outbox (spec §14)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  type text not null check (type ~ '^[a-z][a-z_]*$'),
  title text not null,
  body text,
  link text check (link is null or link like '/%'),
  payload jsonb not null default '{}'::jsonb,
  in_app boolean not null default true,
  read_at timestamptz,
  email_status text not null default 'skipped'
    check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  email_attempts integer not null default 0,
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.notifications.link is 'App-relative path, e.g. /projects/<id>.';
comment on column public.notifications.in_app is 'false when the user turned in-app off for this type but still wants the email.';
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_outbox_idx on public.notifications (created_at) where email_status in ('pending', 'sending');
create index notifications_project_id_idx on public.notifications (project_id);
create index notifications_company_id_idx on public.notifications (company_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.companies for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_members for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.projects for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.project_members for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.calendars for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.calendar_dates for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.ph_holidays for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.activities for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.baselines for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invitations for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invite_codes for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.notifications for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Optimistic concurrency + project bookkeeping
-- ---------------------------------------------------------------------------

-- projects: bump version on every change except pure bookkeeping columns;
-- maintain closed_at and reset the delayed notification marker (spec §5.4).
create or replace function private.projects_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['updated_at', 'version', 'budget_exceeded_notified_at', 'delayed_notified_at'])
     is distinct from
     (to_jsonb(old) - array['updated_at', 'version', 'budget_exceeded_notified_at', 'delayed_notified_at']) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('completed', 'cancelled') then
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
      new.is_archived := false;
    end if;
  end if;

  if new.delayed_notified_at is not null
     and (new.status in ('completed', 'cancelled')
          or (new.end_date is distinct from old.end_date and new.end_date >= private.manila_today())) then
    new.delayed_notified_at := null;
  end if;
  return new;
end;
$$;
create trigger projects_before_update before update on public.projects
  for each row execute function private.projects_before_update();

-- activities: bump version on every change except renumbering noise.
create or replace function private.activities_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['updated_at', 'version', 'wbs_code', 'sort_order'])
     is distinct from
     (to_jsonb(old) - array['updated_at', 'version', 'wbs_code', 'sort_order']) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;
create trigger activities_before_update before update on public.activities
  for each row execute function private.activities_before_update();

-- project_members must belong to the project's company (defense in depth).
create or replace function private.project_members_check_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
     where p.id = new.project_id and cm.user_id = new.user_id
  ) then
    perform private.raise_error('VALIDATION', 'Only members of the project''s company can be added to the project.', 'user_id');
  end if;
  return new;
end;
$$;
create trigger project_members_check_company before insert or update of project_id, user_id on public.project_members
  for each row execute function private.project_members_check_company();

-- ---------------------------------------------------------------------------
-- auth.users → profiles sync
-- ---------------------------------------------------------------------------
create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_text(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120));
  v_avatar text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')), '');
begin
  if v_avatar is not null and char_length(v_avatar) > 2048 then
    v_avatar := null;
  end if;
  insert into public.profiles as p (id, email, full_name, avatar_url)
  values (new.id, lower(new.email), v_name, v_avatar)
  on conflict (id) do update
    set email = excluded.email,
        -- never overwrite what the user chose in the app; only fill blanks
        full_name = coalesce(p.full_name, excluded.full_name),
        avatar_url = coalesce(p.avatar_url, excluded.avatar_url);
  return new;
end;
$$;
create trigger on_auth_user_change
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.handle_auth_user_change();

-- ---------------------------------------------------------------------------
-- Row level security: enabled everywhere (policies in the next migration)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.calendars enable row level security;
alter table public.calendar_dates enable row level security;
alter table public.ph_holidays enable row level security;
alter table public.activities enable row level security;
alter table public.baselines enable row level security;
alter table public.baseline_activities enable row level security;
alter table public.invitations enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_code_attempts enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;

-- Table privileges: clients read through RLS; all writes go through RPCs
-- (except the column-limited profile update granted below).
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.invite_code_attempts from authenticated;
grant update (full_name, avatar_url, duration_unit) on public.profiles to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
