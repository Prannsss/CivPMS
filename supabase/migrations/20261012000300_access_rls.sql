-- Access helpers (private, SECURITY DEFINER, STABLE) and row level security.
-- Visibility rules (spec §2, Q12):
--   * Owner PM sees every non-deleted project of the company (+ deleted ones for trash).
--   * PMs and inspectors see only projects they are members of.
--   * Manage = owner_pm of the company OR pm member of the project.

create or replace function private.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.company_id from public.company_members cm where cm.user_id = (select auth.uid());
$$;

create or replace function private.company_role(p_company_id uuid)
returns public.company_role
language sql
stable
security definer
set search_path = ''
as $$
  select cm.role
    from public.company_members cm
   where cm.user_id = (select auth.uid()) and cm.company_id = p_company_id;
$$;

create or replace function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members cm
     where cm.user_id = (select auth.uid()) and cm.company_id = p_company_id
  );
$$;

create or replace function private.is_owner_pm(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members cm
     where cm.user_id = (select auth.uid()) and cm.company_id = p_company_id and cm.role = 'owner_pm'
  );
$$;

-- Company of the caller when the caller is its Owner PM, else NULL.
create or replace function private.owner_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.company_id from public.company_members cm
   where cm.user_id = (select auth.uid()) and cm.role = 'owner_pm';
$$;

-- Company of the caller when the caller is Owner PM or PM there, else NULL.
create or replace function private.pm_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.company_id from public.company_members cm
   where cm.user_id = (select auth.uid()) and cm.role in ('owner_pm', 'pm');
$$;

-- User ids of everyone in the caller's company (including the caller).
create or replace function private.company_peer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select peer.user_id
    from public.company_members me
    join public.company_members peer on peer.company_id = me.company_id
   where me.user_id = (select auth.uid());
$$;

-- Non-deleted projects the caller can view (used by RLS: evaluated once per query).
create or replace function private.visible_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.company_members cm
    join public.projects p on p.company_id = cm.company_id and p.deleted_at is null
   where cm.user_id = (select auth.uid())
     and (cm.role = 'owner_pm'
          or exists (select 1 from public.project_members pm
                      where pm.project_id = p.id and pm.user_id = cm.user_id));
$$;

-- Non-deleted projects the caller can manage.
create or replace function private.manageable_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.company_members cm
    join public.projects p on p.company_id = cm.company_id and p.deleted_at is null
   where cm.user_id = (select auth.uid())
     and (cm.role = 'owner_pm'
          or exists (select 1 from public.project_members pm
                      where pm.project_id = p.id and pm.user_id = cm.user_id and pm.role = 'pm'));
$$;

-- Can the caller view this project? Soft-deleted projects: Owner PM only.
create or replace function private.can_view_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.projects p
      join public.company_members cm on cm.company_id = p.company_id and cm.user_id = (select auth.uid())
     where p.id = p_project_id
       and (cm.role = 'owner_pm'
            or (p.deleted_at is null
                and exists (select 1 from public.project_members pm
                             where pm.project_id = p.id and pm.user_id = cm.user_id)))
  );
$$;

-- Can the caller manage (edit project, WBS, calendar, members) this non-deleted project?
create or replace function private.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.projects p
      join public.company_members cm on cm.company_id = p.company_id and cm.user_id = (select auth.uid())
     where p.id = p_project_id
       and p.deleted_at is null
       and (cm.role = 'owner_pm'
            or exists (select 1 from public.project_members pm
                        where pm.project_id = p.id and pm.user_id = cm.user_id and pm.role = 'pm'))
  );
$$;

