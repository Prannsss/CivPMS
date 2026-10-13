-- WBS RPCs (spec §6): create / update / move / delete / restore activities,
-- bulk schedule writes and the per-project activity trash.
-- Structure (level, sort_order, wbs_code) is maintained here: level = depth,
-- sort_order is contiguous 0..n-1 among non-deleted siblings, wbs_code = 1 / 1.2 / 1.2.3.
-- Schedule math (end date from start + duration + calendar) is done by the
-- app's TS module (D23); the database validates basic constraints only.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Serialise structural WBS changes per project (transaction-scoped).
create or replace function private.lock_wbs(p_project_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('civpms.wbs:' || p_project_id::text, 0));
$$;

create or replace function private.validate_activity_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.clean_text(p_name);
begin
  if v is null then
    perform private.raise_error('VALIDATION', 'Enter a name for the activity.', 'name');
  end if;
  if char_length(v) > 200 then
    perform private.raise_error('VALIDATION', 'Activity names can be up to 200 characters.', 'name');
  end if;
  return v;
end;
$$;

create or replace function private.validate_duration_hours(p_value numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value < 0 then
    perform private.raise_error('VALIDATION', 'Duration cannot be negative. Use 0 for a milestone.', 'duration_hours');
  end if;
  if p_value > 99999999.99 then
    perform private.raise_error('VALIDATION', 'The duration is too long. The maximum is 99,999,999.99 hours.', 'duration_hours');
  end if;
  return round(p_value, 2);
end;
$$;

create or replace function private.validate_cost(p_value numeric, p_field text default 'est_cost')
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value < 0 then
    perform private.raise_error('VALIDATION', 'Estimated cost cannot be negative. Use ₱0.00 if there is no cost.', p_field);
  end if;
  if p_value <> round(p_value, 2) then
    perform private.raise_error('VALIDATION', 'Costs can have at most 2 decimal places.', p_field);
  end if;
  if p_value > 999999999999.99 then
    perform private.raise_error('VALIDATION', 'The cost is too large. The maximum is ₱999,999,999,999.99.', p_field);
  end if;
  return p_value;
end;
$$;

create or replace function private.validate_activity_dates(p_start date, p_end date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_start is not null and p_end is not null and p_end < p_start then
    perform private.raise_error('INVALID_DATES',
      format('End date must be on or after the start date (%s).', private.fmt_date(p_start)), 'end_date');
  end if;
end;
$$;

-- Recompute level, sort_order and wbs_code for every non-deleted activity of a
-- project. Only rows whose values change are written. Returns that count.
create or replace function private.renumber_wbs(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with recursive ordered as (
    select a.id, a.parent_id,
           row_number() over (partition by a.parent_id order by a.sort_order, a.created_at, a.id)::integer as pos
      from public.activities a
     where a.project_id = p_project_id and a.deleted_at is null
  ), tree as (
    select o.id, 1 as lvl, o.pos::text as code, o.pos - 1 as so
      from ordered o
     where o.parent_id is null
    union all
    select o.id, t.lvl + 1, t.code || '.' || o.pos::text, o.pos - 1
      from ordered o
      join tree t on o.parent_id = t.id
  )
  update public.activities a
     set level = t.lvl::smallint,
         wbs_code = t.code,
         sort_order = t.so
    from tree t
   where a.id = t.id
     and (a.level <> t.lvl or a.wbs_code <> t.code or a.sort_order <> t.so);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A non-deleted activity the caller may manage (NOT_FOUND / FORBIDDEN otherwise).
create or replace function private.get_managed_activity(p_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.activities;
begin
  perform private.require_uid();
  select * into v_row from public.activities where id = p_activity_id and deleted_at is null;
  if not found or not private.can_view_project(v_row.project_id) then
    perform private.raise_error('NOT_FOUND', 'This activity does not exist or was deleted. Reload the page.', 'activity_id');
  end if;
  perform private.assert_can_manage_project(v_row.project_id);
  return v_row;
end;
$$;

-- Height of the non-deleted subtree under an activity (0 = leaf).
create or replace function private.subtree_height(p_activity_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive sub as (
    select a.id, 0 as depth from public.activities a where a.id = p_activity_id
    union all
    select c.id, s.depth + 1
      from public.activities c
      join sub s on c.parent_id = s.id
     where c.deleted_at is null
  )
  select coalesce(max(depth), 0) from sub;
$$;

-- Apply schedule rows [{id, start_date?, duration_hours?, end_date?}] to a
-- project's activities. Missing keys keep the stored value; null clears it.
-- Every id must be a non-deleted activity of the project. Returns rows changed.
create or replace function private.apply_schedule_rows(p_project_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_act public.activities;
  v_start date;
  v_hours numeric;
  v_end date;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    perform private.raise_error('VALIDATION', 'Send the schedule as a list of {id, start_date, duration_hours, end_date}.', 'rows');
  end if;
  for v_item in select e.value from jsonb_array_elements(p_rows) e loop
    if jsonb_typeof(v_item) <> 'object' then
      perform private.raise_error('VALIDATION', 'Each schedule row must be an object with an "id".', 'rows');
    end if;
    perform private.assert_patch_keys(v_item, array['id', 'start_date', 'duration_hours', 'end_date']);
    if coalesce(v_item ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform private.raise_error('VALIDATION', 'Each schedule row needs the activity "id".', 'rows');
    end if;
    v_id := (v_item ->> 'id')::uuid;
    select * into v_act from public.activities
     where id = v_id and project_id = p_project_id and deleted_at is null
     for update;
    if not found then
      perform private.raise_error('VALIDATION',
        'One of the activities to reschedule was deleted or belongs to another project. Reload and try again.', 'rows');
    end if;
    v_start := case when v_item ? 'start_date' then private.patch_date(v_item, 'start_date') else v_act.start_date end;
    v_hours := case when v_item ? 'duration_hours'
                    then private.validate_duration_hours(private.patch_numeric(v_item, 'duration_hours'))
                    else v_act.duration_hours end;
    v_end := case when v_item ? 'end_date' then private.patch_date(v_item, 'end_date') else v_act.end_date end;
    perform private.validate_activity_dates(v_start, v_end);
    if v_start is distinct from v_act.start_date
       or v_hours is distinct from v_act.duration_hours
       or v_end is distinct from v_act.end_date then
      update public.activities
         set start_date = v_start, duration_hours = v_hours, end_date = v_end
       where id = v_act.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Add an activity under p_parent_id (NULL = new deliverable) at p_index
-- (0-based among siblings; NULL = append). p_fields may carry description,
-- start_date, duration_hours, end_date, est_cost.
create or replace function public.create_activity(
  p_project_id uuid,
  p_parent_id uuid,
  p_name text,
  p_index integer default null,
  p_fields jsonb default '{}'::jsonb
)
returns public.activities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_parent public.activities;
  v_level smallint := 1;
  v_siblings integer;
  v_index integer;
  v_name text;
  v_start date;
  v_hours numeric;
  v_end date;
  v_cost numeric;
  v_description text;
  v_row public.activities;
begin
  perform private.assert_can_manage_project(p_project_id);
  perform private.assert_patch_keys(v_fields, array['description', 'start_date', 'duration_hours', 'end_date', 'est_cost']);
  v_name := private.validate_activity_name(p_name);
  v_description := private.optional_text(private.patch_text(v_fields, 'description'), 'description', 5000, false);
  v_start := private.patch_date(v_fields, 'start_date');
  v_hours := private.validate_duration_hours(private.patch_numeric(v_fields, 'duration_hours'));
  v_end := private.patch_date(v_fields, 'end_date');
  v_cost := private.validate_cost(private.patch_numeric(v_fields, 'est_cost'));
  perform private.validate_activity_dates(v_start, v_end);
  if p_index is not null and p_index < 0 then
    perform private.raise_error('VALIDATION', 'The position must be 0 or more.', 'index');
  end if;

  perform private.lock_wbs(p_project_id);
  if p_parent_id is not null then
    select * into v_parent from public.activities
     where id = p_parent_id and project_id = p_project_id and deleted_at is null;
    if not found then
      perform private.raise_error('PARENT_NOT_FOUND', 'The parent activity was deleted or moved. Reload and try again.', 'parent_id');
    end if;
    if v_parent.level >= 3 then
      perform private.raise_error('MAX_DEPTH_EXCEEDED',
        'Work packages cannot have children. The WBS has 3 levels: Deliverable → Sub-deliverable → Work package.', 'parent_id');
    end if;
    v_level := v_parent.level + 1;
    select count(*) into v_siblings from public.activities
     where project_id = p_project_id and parent_id = p_parent_id and deleted_at is null;
  else
    select count(*) into v_siblings from public.activities
     where project_id = p_project_id and parent_id is null and deleted_at is null;
  end if;
  v_index := least(coalesce(p_index, v_siblings), v_siblings);

  -- open the slot; descendants' codes are renumbered below
  update public.activities
     set sort_order = sort_order + 1
   where project_id = p_project_id
     and parent_id is not distinct from p_parent_id
     and deleted_at is null
     and sort_order >= v_index;

  insert into public.activities (
    project_id, parent_id, level, sort_order, wbs_code, name, description,
    start_date, duration_hours, end_date, est_cost, created_by)
  values (
    p_project_id, p_parent_id, v_level, v_index,
    case when v_parent.id is null then '' else v_parent.wbs_code || '.' end || (v_index + 1)::text,
    v_name, v_description, v_start, v_hours, v_end, v_cost, v_uid)
  returning * into v_row;

  perform private.renumber_wbs(p_project_id);
  select * into v_row from public.activities where id = v_row.id;
  return v_row;
end;
$$;

-- Whitelisted partial update with optimistic concurrency.
create or replace function public.update_activity(p_activity_id uuid, p_patch jsonb, p_expected_version integer)
returns public.activities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.activities;
  v_new public.activities;
begin
  v_row := private.get_managed_activity(p_activity_id);
  perform private.assert_patch_keys(p_patch, array['name', 'description', 'start_date', 'duration_hours', 'end_date', 'est_cost']);
  if p_expected_version is null then
    perform private.raise_error('VALIDATION', 'Reload the activity and try again.', 'version');
  end if;
  select * into v_row from public.activities where id = p_activity_id for update;
  if v_row.deleted_at is not null then
    perform private.raise_error('NOT_FOUND', 'This activity was deleted. Reload the page.', 'activity_id');
  end if;
  if v_row.version <> p_expected_version then
    perform private.raise_error('STALE_VERSION',
      'Someone else changed this activity just now. Reload to see their changes, or save again to keep yours.', 'version');
  end if;
  v_new := v_row;
  if p_patch ? 'name' then
    v_new.name := private.validate_activity_name(private.patch_text(p_patch, 'name'));
  end if;
  if p_patch ? 'description' then
    v_new.description := private.optional_text(private.patch_text(p_patch, 'description'), 'description', 5000, false);
  end if;
  if p_patch ? 'start_date' then
    v_new.start_date := private.patch_date(p_patch, 'start_date');
  end if;
  if p_patch ? 'duration_hours' then
    v_new.duration_hours := private.validate_duration_hours(private.patch_numeric(p_patch, 'duration_hours'));
  end if;
  if p_patch ? 'end_date' then
    v_new.end_date := private.patch_date(p_patch, 'end_date');
  end if;
  if p_patch ? 'est_cost' then
    v_new.est_cost := private.validate_cost(private.patch_numeric(p_patch, 'est_cost'));
  end if;
  perform private.validate_activity_dates(v_new.start_date, v_new.end_date);

  update public.activities
     set name = v_new.name,
         description = v_new.description,
         start_date = v_new.start_date,
         duration_hours = v_new.duration_hours,
         end_date = v_new.end_date,
         est_cost = v_new.est_cost
   where id = p_activity_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Re-parent and/or reorder. p_new_parent_id NULL = top level; p_new_index is
-- 0-based among the new siblings (NULL = append). Logs one 'move' entry.
create or replace function public.move_activity(p_activity_id uuid, p_new_parent_id uuid, p_new_index integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_act public.activities;
  v_parent public.activities;
  v_new_level integer := 1;
  v_height integer;
  v_siblings integer;
  v_index integer;
  v_company uuid;
  v_new_code text;
  v_changed integer;
begin
  v_act := private.get_managed_activity(p_activity_id);
  if p_new_index is not null and p_new_index < 0 then
    perform private.raise_error('VALIDATION', 'The position must be 0 or more.', 'index');
  end if;
  perform private.lock_wbs(v_act.project_id);
  select * into v_act from public.activities where id = p_activity_id for update;
  if v_act.deleted_at is not null then
    perform private.raise_error('NOT_FOUND', 'This activity was deleted. Reload the page.', 'activity_id');
  end if;

  if p_new_parent_id is not null then
    if p_new_parent_id = v_act.id then
      perform private.raise_error('INVALID_MOVE', 'An activity cannot be placed under itself.', 'parent_id');
    end if;
    select * into v_parent from public.activities where id = p_new_parent_id;
    if not found or (v_parent.project_id = v_act.project_id and v_parent.deleted_at is not null) then
      perform private.raise_error('PARENT_NOT_FOUND', 'The new parent was deleted or moved. Reload and try again.', 'parent_id');
    end if;
    if v_parent.project_id <> v_act.project_id then
      perform private.raise_error('INVALID_MOVE', 'Activities can only be moved within the same project.', 'parent_id');
    end if;
    if exists (
      with recursive sub as (
        select c.id from public.activities c where c.parent_id = v_act.id and c.deleted_at is null
        union all
        select c.id from public.activities c join sub s on c.parent_id = s.id where c.deleted_at is null
      )
      select 1 from sub where sub.id = p_new_parent_id
    ) then
      perform private.raise_error('INVALID_MOVE', 'An activity cannot be placed under one of its own children.', 'parent_id');
    end if;
    v_new_level := v_parent.level + 1;
  end if;

  v_height := private.subtree_height(v_act.id);
  if v_new_level + v_height > 3 then
    perform private.raise_error('MAX_DEPTH_EXCEEDED',
      format('This move would create more than 3 levels (%s %s has %s level(s) below it). Move it higher, or flatten it first.',
             v_act.wbs_code, v_act.name, v_height), 'parent_id');
  end if;

  select count(*) into v_siblings from public.activities
   where project_id = v_act.project_id
     and parent_id is not distinct from p_new_parent_id
     and deleted_at is null
     and id <> v_act.id;
  v_index := least(coalesce(p_new_index, v_siblings), v_siblings);

  if v_act.parent_id is not distinct from p_new_parent_id and v_act.sort_order = v_index then
    return jsonb_build_object('activity_id', v_act.id, 'changed', false,
                              'old_wbs_code', v_act.wbs_code, 'new_wbs_code', v_act.wbs_code,
                              'parent_id', v_act.parent_id, 'index', v_index, 'level', v_act.level,
                              'renumbered', 0);
  end if;

  perform set_config('pms.audit', 'off', true);
  -- close the gap in the old sibling list
  update public.activities
     set sort_order = sort_order - 1
   where project_id = v_act.project_id
     and parent_id is not distinct from v_act.parent_id
     and deleted_at is null
     and id <> v_act.id
     and sort_order > v_act.sort_order;
  -- open the slot in the new sibling list
  update public.activities
     set sort_order = sort_order + 1
   where project_id = v_act.project_id
     and parent_id is not distinct from p_new_parent_id
     and deleted_at is null
     and id <> v_act.id
     and sort_order >= v_index;
  update public.activities
     set parent_id = p_new_parent_id,
         level = v_new_level::smallint,
         sort_order = v_index
   where id = v_act.id;
  v_changed := private.renumber_wbs(v_act.project_id);
  perform set_config('pms.audit', 'on', true);

  select a.wbs_code into v_new_code from public.activities a where a.id = v_act.id;
  select p.company_id into v_company from public.projects p where p.id = v_act.project_id;
  perform private.write_log(v_company, v_act.project_id, 'activity', v_act.id, 'move',
    format('Moved %s from %s to %s', v_act.name, v_act.wbs_code, v_new_code),
    'wbs_code',
    jsonb_build_object('wbs_code', v_act.wbs_code, 'parent_id', v_act.parent_id, 'index', v_act.sort_order, 'level', v_act.level),
    jsonb_build_object('wbs_code', v_new_code, 'parent_id', p_new_parent_id, 'index', v_index, 'level', v_new_level),
    v_act.id, v_new_code, v_act.name);

  return jsonb_build_object('activity_id', v_act.id, 'changed', true,
                            'old_wbs_code', v_act.wbs_code, 'new_wbs_code', v_new_code,
                            'parent_id', p_new_parent_id, 'index', v_index, 'level', v_new_level,
                            'renumbered', v_changed);
end;
$$;

-- Soft-delete an activity and its non-deleted subtree as one batch.
create or replace function public.delete_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_act public.activities;
  v_batch uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_l1 integer;
  v_l2 integer;
  v_l3 integer;
  v_company uuid;
begin
  v_act := private.get_managed_activity(p_activity_id);
  perform private.lock_wbs(v_act.project_id);
  select * into v_act from public.activities where id = p_activity_id for update;
  if v_act.deleted_at is not null then
    perform private.raise_error('NOT_FOUND', 'This activity was already deleted. Reload the page.', 'activity_id');
  end if;

  perform set_config('pms.audit', 'off', true);
  with recursive sub as (
    select a.id from public.activities a where a.id = v_act.id
    union all
    select c.id from public.activities c join sub s on c.parent_id = s.id where c.deleted_at is null
  ), gone as (
    update public.activities a
       set deleted_at = v_now, deleted_by = v_uid, deleted_batch = v_batch
      from sub
     where a.id = sub.id and a.deleted_at is null
    returning a.level
  )
  select count(*) filter (where gone.level = 1)::integer,
         count(*) filter (where gone.level = 2)::integer,
         count(*) filter (where gone.level = 3)::integer
    into v_l1, v_l2, v_l3
    from gone;
  perform private.renumber_wbs(v_act.project_id);
  perform set_config('pms.audit', 'on', true);

  select p.company_id into v_company from public.projects p where p.id = v_act.project_id;
  perform private.write_log(v_company, v_act.project_id, 'activity', v_act.id, 'delete',
    format('Deleted %s %s%s', v_act.wbs_code, v_act.name,
           case when v_l1 + v_l2 + v_l3 > 1
                then format(' and %s activit%s under it', v_l1 + v_l2 + v_l3 - 1,
                            case when v_l1 + v_l2 + v_l3 - 1 = 1 then 'y' else 'ies' end)
                else '' end),
    'deleted_at', null,
    jsonb_build_object('batch_id', v_batch, 'total', v_l1 + v_l2 + v_l3,
                       'deliverables', v_l1, 'sub_deliverables', v_l2, 'work_packages', v_l3),
    v_act.id, v_act.wbs_code, v_act.name);

  return jsonb_build_object(
    'batch_id', v_batch,
    'activity_id', v_act.id,
    'wbs_code', v_act.wbs_code,
    'name', v_act.name,
    'total', v_l1 + v_l2 + v_l3,
    'counts', jsonb_build_object('deliverables', v_l1, 'sub_deliverables', v_l2, 'work_packages', v_l3),
    'deleted_at', v_now,
    'restore_until', v_now + interval '30 days');
end;
$$;

-- Restore one delete batch (within 30 days) at its original position.
create or replace function public.restore_activity(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.activities;
  v_parent public.activities;
  v_height integer;
  v_new_level integer := 1;
  v_l1 integer;
  v_l2 integer;
  v_l3 integer;
  v_company uuid;
  v_code text;
begin
  perform private.require_uid();
  if p_batch_id is null then
    perform private.raise_error('VALIDATION', 'Pick an item from the trash to restore.', 'batch_id');
  end if;
  -- the batch root: the deleted row whose parent is not in the same batch
  select a.* into v_root
    from public.activities a
   where a.deleted_batch = p_batch_id
     and not exists (select 1 from public.activities p
                      where p.id = a.parent_id and p.deleted_batch = p_batch_id)
   limit 1;
  if not found or not private.can_view_project(v_root.project_id) then
    perform private.raise_error('NOT_FOUND', 'This item is no longer in the trash.', 'batch_id');
  end if;
  perform private.assert_can_manage_project(v_root.project_id);
  perform private.lock_wbs(v_root.project_id);
  select * into v_root from public.activities where id = v_root.id for update;
  if v_root.deleted_batch is distinct from p_batch_id then
    perform private.raise_error('NOT_FOUND', 'This item is no longer in the trash.', 'batch_id');
  end if;
  if v_root.deleted_at < now() - interval '30 days' then
    perform private.raise_error('RESTORE_EXPIRED', 'This item was deleted more than 30 days ago and can no longer be restored.', 'batch_id');
  end if;
  if v_root.parent_id is not null then
    select * into v_parent from public.activities where id = v_root.parent_id;
    if v_parent.deleted_at is not null then
      perform private.raise_error('PARENT_DELETED',
        format('Its parent %s %s is in the trash. Restore the parent first.', v_parent.wbs_code, v_parent.name), 'batch_id');
    end if;
    v_new_level := v_parent.level + 1;
  end if;
  with recursive sub as (
    select a.id, 0 as depth from public.activities a where a.id = v_root.id
    union all
    select c.id, s.depth + 1
      from public.activities c join sub s on c.parent_id = s.id
     where c.deleted_batch = p_batch_id
  )
  select max(depth) into v_height from sub;
  if v_new_level + v_height > 3 then
    perform private.raise_error('MAX_DEPTH_EXCEEDED',
      'Restoring here would create more than 3 levels because its parent moved deeper. Move the parent up first.', 'batch_id');
  end if;

  perform set_config('pms.audit', 'off', true);
  -- reopen the original slot among the current siblings
  update public.activities
     set sort_order = sort_order + 1
   where project_id = v_root.project_id
     and parent_id is not distinct from v_root.parent_id
     and deleted_at is null
     and sort_order >= v_root.sort_order;
  with back as (
    update public.activities a
       set deleted_at = null, deleted_by = null, deleted_batch = null
     where a.deleted_batch = p_batch_id
    returning a.level
  )
  select count(*) filter (where back.level = 1)::integer,
         count(*) filter (where back.level = 2)::integer,
         count(*) filter (where back.level = 3)::integer
    into v_l1, v_l2, v_l3
    from back;
  perform private.renumber_wbs(v_root.project_id);
  perform set_config('pms.audit', 'on', true);

  select a.wbs_code into v_code from public.activities a where a.id = v_root.id;
  select p.company_id into v_company from public.projects p where p.id = v_root.project_id;
  perform private.write_log(v_company, v_root.project_id, 'activity', v_root.id, 'restore',
    format('Restored %s %s%s from the trash', v_code, v_root.name,
           case when v_l1 + v_l2 + v_l3 > 1
                then format(' and %s activit%s under it', v_l1 + v_l2 + v_l3 - 1,
                            case when v_l1 + v_l2 + v_l3 - 1 = 1 then 'y' else 'ies' end)
                else '' end),
    'deleted_at',
    jsonb_build_object('batch_id', p_batch_id, 'deleted_at', v_root.deleted_at),
    null,
    v_root.id, v_code, v_root.name);

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'activity_id', v_root.id,
    'wbs_code', v_code,
    'name', v_root.name,
    'total', v_l1 + v_l2 + v_l3,
    'counts', jsonb_build_object('deliverables', v_l1, 'sub_deliverables', v_l2, 'work_packages', v_l3));
end;
$$;

-- Bulk schedule write from the app's recompute (spec §7: calendar changes and
-- date shifts reschedule many activities at once). Returns rows changed.
create or replace function public.apply_schedule(p_project_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.assert_can_manage_project(p_project_id);
  perform private.lock_wbs(p_project_id);
  perform set_config('pms.via', 'schedule', true);
  v_count := private.apply_schedule_rows(p_project_id, p_rows);
  perform set_config('pms.via', '', true);
  return v_count;
end;
$$;

-- Deleted batches of a project that can still be restored (managers only).
create or replace function public.activity_trash(p_project_id uuid)
returns table (
  batch_id uuid,
  activity_id uuid,
  wbs_code text,
  name text,
  level smallint,
  total integer,
  deliverables integer,
  sub_deliverables integer,
  work_packages integer,
  deleted_at timestamptz,
  deleted_by uuid,
  deleted_by_name text,
  restore_until timestamptz,
  parent_deleted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_manage_project(p_project_id);
  return query
  select b.deleted_batch,
         r.id,
         r.wbs_code,
         r.name,
         r.level,
         b.total,
         b.l1,
         b.l2,
         b.l3,
         r.deleted_at,
         r.deleted_by,
         case when r.deleted_by is null then null else private.profile_name(r.deleted_by) end,
         r.deleted_at + interval '30 days',
         coalesce((select par.deleted_at is not null from public.activities par where par.id = r.parent_id), false)
    from (
      select a.deleted_batch,
             count(*)::integer as total,
             (count(*) filter (where a.level = 1))::integer as l1,
             (count(*) filter (where a.level = 2))::integer as l2,
             (count(*) filter (where a.level = 3))::integer as l3
        from public.activities a
       where a.project_id = p_project_id
         and a.deleted_at is not null
         and a.deleted_at > now() - interval '30 days'
       group by a.deleted_batch
    ) b
    join public.activities r
      on r.deleted_batch = b.deleted_batch
     and not exists (select 1 from public.activities x
                      where x.id = r.parent_id and x.deleted_batch = b.deleted_batch)
   order by r.deleted_at desc;
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  public.create_activity(uuid, uuid, text, integer, jsonb),
  public.update_activity(uuid, jsonb, integer),
  public.move_activity(uuid, uuid, integer),
  public.delete_activity(uuid),
  public.restore_activity(uuid),
  public.apply_schedule(uuid, jsonb),
  public.activity_trash(uuid)
from public, anon;
grant execute on function
  public.create_activity(uuid, uuid, text, integer, jsonb),
  public.update_activity(uuid, jsonb, integer),
  public.move_activity(uuid, uuid, integer),
  public.delete_activity(uuid),
  public.restore_activity(uuid),
  public.apply_schedule(uuid, jsonb),
  public.activity_trash(uuid)
to authenticated, service_role;
