-- Projects (spec §5): create, edit, status transitions, archive, trash.
-- Also: holiday copy, baseline capture (§8.4) and the budget-exceeded trigger.

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------
create or replace function private.optional_text(p_value text, p_field text, p_max integer, p_collapse boolean default true)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := case when p_collapse then private.clean_text(p_value) else nullif(btrim(p_value), '') end;
begin
  if v is not null and char_length(v) > p_max then
    perform private.raise_error('VALIDATION',
      format('%s can be up to %s characters.', private.field_label(p_field), p_max), p_field);
  end if;
  return v;
end;
$$;

create or replace function private.validate_project_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.clean_text(p_name);
begin
  if v is null or char_length(v) < 3 or char_length(v) > 120 then
    perform private.raise_error('VALIDATION', 'Project names need 3 to 120 characters.', 'name');
  end if;
  return v;
end;
$$;

create or replace function private.validate_project_dates(p_start date, p_end date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_start is null then
    perform private.raise_error('VALIDATION', 'Enter the estimated start date.', 'start_date');
  end if;
  if p_end is null then
    perform private.raise_error('VALIDATION', 'Enter the estimated end date.', 'end_date');
  end if;
  if p_end < p_start then
    perform private.raise_error('INVALID_DATES',
      format('End date must be on or after %s.', private.fmt_date(p_start)), 'end_date');
  end if;
end;
$$;

create or replace function private.validate_budget(p_budget numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_budget is null or p_budget <= 0 then
    perform private.raise_error('INVALID_BUDGET', 'Enter a budget greater than ₱0.00.', 'budget');
  end if;
  if p_budget <> round(p_budget, 2) then
    perform private.raise_error('INVALID_BUDGET', 'Budgets can have at most 2 decimal places.', 'budget');
  end if;
  if p_budget > 999999999999.99 then
    perform private.raise_error('INVALID_BUDGET', 'The budget is too large. The maximum is ₱999,999,999,999.99.', 'budget');
  end if;
  return p_budget;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calendar / baseline / budget helpers
-- ---------------------------------------------------------------------------

-- Copy PH holidays into a project for every year in range that has no holiday
-- rows yet (so deliberate removals are not undone).
create or replace function private.copy_holidays(p_project_id uuid, p_from_year integer, p_to_year integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.calendar_dates (project_id, date, kind, name)
  select p_project_id, h.date, 'holiday', string_agg(h.name, ' / ' order by h.type, h.name)
    from public.ph_holidays h
   where h.year between p_from_year and p_to_year
     and not exists (
       select 1 from public.calendar_dates cd
        where cd.project_id = p_project_id
          and cd.kind = 'holiday'
          and cd.date >= make_date(h.year, 1, 1)
          and cd.date < make_date(h.year + 1, 1, 1))
   group by h.date
  on conflict (project_id, date, kind) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Σ estimated cost of non-deleted leaves (leaf = no non-deleted children).
create or replace function private.project_allocated(p_project_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.est_cost), 0)
    from public.activities a
   where a.project_id = p_project_id
     and a.deleted_at is null
     and not exists (select 1 from public.activities c where c.parent_id = a.id and c.deleted_at is null);
$$;

-- Freeze the current plan as a new active baseline. Parents get rolled-up
-- values; leaf weight = primary basis if > 0, else the other basis, else 1.
create or replace function private.capture_baseline(p_project_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_no integer;
  v_weighting public.weighting_basis;
  v_actor uuid;
begin
  select p.weighting into v_weighting from public.projects p where p.id = p_project_id;
  select pr.id into v_actor from public.profiles pr where pr.id = auth.uid();
  select coalesce(max(b.version_no), 0) + 1 into v_no from public.baselines b where b.project_id = p_project_id;
  update public.baselines set is_active = false where project_id = p_project_id and is_active;
  insert into public.baselines (project_id, version_no, reason, is_active, created_by)
  values (p_project_id, v_no, p_reason, true, v_actor)
  returning id into v_id;

  with recursive live as (
    select a.id, a.parent_id, a.level, a.wbs_code, a.name, a.start_date, a.end_date, a.duration_hours, a.est_cost
      from public.activities a
     where a.project_id = p_project_id and a.deleted_at is null
  ), leaf as (
    select l.id, l.start_date, l.end_date, l.duration_hours, l.est_cost,
           case when v_weighting = 'cost' then
                  case when coalesce(l.est_cost, 0) > 0 then l.est_cost
                       when coalesce(l.duration_hours, 0) > 0 then l.duration_hours
                       else 1 end
                else
                  case when coalesce(l.duration_hours, 0) > 0 then l.duration_hours
                       when coalesce(l.est_cost, 0) > 0 then l.est_cost
                       else 1 end
           end as weight
      from live l
     where not exists (select 1 from live c where c.parent_id = l.id)
  ), anc as (
    select lf.id as leaf_id, lf.id as node_id from leaf lf
    union all
    select anc.leaf_id, l.parent_id
      from anc join live l on l.id = anc.node_id
     where l.parent_id is not null
  )
  insert into public.baseline_activities (
    baseline_id, project_id, activity_id, parent_activity_id, level, is_leaf, wbs_code, name,
    start_date, end_date, hours, cost, weight)
  select v_id, p_project_id, l.id, l.parent_id, l.level, bool_or(anc.leaf_id = l.id), l.wbs_code, l.name,
         min(lf.start_date), max(lf.end_date), sum(lf.duration_hours), sum(lf.est_cost), sum(lf.weight)
    from live l
    join anc on anc.node_id = l.id
    join leaf lf on lf.id = anc.leaf_id
   group by l.id, l.parent_id, l.level, l.wbs_code, l.name;
  return v_id;
end;
$$;

-- Notify Owner PM + project PMs once when allocated goes over budget; reset
-- the marker when it is back under.
create or replace function private.check_project_budget(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_allocated numeric;
begin
  select * into v_project from public.projects where id = p_project_id for no key update;
  if not found or v_project.deleted_at is not null then
    return;
  end if;
  v_allocated := private.project_allocated(p_project_id);
  if v_allocated > v_project.budget and v_project.budget_exceeded_notified_at is null then
    update public.projects set budget_exceeded_notified_at = now() where id = p_project_id;
    perform private.notify(m.user_id, 'project_budget_exceeded',
        format('%s is over budget', v_project.name),
        format('Allocated cost %s is above the budget of %s (%s over).',
               private.fmt_money(v_allocated), private.fmt_money(v_project.budget),
               private.fmt_money(v_allocated - v_project.budget)),
        format('/projects/%s', v_project.id),
        jsonb_build_object('project_id', v_project.id, 'project_name', v_project.name,
                           'allocated', v_allocated, 'budget', v_project.budget),
        v_project.id, v_project.company_id)
      from private.project_manager_ids(p_project_id) as m(user_id);
  elsif v_allocated <= v_project.budget and v_project.budget_exceeded_notified_at is not null then
    update public.projects set budget_exceeded_notified_at = null where id = p_project_id;
  end if;
end;
$$;

create or replace function private.on_activities_budget_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  for v_project_id in select distinct r.project_id from changed_rows r loop
    perform private.check_project_budget(v_project_id);
  end loop;
  return null;
end;
$$;

create or replace function private.on_activities_budget_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  for v_project_id in
    select distinct n.project_id
      from new_rows n
      join old_rows o on o.id = n.id
     where n.est_cost is distinct from o.est_cost
        or n.deleted_at is distinct from o.deleted_at
        or n.parent_id is distinct from o.parent_id
  loop
    perform private.check_project_budget(v_project_id);
  end loop;
  return null;
end;
$$;

create trigger activities_budget_insert after insert on public.activities
  referencing new table as changed_rows
  for each statement execute function private.on_activities_budget_rows();
create trigger activities_budget_update after update on public.activities
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.on_activities_budget_update();
create trigger activities_budget_delete after delete on public.activities
  referencing old table as changed_rows
  for each statement execute function private.on_activities_budget_rows();

create or replace function private.on_project_budget_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_project_budget(new.id);
  return null;
end;
$$;
create trigger projects_budget_check after update of budget on public.projects
  for each row when (new.budget is distinct from old.budget)
  execute function private.on_project_budget_change();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_budget numeric,
  p_site_name text default null,
  p_site_address text default null,
  p_description text default null,
  p_color public.project_color default 'blue'
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_member public.company_members;
  v_company public.companies;
  v_name text;
  v_budget numeric;
  v_project public.projects;
  v_today date := private.manila_today();
begin
  select * into v_member from public.company_members where user_id = v_uid;
  if not found then
    perform private.raise_error('FORBIDDEN', 'Join or create a company before creating projects.');
  end if;
  if v_member.role not in ('owner_pm', 'pm') then
    perform private.raise_error('FORBIDDEN', 'Only PMs can create projects.');
  end if;
  select * into v_company from public.companies where id = v_member.company_id;

  v_name := private.validate_project_name(p_name);
  perform private.validate_project_dates(p_start_date, p_end_date);
  v_budget := private.validate_budget(p_budget);
  if exists (select 1 from public.projects p
              where p.company_id = v_company.id and p.name_key = private.name_key(v_name) and p.deleted_at is null) then
    perform private.raise_error('PROJECT_NAME_TAKEN', 'Your company already has a project with this name. Pick a different name.', 'name');
  end if;

  begin
    insert into public.projects (company_id, name, site_name, site_address, description,
                                 start_date, end_date, budget, color, created_by)
    values (v_company.id, v_name,
            private.optional_text(p_site_name, 'site_name', 200),
            private.optional_text(p_site_address, 'site_address', 500),
            private.optional_text(p_description, 'description', 5000, false),
            p_start_date, p_end_date, v_budget, coalesce(p_color, 'blue'), v_uid)
    returning * into v_project;
  exception when unique_violation then
    perform private.raise_error('PROJECT_NAME_TAKEN', 'Your company already has a project with this name. Pick a different name.', 'name');
  end;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (v_project.id, v_uid, 'pm', v_uid);
  insert into public.calendars (project_id, work_days, hours_per_day)
  values (v_project.id, v_company.default_work_days, v_company.default_hours_per_day);

  perform set_config('pms.audit', 'off', true);
  perform private.copy_holidays(v_project.id,
    least(extract(year from p_start_date), extract(year from v_today))::integer,
    greatest(extract(year from p_end_date), extract(year from v_today) + 1)::integer);
  perform set_config('pms.audit', 'on', true);
  return v_project;
end;
$$;

-- Whitelisted partial update with optimistic concurrency.
create or replace function public.update_project(p_project_id uuid, p_patch jsonb, p_expected_version integer)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.projects;
  v_new public.projects;
  v_text text;
  v_num numeric;
  v_today date := private.manila_today();
begin
  perform private.assert_can_manage_project(p_project_id);
  perform private.assert_patch_keys(p_patch, array['name', 'site_name', 'site_address', 'description', 'start_date',
                                                   'end_date', 'budget', 'weighting', 'near_budget_threshold', 'color']);
  if p_expected_version is null then
    perform private.raise_error('VALIDATION', 'Reload the project and try again.', 'version');
  end if;
  select * into v_row from public.projects where id = p_project_id for no key update;
  if v_row.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION',
      'Someone else changed this project just now. Reload to see their changes, or save again to keep yours.', 'version');
  end if;
  v_new := v_row;

  if p_patch ? 'name' then
    v_new.name := private.validate_project_name(private.patch_text(p_patch, 'name'));
  end if;
  if p_patch ? 'site_name' then
    v_new.site_name := private.optional_text(private.patch_text(p_patch, 'site_name'), 'site_name', 200);
  end if;
  if p_patch ? 'site_address' then
    v_new.site_address := private.optional_text(private.patch_text(p_patch, 'site_address'), 'site_address', 500);
  end if;
  if p_patch ? 'description' then
    v_new.description := private.optional_text(private.patch_text(p_patch, 'description'), 'description', 5000, false);
  end if;
  if p_patch ? 'start_date' then
    v_new.start_date := private.patch_date(p_patch, 'start_date');
  end if;
  if p_patch ? 'end_date' then
    v_new.end_date := private.patch_date(p_patch, 'end_date');
  end if;
  perform private.validate_project_dates(v_new.start_date, v_new.end_date);
  if p_patch ? 'budget' then
    v_new.budget := private.validate_budget(private.patch_numeric(p_patch, 'budget'));
  end if;
  if p_patch ? 'weighting' then
    v_text := private.patch_text(p_patch, 'weighting');
    if v_text is null or v_text not in ('cost', 'hours') then
      perform private.raise_error('VALIDATION', 'Choose Cost or Hours for progress weighting.', 'weighting');
    end if;
    v_new.weighting := v_text::public.weighting_basis;
  end if;
  if p_patch ? 'near_budget_threshold' then
    v_num := private.patch_numeric(p_patch, 'near_budget_threshold');
    if v_num is null or v_num < 0.5 or v_num > 1 then
      perform private.raise_error('VALIDATION', 'Use a threshold between 0.50 and 1.00 (50% to 100% of the budget).', 'near_budget_threshold');
    end if;
    v_new.near_budget_threshold := round(v_num, 3);
  end if;
  if p_patch ? 'color' then
    v_text := private.patch_text(p_patch, 'color');
    if v_text is null or v_text not in (select unnest(enum_range(null::public.project_color))::text) then
      perform private.raise_error('VALIDATION', 'Pick one of the card colors.', 'color');
    end if;
    v_new.color := v_text::public.project_color;
  end if;

  if private.name_key(v_new.name) <> v_row.name_key
     and exists (select 1 from public.projects p
                  where p.company_id = v_row.company_id and p.name_key = private.name_key(v_new.name)
                    and p.deleted_at is null and p.id <> v_row.id) then
    perform private.raise_error('PROJECT_NAME_TAKEN', 'Your company already has a project with this name. Pick a different name.', 'name');
  end if;

  begin
    update public.projects
       set name = v_new.name,
           site_name = v_new.site_name,
           site_address = v_new.site_address,
           description = v_new.description,
           start_date = v_new.start_date,
           end_date = v_new.end_date,
           budget = v_new.budget,
           weighting = v_new.weighting,
           near_budget_threshold = v_new.near_budget_threshold,
           color = v_new.color
     where id = p_project_id
    returning * into v_row;
  exception when unique_violation then
    perform private.raise_error('PROJECT_NAME_TAKEN', 'Your company already has a project with this name. Pick a different name.', 'name');
  end;

  if p_patch ? 'start_date' or p_patch ? 'end_date' then
    perform set_config('pms.audit', 'off', true);
    perform private.copy_holidays(v_row.id,
      least(extract(year from v_row.start_date), extract(year from v_today))::integer,
      greatest(extract(year from v_row.end_date), extract(year from v_today) + 1)::integer);
    perform set_config('pms.audit', 'on', true);
  end if;
  return v_row;
end;
$$;

-- Manual status transitions (spec §5.2).
create or replace function public.set_project_status(p_project_id uuid, p_status public.project_status, p_reason text default null)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.projects;
  v_old public.project_status;
  v_reason text;
  v_open integer;
  v_total integer;
  v_list text;
begin
  select * into v_row from public.projects where id = p_project_id for no key update;
  if not found or v_row.deleted_at is not null or not private.can_view_project(p_project_id) then
    perform private.raise_error('NOT_FOUND', 'This project does not exist or you no longer have access to it.', 'project_id');
  end if;
  if p_status is null then
    perform private.raise_error('VALIDATION', 'Choose a status.', 'status');
  end if;
  v_reason := private.optional_text(p_reason, 'reason', 1000, false);
  if p_status = 'cancelled' then
    if not private.is_owner_pm(v_row.company_id) then
      perform private.raise_error('FORBIDDEN', 'Only the Owner PM can cancel a project.');
    end if;
  elsif not private.can_manage_project(p_project_id) then
    perform private.raise_error('FORBIDDEN', 'Only the project''s PMs and the Owner PM can change its status.');
  end if;

  v_old := v_row.status;
  if p_status = v_old then
    perform private.raise_error('INVALID_TRANSITION',
      format('The project is already %s.', private.status_label(v_old::text)), 'status');
  end if;
  if not (
       (v_old = 'planning' and p_status in ('active', 'cancelled'))
    or (v_old = 'active' and p_status in ('on_hold', 'completed', 'cancelled'))
    or (v_old = 'on_hold' and p_status in ('active', 'completed', 'cancelled'))
    or (v_old = 'completed' and p_status = 'active')
  ) then
    perform private.raise_error('INVALID_TRANSITION',
      format('A project cannot move from %s to %s.', private.status_label(v_old::text), private.status_label(p_status::text)), 'status');
  end if;
  if p_status in ('on_hold', 'cancelled') and v_reason is null then
    perform private.raise_error('REASON_REQUIRED',
      format('Add a reason for marking the project %s.', private.status_label(p_status::text)), 'reason');
  end if;

  if p_status = 'completed' then
    select count(*) filter (where a.status <> 'completed'), count(*)
      into v_open, v_total
      from public.activities a
     where a.project_id = p_project_id and a.deleted_at is null;
    if v_total = 0 then
      perform private.raise_error('PROJECT_HAS_INCOMPLETE_ACTIVITIES',
        'This project has no activities yet. Add its work and complete it before completing the project.', 'status');
    end if;
    if v_open > 0 then
      select string_agg(x.label, ', ' order by x.ord) into v_list
        from (select a.wbs_code || ' ' || a.name as label,
                     string_to_array(nullif(a.wbs_code, ''), '.')::integer[] as ord
                from public.activities a
               where a.project_id = p_project_id and a.deleted_at is null and a.status <> 'completed'
               order by ord
               limit 10) x;
      perform private.raise_error('PROJECT_HAS_INCOMPLETE_ACTIVITIES',
        format('%s %s not completed yet: %s%s. Complete them first, then try again.',
               v_open, case when v_open = 1 then 'activity is' else 'activities are' end, v_list,
               case when v_open > 10 then format(' and %s more', v_open - 10) else '' end),
        'status');
    end if;
  end if;

  update public.projects
     set status = p_status, status_reason = v_reason
   where id = p_project_id
  returning * into v_row;

  if v_old = 'planning' and p_status = 'active'
     and not exists (select 1 from public.baselines b where b.project_id = p_project_id) then
    perform private.capture_baseline(p_project_id, 'Baseline v1 (captured automatically when the project became Active)');
  end if;

  perform private.notify(a.user_id, 'project_status_changed',
      format('%s is now %s', v_row.name, private.status_label(p_status::text)),
      format('%s changed the status from %s to %s.%s', private.profile_name(v_uid),
             private.status_label(v_old::text), private.status_label(p_status::text),
             coalesce(' Reason: ' || v_reason, '')),
      format('/projects/%s', v_row.id),
      jsonb_build_object('project_id', v_row.id, 'project_name', v_row.name,
                         'from', v_old, 'to', p_status, 'reason', v_reason),
      v_row.id, v_row.company_id)
    from private.project_audience_ids(p_project_id) as a(user_id)
   where a.user_id <> v_uid;
  return v_row;
end;
$$;

create or replace function public.set_project_archived(p_project_id uuid, p_archived boolean)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.projects;
begin
  perform private.assert_can_manage_project(p_project_id);
  if p_archived is null then
    perform private.raise_error('VALIDATION', 'Choose archive or unarchive.', 'is_archived');
  end if;
  select * into v_row from public.projects where id = p_project_id for no key update;
  if p_archived and v_row.status not in ('completed', 'cancelled') then
    perform private.raise_error('NOT_CLOSED', 'Only completed or cancelled projects can be archived.', 'is_archived');
  end if;
  if v_row.is_archived is distinct from p_archived then
    update public.projects set is_archived = p_archived where id = p_project_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- Soft delete (Owner PM only); restorable for 30 days.
create or replace function public.delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.projects;
begin
  select * into v_row from public.projects where id = p_project_id for no key update;
  if not found or v_row.deleted_at is not null or not private.can_view_project(p_project_id) then
    perform private.raise_error('NOT_FOUND', 'This project does not exist or you no longer have access to it.', 'project_id');
  end if;
  if not private.is_owner_pm(v_row.company_id) then
    perform private.raise_error('FORBIDDEN', 'Only the Owner PM can delete a project.');
  end if;
  update public.projects set deleted_at = now(), deleted_by = v_uid where id = p_project_id returning * into v_row;
  return jsonb_build_object('project_id', v_row.id, 'name', v_row.name, 'deleted_at', v_row.deleted_at,
                            'restore_until', v_row.deleted_at + interval '30 days');
end;
$$;

create or replace function public.restore_project(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.projects;
begin
  perform private.require_uid();
  select * into v_row from public.projects where id = p_project_id for no key update;
  if not found or v_row.deleted_at is null or not private.is_owner_pm(v_row.company_id) then
    perform private.raise_error('NOT_FOUND', 'This project is not in the trash.', 'project_id');
  end if;
  if v_row.deleted_at < now() - interval '30 days' then
    perform private.raise_error('RESTORE_EXPIRED', 'This project was deleted more than 30 days ago and can no longer be restored.', 'project_id');
  end if;
  if exists (select 1 from public.projects p
              where p.company_id = v_row.company_id and p.name_key = v_row.name_key
                and p.deleted_at is null and p.id <> v_row.id) then
    perform private.raise_error('PROJECT_NAME_TAKEN',
      'Another project now uses this name. Rename that project first, then restore this one.', 'name');
  end if;
  begin
    update public.projects set deleted_at = null, deleted_by = null where id = p_project_id returning * into v_row;
  exception when unique_violation then
    perform private.raise_error('PROJECT_NAME_TAKEN',
      'Another project now uses this name. Rename that project first, then restore this one.', 'name');
  end;
  return v_row;
end;
$$;

-- Owner PM's project trash (others get no rows).
create or replace function public.project_trash()
returns table (
  id uuid,
  name text,
  color public.project_color,
  status public.project_status,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  restore_until timestamptz,
  name_conflict boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.color, p.status, p.deleted_at, p.deleted_by,
         case when p.deleted_by is null then null else private.profile_name(p.deleted_by) end,
         p.deleted_at + interval '30 days',
         exists (select 1 from public.projects o
                  where o.company_id = p.company_id and o.name_key = p.name_key
                    and o.deleted_at is null and o.id <> p.id)
    from public.projects p
   where p.company_id = private.owner_company_id()
     and p.deleted_at is not null
     and p.deleted_at > now() - interval '30 days'
   order by p.deleted_at desc;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_project(text, date, date, numeric, text, text, text, public.project_color),
  public.update_project(uuid, jsonb, integer),
  public.set_project_status(uuid, public.project_status, text),
  public.set_project_archived(uuid, boolean),
  public.delete_project(uuid),
  public.restore_project(uuid),
  public.project_trash()
to authenticated, service_role;
