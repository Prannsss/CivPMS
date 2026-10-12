-- Working calendar (spec §7): save settings + the full date list + the app's
-- rescheduled activities atomically.

-- p_dates is the FULL replacement list: [{"date": "2026-12-24", "kind": "holiday"|"override_nonworking"|"override_working", "name": "..."}].
-- Only real differences are written (so the activity log shows what changed).
-- p_schedule uses the apply_schedule row shape and may be [] or NULL.
create or replace function public.save_calendar(
  p_project_id uuid,
  p_work_days smallint[],
  p_holidays_nonworking boolean,
  p_hours_per_day numeric,
  p_dates jsonb,
  p_schedule jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days smallint[];
  v_hours numeric;
  v_item jsonb;
  v_kind text;
  v_date date;
  v_name text;
  v_d date[] := '{}';
  v_k public.calendar_date_kind[] := '{}';
  v_n text[] := '{}';
  v_removed integer;
  v_updated integer;
  v_added integer;
  v_moved integer;
  v_calendar public.calendars;
begin
  perform private.assert_can_manage_project(p_project_id);
  v_days := private.normalize_work_days(p_work_days);
  v_hours := private.validate_hours_per_day(p_hours_per_day);
  if p_holidays_nonworking is null then
    perform private.raise_error('VALIDATION', 'Choose whether holidays are working days.', 'holidays_nonworking');
  end if;
  if p_dates is null or jsonb_typeof(p_dates) <> 'array' then
    perform private.raise_error('VALIDATION', 'Send the calendar dates as a list of {date, kind, name}.', 'dates');
  end if;
  if jsonb_array_length(p_dates) > 2000 then
    perform private.raise_error('VALIDATION', 'A calendar can hold up to 2,000 holidays and overrides.', 'dates');
  end if;

  for v_item in select e.value from jsonb_array_elements(p_dates) e loop
    if jsonb_typeof(v_item) <> 'object' then
      perform private.raise_error('VALIDATION', 'Each calendar date must be an object like {"date": "2026-12-24", "kind": "holiday"}.', 'dates');
    end if;
    perform private.assert_patch_keys(v_item, array['date', 'kind', 'name']);
    v_date := private.patch_date(v_item, 'date');
    if v_date is null then
      perform private.raise_error('VALIDATION', 'Each calendar entry needs a date.', 'date');
    end if;
    v_kind := private.patch_text(v_item, 'kind');
    if v_kind is null or v_kind not in ('holiday', 'override_nonworking', 'override_working') then
      perform private.raise_error('VALIDATION',
        format('The entry for %s needs a kind: holiday, override_nonworking or override_working.', private.fmt_date(v_date)), 'kind');
    end if;
    v_name := private.optional_text(private.patch_text(v_item, 'name'), 'name', 200);
    if exists (select 1 from unnest(v_d, v_k) as x(d, k) where x.d = v_date and x.k::text = v_kind) then
      perform private.raise_error('VALIDATION', format('%s is listed twice. Keep one entry.', private.fmt_date(v_date)), 'dates');
    end if;
    if v_kind <> 'holiday'
       and exists (select 1 from unnest(v_d, v_k) as x(d, k) where x.d = v_date and x.k <> 'holiday') then
      perform private.raise_error('VALIDATION',
        format('%s cannot be both a working and a non-working day. Keep one override.', private.fmt_date(v_date)), 'dates');
    end if;
    v_d := v_d || v_date;
    v_k := v_k || v_kind::public.calendar_date_kind;
    v_n := v_n || v_name;
  end loop;

  perform private.lock_wbs(p_project_id);
  perform set_config('pms.via', 'calendar', true);

  insert into public.calendars as c (project_id, work_days, holidays_nonworking, hours_per_day)
  values (p_project_id, v_days, p_holidays_nonworking, v_hours)
  on conflict (project_id) do update
    set work_days = excluded.work_days,
        holidays_nonworking = excluded.holidays_nonworking,
        hours_per_day = excluded.hours_per_day
    where (c.work_days, c.holidays_nonworking, c.hours_per_day)
          is distinct from (excluded.work_days, excluded.holidays_nonworking, excluded.hours_per_day);

  with gone as (
    delete from public.calendar_dates cd
     where cd.project_id = p_project_id
       and not exists (select 1 from unnest(v_d, v_k) as x(d, k) where x.d = cd.date and x.k = cd.kind)
    returning 1
  )
  select count(*) into v_removed from gone;

  with changed as (
    update public.calendar_dates cd
       set name = x.n
      from unnest(v_d, v_k, v_n) as x(d, k, n)
     where cd.project_id = p_project_id and cd.date = x.d and cd.kind = x.k
       and cd.name is distinct from x.n
    returning 1
  )
  select count(*) into v_updated from changed;

  with added as (
    insert into public.calendar_dates (project_id, date, kind, name)
    select p_project_id, x.d, x.k, x.n
      from unnest(v_d, v_k, v_n) as x(d, k, n)
     where not exists (select 1 from public.calendar_dates cd
                        where cd.project_id = p_project_id and cd.date = x.d and cd.kind = x.k)
     order by x.d, x.k
    returning 1
  )
  select count(*) into v_added from added;

  v_moved := private.apply_schedule_rows(p_project_id, coalesce(p_schedule, '[]'::jsonb));
  perform set_config('pms.via', '', true);

  select * into v_calendar from public.calendars where project_id = p_project_id;
  return jsonb_build_object(
    'calendar', to_jsonb(v_calendar),
    'dates_added', v_added,
    'dates_removed', v_removed,
    'dates_updated', v_updated,
    'activities_rescheduled', v_moved);
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  public.save_calendar(uuid, smallint[], boolean, numeric, jsonb, jsonb)
from public, anon;
grant execute on function
  public.save_calendar(uuid, smallint[], boolean, numeric, jsonb, jsonb)
to authenticated, service_role;
