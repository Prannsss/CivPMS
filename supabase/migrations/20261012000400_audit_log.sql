-- Activity log writers (spec §10.6). AFTER triggers (SECURITY DEFINER) write one
-- row per meaningful change. Renumbering noise (wbs_code, sort_order, level,
-- parent_id) is never logged per row; move/delete/restore RPCs log one entry.
-- Set `pms.audit = off` (transaction-local) to suppress trigger logging inside
-- an RPC that writes its own summary entry; `pms.via` records the channel.

create or replace function private.audit_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('pms.audit', true), ''), 'on') <> 'off';
$$;

create or replace function private.profile_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(p.full_name, p.email) from public.profiles p where p.id = p_user_id),
    'Unknown user');
$$;

create or replace function private.write_log(
  p_company_id uuid,
  p_project_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_summary text,
  p_field text default null,
  p_old jsonb default null,
  p_new jsonb default null,
  p_activity_id uuid default null,
  p_wbs_code text default null,
  p_activity_name text default null,
  p_is_escalation boolean default false,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_id uuid;
  v_actor_name text;
begin
  if not private.audit_enabled() then
    return;
  end if;
  if v_uid is not null then
    select p.id, coalesce(p.full_name, p.email)
      into v_actor_id, v_actor_name
      from public.profiles p
     where p.id = v_uid;
  end if;
  insert into public.activity_logs (
    company_id, project_id, entity_type, entity_id, activity_id, action, field,
    old_value, new_value, summary, note, via, actor_id, actor_name,
    wbs_code, activity_name, is_escalation
  ) values (
    p_company_id, p_project_id, p_entity_type, p_entity_id, p_activity_id, p_action, p_field,
    p_old, p_new, p_summary,
    coalesce(p_note, nullif(current_setting('pms.note', true), '')),
    coalesce(nullif(current_setting('pms.via', true), ''), 'direct'),
    v_actor_id,
    coalesce(v_actor_name, case when v_uid is null then 'System' else 'Unknown user' end),
    p_wbs_code, p_activity_name, coalesce(p_is_escalation, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create or replace function private.audit_companies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_log(new.id, null, 'company', new.id, 'create',
      format('Created company "%s"', new.name), null, null, jsonb_build_object('name', new.name));
    return null;
  end if;
  for r in
    select * from (values
      ('name', 'Company name', to_jsonb(old.name), to_jsonb(new.name), old.name, new.name),
      ('default_work_days', 'Default working days', to_jsonb(old.default_work_days), to_jsonb(new.default_work_days),
        private.fmt_days(old.default_work_days), private.fmt_days(new.default_work_days)),
      ('default_hours_per_day', 'Default hours per day', to_jsonb(old.default_hours_per_day), to_jsonb(new.default_hours_per_day),
        private.fmt_hours(old.default_hours_per_day), private.fmt_hours(new.default_hours_per_day))
    ) as v(field, label, old_value, new_value, old_text, new_text)
    where v.old_value is distinct from v.new_value
  loop
    perform private.write_log(new.id, null, 'company', new.id,
      case when r.field = 'name' then 'rename' else 'update' end,
      format('%s: %s → %s', r.label, r.old_text, r.new_text), r.field, r.old_value, r.new_value);
  end loop;
  return null;
end;
$$;
create trigger audit_companies after insert or update on public.companies
  for each row execute function private.audit_companies();

-- ---------------------------------------------------------------------------
-- company_members (company-scoped entries: project_id is NULL)
-- ---------------------------------------------------------------------------
create or replace function private.audit_company_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.companies c where c.id = old.company_id) then
      return null;
    end if;
    v_name := private.profile_name(old.user_id);
    perform private.write_log(old.company_id, null, 'company_member', old.id, 'remove',
      format('%s was removed from the company', v_name), 'role', to_jsonb(old.role), null);
    return null;
  end if;
  v_name := private.profile_name(new.user_id);
  if tg_op = 'INSERT' then
    perform private.write_log(new.company_id, null, 'company_member', new.id, 'join',
      format('%s joined the company as %s', v_name, private.status_label(new.role::text)),
      'role', null, jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif new.role is distinct from old.role then
    perform private.write_log(new.company_id, null, 'company_member', new.id, 'update',
      format('Company role of %s: %s → %s', v_name, private.status_label(old.role::text), private.status_label(new.role::text)),
      'role', to_jsonb(old.role), to_jsonb(new.role));
  end if;
  return null;
end;
$$;
create trigger audit_company_members after insert or update or delete on public.company_members
  for each row execute function private.audit_company_members();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create or replace function private.audit_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_log(new.company_id, new.id, 'project', new.id, 'create',
      format('Created project "%s"', new.name), null, null,
      jsonb_build_object('name', new.name, 'start_date', new.start_date, 'end_date', new.end_date,
                         'budget', new.budget, 'status', new.status));
    return null;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    perform private.write_log(new.company_id, new.id, 'project', new.id,
      case when new.deleted_at is null then 'restore' else 'delete' end,
      case when new.deleted_at is null then format('Restored project "%s" from the trash', new.name)
           else format('Moved project "%s" to the trash', new.name) end,
      'deleted_at', to_jsonb(old.deleted_at), to_jsonb(new.deleted_at));
  end if;

  if new.status is distinct from old.status then
    perform private.write_log(new.company_id, new.id, 'project', new.id, 'status_change',
      format('Status: %s → %s', private.status_label(old.status::text), private.status_label(new.status::text)),
      'status', to_jsonb(old.status), to_jsonb(new.status),
      p_is_escalation => new.status in ('on_hold', 'cancelled'),
      p_note => new.status_reason);
  end if;

  if new.is_archived is distinct from old.is_archived then
    perform private.write_log(new.company_id, new.id, 'project', new.id,
      case when new.is_archived then 'archive' else 'unarchive' end,
      case when new.is_archived then 'Archived the project' else 'Unarchived the project' end,
      'is_archived', to_jsonb(old.is_archived), to_jsonb(new.is_archived));
  end if;

  for r in
    select * from (values
      ('name', 'Name', to_jsonb(old.name), to_jsonb(new.name),
        private.fmt_text(old.name), private.fmt_text(new.name)),
      ('site_name', 'Site name', to_jsonb(old.site_name), to_jsonb(new.site_name),
        private.fmt_text(old.site_name), private.fmt_text(new.site_name)),
      ('site_address', 'Site address', to_jsonb(old.site_address), to_jsonb(new.site_address),
        private.fmt_text(old.site_address), private.fmt_text(new.site_address)),
      ('description', 'Description', to_jsonb(old.description), to_jsonb(new.description),
        private.fmt_text(old.description, 40), private.fmt_text(new.description, 40)),
      ('start_date', 'Start date', to_jsonb(old.start_date), to_jsonb(new.start_date),
        private.fmt_date(old.start_date), private.fmt_date(new.start_date)),
      ('end_date', 'End date', to_jsonb(old.end_date), to_jsonb(new.end_date),
        private.fmt_date(old.end_date), private.fmt_date(new.end_date)),
      ('budget', 'Budget', to_jsonb(old.budget), to_jsonb(new.budget),
        private.fmt_money(old.budget), private.fmt_money(new.budget)),
      ('weighting', 'Progress weighting', to_jsonb(old.weighting), to_jsonb(new.weighting),
        private.status_label(old.weighting::text), private.status_label(new.weighting::text)),
      ('near_budget_threshold', 'Near-budget threshold', to_jsonb(old.near_budget_threshold), to_jsonb(new.near_budget_threshold),
        private.fmt_number(old.near_budget_threshold * 100) || '%', private.fmt_number(new.near_budget_threshold * 100) || '%'),
      ('color', 'Card color', to_jsonb(old.color), to_jsonb(new.color),
        initcap(old.color::text), initcap(new.color::text))
    ) as v(field, label, old_value, new_value, old_text, new_text)
    where v.old_value is distinct from v.new_value
  loop
    perform private.write_log(new.company_id, new.id, 'project', new.id,
      case when r.field = 'name' then 'rename' else 'update' end,
      format('%s: %s → %s', r.label, r.old_text, r.new_text), r.field, r.old_value, r.new_value);
  end loop;
  return null;
end;
$$;
create trigger audit_projects after insert or update on public.projects
  for each row execute function private.audit_projects();

-- ---------------------------------------------------------------------------
-- project_members
-- ---------------------------------------------------------------------------
create or replace function private.audit_project_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_name text;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'DELETE' then
    select p.company_id into v_company from public.projects p where p.id = old.project_id;
    if v_company is null then
      return null;
    end if;
    v_name := private.profile_name(old.user_id);
    perform private.write_log(v_company, old.project_id, 'project_member', old.id, 'remove',
      format('%s was removed from the project', v_name), 'role', to_jsonb(old.role), null);
    return null;
  end if;
  select p.company_id into v_company from public.projects p where p.id = new.project_id;
  v_name := private.profile_name(new.user_id);
  if tg_op = 'INSERT' then
    perform private.write_log(v_company, new.project_id, 'project_member', new.id, 'join',
      format('%s joined the project as %s', v_name, private.status_label(new.role::text)),
      'role', null, jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif new.role is distinct from old.role then
    perform private.write_log(v_company, new.project_id, 'project_member', new.id, 'update',
      format('Project role of %s: %s → %s', v_name, private.status_label(old.role::text), private.status_label(new.role::text)),
      'role', to_jsonb(old.role), to_jsonb(new.role));
  end if;
  return null;
end;
$$;
create trigger audit_project_members after insert or update or delete on public.project_members
  for each row execute function private.audit_project_members();

-- ---------------------------------------------------------------------------
-- calendars + calendar_dates
-- ---------------------------------------------------------------------------
create or replace function private.audit_calendars()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_company uuid;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  select p.company_id into v_company from public.projects p where p.id = new.project_id;
  for r in
    select * from (values
      ('work_days', 'Working days', to_jsonb(old.work_days), to_jsonb(new.work_days),
        private.fmt_days(old.work_days), private.fmt_days(new.work_days)),
      ('holidays_nonworking', 'Holidays', to_jsonb(old.holidays_nonworking), to_jsonb(new.holidays_nonworking),
        case when old.holidays_nonworking then 'non-working' else 'working days' end,
        case when new.holidays_nonworking then 'non-working' else 'working days' end),
      ('hours_per_day', 'Hours per day', to_jsonb(old.hours_per_day), to_jsonb(new.hours_per_day),
        private.fmt_hours(old.hours_per_day), private.fmt_hours(new.hours_per_day))
    ) as v(field, label, old_value, new_value, old_text, new_text)
    where v.old_value is distinct from v.new_value
  loop
    perform private.write_log(v_company, new.project_id, 'calendar', new.project_id, 'update',
      format('%s: %s → %s', r.label, r.old_text, r.new_text), r.field, r.old_value, r.new_value);
  end loop;
  return null;
end;
$$;
create trigger audit_calendars after update on public.calendars
  for each row execute function private.audit_calendars();

create or replace function private.audit_calendar_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.calendar_dates;
  v_company uuid;
  v_suffix text;
  v_summary text;
  v_action text;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select p.company_id into v_company from public.projects p where p.id = v_row.project_id;
  if v_company is null then
    return null;
  end if;
  v_suffix := coalesce(' (' || v_row.name || ')', '');

  if tg_op = 'INSERT' then
    v_action := 'create';
    v_summary := case v_row.kind
      when 'holiday' then format('Added holiday %s%s', private.fmt_date(v_row.date), v_suffix)
      when 'override_nonworking' then format('Marked %s as a non-working day%s', private.fmt_date(v_row.date), v_suffix)
      else format('Marked %s as a working day%s', private.fmt_date(v_row.date), v_suffix) end;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_summary := case v_row.kind
      when 'holiday' then format('Removed holiday %s%s', private.fmt_date(v_row.date), v_suffix)
      when 'override_nonworking' then format('Removed the non-working override on %s', private.fmt_date(v_row.date))
      else format('Removed the working-day override on %s', private.fmt_date(v_row.date)) end;
  else
    if new.name is not distinct from old.name and new.date = old.date and new.kind = old.kind then
      return null;
    end if;
    v_action := 'update';
    v_summary := format('Note for %s: %s → %s', private.fmt_date(new.date), private.fmt_text(old.name), private.fmt_text(new.name));
  end if;

  perform private.write_log(v_company, v_row.project_id, 'calendar_date', v_row.id, v_action, v_summary, 'date',
    case when tg_op = 'INSERT' then null
         else jsonb_build_object('date', old.date, 'kind', old.kind, 'name', old.name) end,
    case when tg_op = 'DELETE' then null
         else jsonb_build_object('date', new.date, 'kind', new.kind, 'name', new.name) end);
  return null;
end;
$$;
create trigger audit_calendar_dates after insert or update or delete on public.calendar_dates
  for each row execute function private.audit_calendar_dates();

-- ---------------------------------------------------------------------------
-- activities (WBS)
-- ---------------------------------------------------------------------------
create or replace function private.audit_activities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_company uuid;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  select p.company_id into v_company from public.projects p where p.id = new.project_id;
  if tg_op = 'INSERT' then
    perform private.write_log(v_company, new.project_id, 'activity', new.id, 'create',
      format('Added %s %s', new.wbs_code, new.name), null, null,
      jsonb_strip_nulls(jsonb_build_object(
        'name', new.name, 'level', new.level, 'parent_id', new.parent_id,
        'start_date', new.start_date, 'duration_hours', new.duration_hours,
        'end_date', new.end_date, 'est_cost', new.est_cost)),
      new.id, new.wbs_code, new.name);
    return null;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    perform private.write_log(v_company, new.project_id, 'activity', new.id,
      case when new.deleted_at is null then 'restore' else 'delete' end,
      format('%s %s %s', case when new.deleted_at is null then 'Restored' else 'Deleted' end, new.wbs_code, new.name),
      'deleted_at', to_jsonb(old.deleted_at), to_jsonb(new.deleted_at),
      new.id, new.wbs_code, new.name);
  end if;

  for r in
    select * from (values
      ('name', 'Name', to_jsonb(old.name), to_jsonb(new.name),
        private.fmt_text(old.name), private.fmt_text(new.name)),
      ('description', 'Description', to_jsonb(old.description), to_jsonb(new.description),
        private.fmt_text(old.description, 40), private.fmt_text(new.description, 40)),
      ('start_date', 'Start date', to_jsonb(old.start_date), to_jsonb(new.start_date),
        private.fmt_date(old.start_date), private.fmt_date(new.start_date)),
      ('duration_hours', 'Duration', to_jsonb(old.duration_hours), to_jsonb(new.duration_hours),
        private.fmt_hours(old.duration_hours), private.fmt_hours(new.duration_hours)),
      ('end_date', 'End date', to_jsonb(old.end_date), to_jsonb(new.end_date),
        private.fmt_date(old.end_date), private.fmt_date(new.end_date)),
      ('est_cost', 'Estimated cost', to_jsonb(old.est_cost), to_jsonb(new.est_cost),
        private.fmt_money(old.est_cost), private.fmt_money(new.est_cost)),
      ('status', 'Status', to_jsonb(old.status), to_jsonb(new.status),
        private.status_label(old.status::text), private.status_label(new.status::text)),
      ('percent', '% complete', to_jsonb(old.percent), to_jsonb(new.percent),
        old.percent::text || '%', new.percent::text || '%'),
      ('delayed_reported', 'Reported delayed', to_jsonb(old.delayed_reported), to_jsonb(new.delayed_reported),
        case when old.delayed_reported then 'Yes' else 'No' end,
        case when new.delayed_reported then 'Yes' else 'No' end)
    ) as v(field, label, old_value, new_value, old_text, new_text)
    where v.old_value is distinct from v.new_value
  loop
    perform private.write_log(v_company, new.project_id, 'activity', new.id,
      case r.field when 'status' then 'status_change' when 'name' then 'rename' else 'update' end,
      format('%s: %s → %s', r.label, r.old_text, r.new_text), r.field, r.old_value, r.new_value,
      new.id, new.wbs_code, new.name,
      (r.field = 'status' and new.status in ('delayed', 'on_hold'))
        or (r.field = 'percent' and new.percent < old.percent)
        or (r.field = 'delayed_reported' and new.delayed_reported));
  end loop;
  return null;
end;
$$;
create trigger audit_activities after insert or update on public.activities
  for each row execute function private.audit_activities();

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create or replace function private.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_summary text;
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_log(new.company_id, new.project_id, 'invitation', new.id, 'invite',
      format('Invited %s as %s', new.email, private.status_label(new.role::text)), 'status', null,
      jsonb_build_object('email', new.email, 'role', new.role, 'status', new.status));
    return null;
  end if;
  if new.status is distinct from old.status then
    v_action := case new.status
      when 'accepted' then 'accept'
      when 'declined' then 'decline'
      when 'revoked' then 'revoke'
      when 'expired' then 'expire'
      else 'resend' end;
    v_summary := case new.status
      when 'accepted' then format('%s accepted the invitation (%s)', new.email, private.status_label(new.role::text))
      when 'declined' then format('%s declined the invitation', new.email)
      when 'revoked' then format('Revoked the invitation for %s', new.email)
      when 'expired' then format('The invitation for %s expired', new.email)
      else format('Resent the invitation to %s', new.email) end;
  elsif new.token_hash is distinct from old.token_hash then
    v_action := 'resend';
    v_summary := format('Resent the invitation to %s', new.email);
  else
    return null;
  end if;
  perform private.write_log(new.company_id, new.project_id, 'invitation', new.id, v_action, v_summary, 'status',
    jsonb_build_object('status', old.status, 'role', old.role),
    jsonb_build_object('status', new.status, 'role', new.role));
  return null;
end;
$$;
create trigger audit_invitations after insert or update on public.invitations
  for each row execute function private.audit_invitations();

-- ---------------------------------------------------------------------------
-- invite_codes (company-wide codes are company-scoped entries)
-- ---------------------------------------------------------------------------
create or replace function private.audit_invite_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.audit_enabled() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.write_log(new.company_id, new.project_id, 'invite_code', new.id, 'create',
      format('Created invite code %s (%s)', new.code,
             case when new.project_id is null then 'company-wide' else 'this project' end),
      null, null,
      jsonb_strip_nulls(jsonb_build_object('code', new.code, 'expires_at', new.expires_at, 'max_uses', new.max_uses)));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform private.write_log(new.company_id, new.project_id, 'invite_code', new.id, 'revoke',
      format('Revoked invite code %s', new.code), 'revoked_at', null, to_jsonb(new.revoked_at));
  end if;
  return null;
end;
$$;
create trigger audit_invite_codes after insert or update on public.invite_codes
  for each row execute function private.audit_invite_codes();

revoke execute on all functions in schema private from public, anon;