-- Raise NOT_FOUND (cannot see it) or FORBIDDEN (can see, cannot manage).
create or replace function private.assert_can_manage_project(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if private.can_manage_project(p_project_id) then
    return;
  end if;
  if p_project_id is not null
     and private.can_view_project(p_project_id)
     and exists (select 1 from public.projects p where p.id = p_project_id and p.deleted_at is null) then
    perform private.raise_error('FORBIDDEN', 'Only the project''s PMs and the Owner PM can make this change.');
  end if;
  perform private.raise_error('NOT_FOUND', 'This project does not exist or you no longer have access to it.', 'project_id');
end;
$$;

-- Owner PM + PM members of a project (notification recipients).
create or replace function private.project_manager_ids(p_project_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.user_id
    from public.projects p
    join public.company_members cm on cm.company_id = p.company_id and cm.role = 'owner_pm'
   where p.id = p_project_id
  union
  select pm.user_id from public.project_members pm
   where pm.project_id = p_project_id and pm.role = 'pm';
$$;

-- Everyone with access to a project (owner + members).
create or replace function private.project_audience_ids(p_project_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cm.user_id
    from public.projects p
    join public.company_members cm on cm.company_id = p.company_id and cm.role = 'owner_pm'
   where p.id = p_project_id
  union
  select pm.user_id from public.project_members pm where pm.project_id = p_project_id;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
-- Helpers referenced by RLS policies must be executable by the querying role.
grant execute on function
  private.my_company_id(),
  private.owner_company_id(),
  private.pm_company_id(),
  private.company_peer_ids(),
  private.visible_project_ids(),
  private.manageable_project_ids()
to authenticated;

-- ---------------------------------------------------------------------------
-- Policies (SELECT only unless noted; writes go through RPCs)
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or id in (select private.company_peer_ids()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy companies_select on public.companies
  for select to authenticated
  using (id = (select private.my_company_id()));

create policy company_members_select on public.company_members
  for select to authenticated
  using (company_id = (select private.my_company_id()));

create policy projects_select on public.projects
  for select to authenticated
  using (
    id in (select private.visible_project_ids())
    or (deleted_at is not null and company_id = (select private.owner_company_id()))
  );

create policy project_members_select on public.project_members
  for select to authenticated
  using (project_id in (select private.visible_project_ids()));

create policy calendars_select on public.calendars
  for select to authenticated
  using (project_id in (select private.visible_project_ids()));

create policy calendar_dates_select on public.calendar_dates
  for select to authenticated
  using (project_id in (select private.visible_project_ids()));

create policy ph_holidays_select on public.ph_holidays
  for select to authenticated
  using (true);

-- Soft-deleted activities are hidden; the trash is served by activity_trash().
create policy activities_select on public.activities
  for select to authenticated
  using (deleted_at is null and project_id in (select private.visible_project_ids()));

create policy baselines_select on public.baselines
  for select to authenticated
  using (project_id in (select private.visible_project_ids()));

create policy baseline_activities_select on public.baseline_activities
  for select to authenticated
  using (project_id in (select private.visible_project_ids()));

create policy invitations_select on public.invitations
  for select to authenticated
  using (project_id in (select private.manageable_project_ids()));

create policy invite_codes_select on public.invite_codes
  for select to authenticated
  using (
    (project_id is null and company_id = (select private.pm_company_id()))
    or project_id in (select private.manageable_project_ids())
  );

-- invite_code_attempts: RLS on, no policies, no grants (server-side only).

create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (
    (project_id is not null and project_id in (select private.visible_project_ids()))
    or (project_id is null and company_id = (select private.owner_company_id()))
  );

create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and in_app);

-- ---------------------------------------------------------------------------
-- activity_logs is append-only for everyone (including table owners)
-- ---------------------------------------------------------------------------
create or replace function private.activity_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c_fk constant text[] := array['company_id', 'project_id', 'activity_id', 'actor_id'];
begin
  -- The only permitted UPDATE is a foreign key being cleared by ON DELETE SET NULL
  -- when a purged project/activity/user disappears; the snapshot columns survive.
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - c_fk) = (to_jsonb(old) - c_fk)
     and (new.company_id is not distinct from old.company_id or new.company_id is null)
     and (new.project_id is not distinct from old.project_id or new.project_id is null)
     and (new.activity_id is not distinct from old.activity_id or new.activity_id is null)
     and (new.actor_id is not distinct from old.actor_id or new.actor_id is null) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'LOG_IMMUTABLE',
    detail = 'Activity log entries cannot be changed or deleted.',
    hint = '';
end;
$$;
create trigger activity_logs_no_update before update on public.activity_logs
  for each row execute function private.activity_logs_append_only();
create trigger activity_logs_no_delete before delete on public.activity_logs
  for each row execute function private.activity_logs_append_only();
create trigger activity_logs_no_truncate before truncate on public.activity_logs
  for each statement execute function private.activity_logs_append_only();

revoke insert, update, delete, truncate on public.activity_logs from anon, authenticated, service_role;
revoke all on function private.activity_logs_append_only() from public, anon, authenticated;
