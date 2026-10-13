-- Onboarding, profile, company and membership RPCs.
-- All RPCs: SECURITY DEFINER, search_path = '', explicit permission checks,
-- errors raised as P0001 with MESSAGE = <CODE>, DETAIL = human text, HINT = field.
-- DELETEs are written as data-modifying CTEs (`with gone as (delete ...)`), which
-- also return the affected row count.

-- ---------------------------------------------------------------------------
-- Shared validation helpers
-- ---------------------------------------------------------------------------
create or replace function private.field_label(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'est_cost' then 'Estimated cost'
    when 'duration_hours' then 'Duration (hours)'
    when 'near_budget_threshold' then 'Near-budget threshold'
    when 'hours_per_day' then 'Hours per day'
    when 'avatar_url' then 'Avatar'
    else upper(left(replace(p_key, '_', ' '), 1)) || substr(replace(p_key, '_', ' '), 2)
  end;
$$;

-- Reject anything that is not a JSON object or carries keys outside the whitelist.
create or replace function private.assert_patch_keys(p_patch jsonb, p_allowed text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform private.raise_error('VALIDATION', 'Send the changes as an object of field names and values.', 'patch');
  end if;
  select k into v_bad from jsonb_object_keys(p_patch) k where k <> all (p_allowed) limit 1;
  if v_bad is not null then
    perform private.raise_error('VALIDATION', format('"%s" cannot be changed here.', v_bad), v_bad);
  end if;
end;
$$;

create or replace function private.patch_text(p_patch jsonb, p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_patch -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    perform private.raise_error('VALIDATION', format('%s must be text.', private.field_label(p_key)), p_key);
  end if;
  return v #>> '{}';
end;
$$;

create or replace function private.patch_date(p_patch jsonb, p_key text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_patch -> p_key;
  v_text text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  v_text := v #>> '{}';
  if jsonb_typeof(v) <> 'string' or v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    perform private.raise_error('VALIDATION', format('%s must be a date like 2026-10-12.', private.field_label(p_key)), p_key);
  end if;
  begin
    return v_text::date;
  exception when others then
    perform private.raise_error('VALIDATION', format('%s is not a real calendar date.', private.field_label(p_key)), p_key);
  end;
  return null;
end;
$$;

create or replace function private.patch_numeric(p_patch jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_patch -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) = 'number' then
    return (v #>> '{}')::numeric;
  end if;
  if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then
    return btrim(v #>> '{}')::numeric;
  end if;
  perform private.raise_error('VALIDATION', format('%s must be a number.', private.field_label(p_key)), p_key);
  return null;
end;
$$;

create or replace function private.validate_company_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := private.clean_text(p_name);
begin
  if v_name is null or char_length(v_name) < 2 then
    perform private.raise_error('VALIDATION', 'Enter a company name with at least 2 characters.', 'name');
  end if;
  if char_length(v_name) > 120 then
    perform private.raise_error('VALIDATION', 'Company names can be up to 120 characters.', 'name');
  end if;
  return v_name;
end;
$$;

create or replace function private.normalize_work_days(p_days smallint[])
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_days is null or cardinality(p_days) = 0 then
    perform private.raise_error('NO_WORKING_DAYS', 'Pick at least one working day.', 'work_days');
  end if;
  if exists (select 1 from unnest(p_days) d where d is null or d not between 1 and 7) then
    perform private.raise_error('VALIDATION', 'Working days must be numbers from 1 (Monday) to 7 (Sunday).', 'work_days');
  end if;
  return array(select distinct d from unnest(p_days) d order by d)::smallint[];
end;
$$;

create or replace function private.validate_hours_per_day(p_hours numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_hours is null or p_hours < 1 or p_hours > 24 then
    perform private.raise_error('VALIDATION', 'Hours per day must be between 1 and 24.', 'hours_per_day');
  end if;
  return round(p_hours, 2);
end;
$$;

create or replace function private.company_role_rank(p_role public.company_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner_pm' then 3 when 'pm' then 2 when 'inspector' then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- Profile & onboarding
-- ---------------------------------------------------------------------------
create or replace function public.company_name_available(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if private.clean_text(p_name) is null then
    return false;
  end if;
  return not exists (select 1 from public.companies c where c.name_key = private.name_key(p_name));
end;
$$;

-- Onboarding step 1: name + role preference. Does not finish onboarding.
create or replace function public.complete_profile(p_full_name text, p_role_pref text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := private.clean_text(p_full_name);
  v_row public.profiles;
begin
  if v_name is null then
    perform private.raise_error('VALIDATION', 'Enter your full name.', 'full_name');
  end if;
  if char_length(v_name) > 120 then
    perform private.raise_error('VALIDATION', 'Names can be up to 120 characters.', 'full_name');
  end if;
  if p_role_pref is null or p_role_pref not in ('pm', 'inspector') then
    perform private.raise_error('VALIDATION', 'Choose Project Manager or Inspector/QA/QC.', 'role_pref');
  end if;
  update public.profiles
     set full_name = v_name, role_pref = p_role_pref
   where id = v_uid
  returning * into v_row;
  if not found then
    perform private.raise_error('NOT_FOUND', 'Your profile was not found. Sign out and sign in again.');
  end if;
  return v_row;
end;
$$;

-- Profile page: whitelist full_name, avatar_url, duration_unit.
create or replace function public.update_profile(p_patch jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.profiles;
  v_name text;
  v_avatar text;
  v_unit text;
begin
  perform private.assert_patch_keys(p_patch, array['full_name', 'avatar_url', 'duration_unit']);
  select * into v_row from public.profiles where id = v_uid for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'Your profile was not found. Sign out and sign in again.');
  end if;

  if p_patch ? 'full_name' then
    v_name := private.clean_text(private.patch_text(p_patch, 'full_name'));
    if v_name is null then
      perform private.raise_error('VALIDATION', 'Enter your full name.', 'full_name');
    end if;
    if char_length(v_name) > 120 then
      perform private.raise_error('VALIDATION', 'Names can be up to 120 characters.', 'full_name');
    end if;
    v_row.full_name := v_name;
  end if;

  if p_patch ? 'avatar_url' then
    v_avatar := nullif(btrim(private.patch_text(p_patch, 'avatar_url')), '');
    if v_avatar is not null and (char_length(v_avatar) > 2048 or v_avatar !~ '^https://') then
      perform private.raise_error('VALIDATION', 'The avatar must be an https:// image link.', 'avatar_url');
    end if;
    v_row.avatar_url := v_avatar;
  end if;

  if p_patch ? 'duration_unit' then
    v_unit := private.patch_text(p_patch, 'duration_unit');
    if v_unit is null or v_unit not in ('hours', 'days') then
      perform private.raise_error('VALIDATION', 'Choose Hours or Days.', 'duration_unit');
    end if;
    v_row.duration_unit := v_unit::public.duration_unit;
  end if;

  update public.profiles
     set full_name = v_row.full_name,
         avatar_url = v_row.avatar_url,
         duration_unit = v_row.duration_unit
   where id = v_uid
  returning * into v_row;
  return v_row;
end;
$$;

-- PM onboarding: create the company; the caller becomes its Owner PM.
create or replace function public.create_company(p_name text)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := private.validate_company_name(p_name);
  v_company public.companies;
  v_constraint text;
begin
  if exists (select 1 from public.company_members cm where cm.user_id = v_uid) then
    perform private.raise_error('ALREADY_IN_COMPANY', 'You already belong to a company, so you cannot create another one.');
  end if;
  if exists (select 1 from public.companies c where c.name_key = private.name_key(v_name)) then
    perform private.raise_error('COMPANY_NAME_TAKEN', 'A company with this name already exists. Ask its Owner PM to invite you.', 'name');
  end if;
  begin
    insert into public.companies (name, owner_id) values (v_name, v_uid) returning * into v_company;
    insert into public.company_members (company_id, user_id, role) values (v_company.id, v_uid, 'owner_pm');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'companies_name_key_key' then
      perform private.raise_error('COMPANY_NAME_TAKEN', 'A company with this name already exists. Ask its Owner PM to invite you.', 'name');
    end if;
    perform private.raise_error('ALREADY_IN_COMPANY', 'You already belong to a company, so you cannot create another one.');
  end;
  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now()),
         role_pref = coalesce(role_pref, 'pm')
   where id = v_uid;
  return v_company;
end;
$$;

-- Inspectors without a code/invitation finish onboarding in "No company yet".
create or replace function public.finish_onboarding_without_company()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.profiles;
begin
  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now())
   where id = v_uid
  returning * into v_row;
  if not found then
    perform private.raise_error('NOT_FOUND', 'Your profile was not found. Sign out and sign in again.');
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Company settings (Owner PM only)
-- ---------------------------------------------------------------------------
create or replace function public.rename_company(p_name text)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_company_id uuid := private.owner_company_id();
  v_name text;
  v_company public.companies;
begin
  if v_company_id is null then
    perform private.raise_error('FORBIDDEN', 'Only the Owner PM can rename the company.');
  end if;
  v_name := private.validate_company_name(p_name);
  if exists (select 1 from public.companies c
              where c.name_key = private.name_key(v_name) and c.id <> v_company_id) then
    perform private.raise_error('COMPANY_NAME_TAKEN', 'Another company already uses this name. Pick a different one.', 'name');
  end if;
  begin
    update public.companies set name = v_name where id = v_company_id returning * into v_company;
  exception when unique_violation then
    perform private.raise_error('COMPANY_NAME_TAKEN', 'Another company already uses this name. Pick a different one.', 'name');
  end;
  return v_company;
end;
$$;

-- Calendar template copied into new projects.
create or replace function public.update_company_defaults(p_work_days smallint[], p_hours_per_day numeric)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_company_id uuid := private.owner_company_id();
  v_company public.companies;
begin
  if v_company_id is null then
    perform private.raise_error('FORBIDDEN', 'Only the Owner PM can change company defaults.');
  end if;
  update public.companies
     set default_work_days = private.normalize_work_days(p_work_days),
         default_hours_per_day = private.validate_hours_per_day(p_hours_per_day)
   where id = v_company_id
  returning * into v_company;
  return v_company;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

-- Add an existing company member to a project (e.g. someone who joined with a
-- company-wide code). Outsiders are invited by email instead.
create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid, p_role public.project_role)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_project public.projects;
  v_target_role public.company_role;
  v_row public.project_members;
begin
  perform private.assert_can_manage_project(p_project_id);
  select * into v_project from public.projects where id = p_project_id;
  if p_role is null then
    perform private.raise_error('VALIDATION', 'Choose PM or Inspector.', 'role');
  end if;
  select cm.role into v_target_role
    from public.company_members cm
   where cm.user_id = p_user_id and cm.company_id = v_project.company_id;
  if v_target_role is null then
    perform private.raise_error('NOT_FOUND', 'This person is not in your company. Invite them by email instead.', 'user_id');
  end if;
  if p_role = 'pm' and v_target_role = 'inspector' then
    perform private.raise_error('ROLE_NOT_ALLOWED', 'Only company PMs can be project PMs. Ask the Owner PM to change their company role first.', 'role');
  end if;
  if exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = p_user_id) then
    perform private.raise_error('ALREADY_MEMBER', 'This person is already on the project.', 'user_id');
  end if;
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p_project_id, p_user_id, p_role, v_uid)
  returning * into v_row;
  if p_user_id <> v_uid then
    perform private.notify(p_user_id, 'added_to_project',
      format('You were added to %s', v_project.name),
      format('%s added you to "%s" as %s.', private.profile_name(v_uid), v_project.name, private.status_label(p_role::text)),
      format('/projects/%s', v_project.id),
      jsonb_build_object('project_id', v_project.id, 'project_name', v_project.name, 'role', p_role),
      v_project.id, v_project.company_id);
  end if;
  return v_row;
end;
$$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_project public.projects;
  v_member public.project_members;
  v_count integer;
begin
  perform private.assert_can_manage_project(p_project_id);
  select * into v_project from public.projects where id = p_project_id;
  select * into v_member from public.project_members
   where project_id = p_project_id and user_id = p_user_id;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This person is not a member of the project.', 'user_id');
  end if;
  if exists (select 1 from public.company_members cm
              where cm.user_id = p_user_id and cm.company_id = v_project.company_id and cm.role = 'owner_pm') then
    perform private.raise_error('CANNOT_REMOVE_OWNER', 'The Owner PM always has access to every project and cannot be removed from it.', 'user_id');
  end if;
  with gone as (
    delete from public.project_members where id = v_member.id returning 1
  )
  select count(*) into v_count from gone;
  if p_user_id <> v_uid then
    perform private.notify(p_user_id, 'removed_from_project',
      format('You were removed from %s', v_project.name),
      format('%s removed you from the project "%s". Your past updates stay in its activity log.',
             private.profile_name(v_uid), v_project.name),
      '/',
      jsonb_build_object('project_id', v_project.id, 'project_name', v_project.name),
      v_project.id, v_project.company_id);
  end if;
end;
$$;

-- Owner PM removes someone from the company: all project access goes, the
-- person returns to "No company yet", their log entries stay.
create or replace function public.remove_company_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_company_id uuid := private.owner_company_id();
  v_member public.company_members;
  v_company_name text;
  v_count integer;
begin
  if v_company_id is null then
    perform private.raise_error('FORBIDDEN', 'Only the Owner PM can remove people from the company.');
  end if;
  select * into v_member from public.company_members
   where user_id = p_user_id and company_id = v_company_id;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This person is not a member of your company.', 'user_id');
  end if;
  if v_member.role = 'owner_pm' then
    perform private.raise_error('CANNOT_REMOVE_OWNER', 'The Owner PM cannot be removed from the company.', 'user_id');
  end if;
  select c.name into v_company_name from public.companies c where c.id = v_company_id;

  perform set_config('pms.via', 'company_removal', true);
  with gone as (
    delete from public.project_members pm
     using public.projects p
     where pm.project_id = p.id and p.company_id = v_company_id and pm.user_id = p_user_id
    returning 1
  )
  select count(*) into v_count from gone;
  with gone as (
    delete from public.company_members where id = v_member.id returning 1
  )
  select count(*) into v_count from gone;
  perform set_config('pms.via', '', true);

  perform private.notify(p_user_id, 'removed_from_company',
    format('You were removed from %s', v_company_name),
    format('%s removed you from %s. You no longer have access to its projects; your past updates stay in their activity logs.',
           private.profile_name(v_uid), v_company_name),
    '/',
    jsonb_build_object('company_id', v_company_id, 'company_name', v_company_name),
    null, v_company_id);
end;
$$;

-- Owner PM changes a member's company role (pm | inspector). Demoting to
-- inspector also demotes their project PM roles.
create or replace function public.set_company_member_role(p_user_id uuid, p_role public.company_role)
returns public.company_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_company_id uuid := private.owner_company_id();
  v_member public.company_members;
begin
  if v_company_id is null then
    perform private.raise_error('FORBIDDEN', 'Only the Owner PM can change company roles.');
  end if;
  if p_role is null or p_role not in ('pm', 'inspector') then
    perform private.raise_error('VALIDATION', 'Choose PM or Inspector. Ownership cannot be transferred here.', 'role');
  end if;
  select * into v_member from public.company_members
   where user_id = p_user_id and company_id = v_company_id
   for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This person is not a member of your company.', 'user_id');
  end if;
  if v_member.role = 'owner_pm' then
    perform private.raise_error('CANNOT_CHANGE_OWNER_ROLE', 'The Owner PM''s role cannot be changed.', 'user_id');
  end if;
  update public.company_members set role = p_role where id = v_member.id returning * into v_member;
  if p_role = 'inspector' then
    update public.project_members pm
       set role = 'inspector'
      from public.projects p
     where pm.project_id = p.id and p.company_id = v_company_id
       and pm.user_id = p_user_id and pm.role = 'pm';
  end if;
  return v_member;
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.company_name_available(text),
  public.complete_profile(text, text),
  public.update_profile(jsonb),
  public.create_company(text),
  public.finish_onboarding_without_company(),
  public.rename_company(text),
  public.update_company_defaults(smallint[], numeric),
  public.add_project_member(uuid, uuid, public.project_role),
  public.remove_project_member(uuid, uuid),
  public.remove_company_member(uuid),
  public.set_company_member_role(uuid, public.company_role)
to authenticated, service_role;
