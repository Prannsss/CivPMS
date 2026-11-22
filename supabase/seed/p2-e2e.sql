-- CivPMS test tenant for the Stage A Gantt and S-curve (docs/ROADMAP.md §4.0). See supabase/seed/README.md.
--
-- * Creates (or reuses) one confirmed account on the reserved @civpms.test domain:
--     p2-pm@civpms.test  -> Owner PM of "[P2] Schedule Lab Builders"
--   and, through the app's own RPCs (impersonating that user, so RLS, logs and Baseline v1 are real):
--     "[P2] Gantt Lab"   Active, started 4 weeks ago, ends in 3 weeks; one work package runs past the
--                        end; some work is past its dates (auto-Delayed); a milestone; one work
--                        package moved a week later after Baseline v1 (baseline variance).
--     "[P2] Gantt Late"  Active, ended 5 days ago (overrun shading); everything else on plan.
--   Dates are relative to today, so the seed stays useful on any day.
-- * Idempotent: projects that already have activities are left as they are.
-- * Password: `civpms.demo_password` (same as demo.sql), 10+ characters:
--       select set_config('civpms.demo_password', '<DEMO_PASSWORD from .env.local>', false);
-- * Removed by demo-cleanup.sql together with every other @civpms.test account.

begin;

-- D20 end date: 0 h = milestone (end = start); otherwise ceil(h / hours_per_day) working days from
-- the first working day >= start (override, then holidays when non-working, then the weekday rule).
create or replace function pg_temp.p2_end_date(p_project uuid, p_start date, p_hours numeric)
returns date language plpgsql as $fn$
declare
  v_cal public.calendars;
  v_days integer;
  v_end date;
begin
  if p_start is null or p_hours is null then return null; end if;
  if p_hours = 0 then return p_start; end if;
  select * into strict v_cal from public.calendars c where c.project_id = p_project;
  v_days := greatest(1, ceil(p_hours / v_cal.hours_per_day - 0.000000001))::integer;
  select w.d into v_end
    from (select g::date as d, row_number() over (order by g) as n
            from generate_series(p_start::timestamp, p_start::timestamp + interval '3660 days', interval '1 day') as g
           where coalesce(
                   (select cd.kind = 'override_working' from public.calendar_dates cd
                     where cd.project_id = p_project and cd.date = g::date and cd.kind <> 'holiday' limit 1),
                   case when v_cal.holidays_nonworking
                             and exists (select 1 from public.calendar_dates cd
                                          where cd.project_id = p_project and cd.date = g::date and cd.kind = 'holiday')
                        then false
                        else extract(isodow from g)::smallint = any (v_cal.work_days) end)) w
   where w.n = v_days;
  return v_end;
end
$fn$;

do $p2$
declare
  c_pw constant text := nullif(current_setting('civpms.demo_password', true), '');
  c_email constant text := 'p2-pm@civpms.test';
  c_company constant text := '[P2] Schedule Lab Builders';
  c_today constant date := (now() at time zone 'Asia/Manila')::date;
  -- WBS per project: code, name, start offset (days from today), hours, cost (₱). Parents have no dates.
  c_projects constant jsonb := jsonb_build_array(
    jsonb_build_object('key', 'lab', 'name', '[P2] Gantt Lab', 'start', -28, 'end', 21, 'budget', 9000000, 'color', 'teal', 'wbs', jsonb_build_array(
      jsonb_build_object('c', '1', 'n', 'Site preparation'),
      jsonb_build_object('c', '1.1', 'n', 'Survey and clearing'),
      jsonb_build_object('c', '1.1.1', 'n', 'Topographic survey', 's', -28, 'h', 24, 'k', 180000),
      jsonb_build_object('c', '1.1.2', 'n', 'Clearing and grubbing', 's', -24, 'h', 40, 'k', 420000),
      jsonb_build_object('c', '1.2', 'n', 'Mobilisation'),
      jsonb_build_object('c', '1.2.1', 'n', 'Temporary facilities', 's', -17, 'h', 32, 'k', 350000),
      jsonb_build_object('c', '1.2.2', 'n', 'Site access approved', 's', -12, 'h', 0, 'k', 0),
      jsonb_build_object('c', '2', 'n', 'Foundations'),
      jsonb_build_object('c', '2.1', 'n', 'Excavation', 's', -10, 'h', 64, 'k', 1250000),
      jsonb_build_object('c', '2.2', 'n', 'Footings and pedestals'),
      jsonb_build_object('c', '2.2.1', 'n', 'Rebar works', 's', -3, 'h', 56, 'k', 980000),
      jsonb_build_object('c', '2.2.2', 'n', 'Concrete pouring', 's', 6, 'h', 40, 'k', 1600000),
      jsonb_build_object('c', '3', 'n', 'Superstructure'),
      jsonb_build_object('c', '3.1', 'n', 'Columns, ground floor', 's', 13, 'h', 80, 'k', 2100000),
      jsonb_build_object('c', '3.2', 'n', 'Slab formworks (runs past the end date)', 's', 20, 'h', 64, 'k', 1300000))),
    jsonb_build_object('key', 'late', 'name', '[P2] Gantt Late', 'start', -45, 'end', -5, 'budget', 3000000, 'color', 'purple', 'wbs', jsonb_build_array(
      jsonb_build_object('c', '1', 'n', 'Perimeter fence'),
      jsonb_build_object('c', '1.1', 'n', 'Post holes', 's', -45, 'h', 40, 'k', 250000),
      jsonb_build_object('c', '1.2', 'n', 'Fence panels', 's', -30, 'h', 80, 'k', 900000),
      jsonb_build_object('c', '2', 'n', 'Guardhouse'),
      jsonb_build_object('c', '2.1', 'n', 'Guardhouse slab', 's', -20, 'h', 48, 'k', 600000),
      jsonb_build_object('c', '2.2', 'n', 'Guardhouse walls and roof', 's', -12, 'h', 64, 'k', 1100000))));
  v_uid uuid;
  v_company uuid;
  v_pid uuid;
  v_project public.projects;
  v_act public.activities;
  v_spec jsonb;
  v_ids jsonb;
  v_parent uuid;
  v_start date;
  v_end date;
  r record;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;
  if c_pw is null or char_length(c_pw) < 10 then
    raise exception 'Set the demo password first (10+ characters): select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false);';
  end if;

  -- 1. Account (confirmed email + password; GoTrue needs auth.identities and '' token columns).
  select u.id into v_uid from auth.users u where lower(u.email) = c_email and u.is_sso_user = false;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
    values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', c_email,
      extensions.crypt(c_pw, extensions.gen_salt('bf', 10)), now(),
      '', '', '', '', '', '', '', '',
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('sub', v_uid::text, 'email', c_email, 'email_verified', true, 'phone_verified', false),
      now(), now(), false, false);
    raise notice 'created account %', c_email;
  else
    update auth.users
       set encrypted_password = extensions.crypt(c_pw, extensions.gen_salt('bf', 10)),
           email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_uid;
    raise notice 'reset password of %', c_email;
  end if;
  if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'email') then
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', c_email, 'email_verified', true, 'phone_verified', false),
            'email', null, now(), now());
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'email', c_email, 'role', 'authenticated')::text, true);

  -- 2. Onboarding and company.
  if exists (select 1 from public.profiles p where p.id = v_uid and (p.full_name is null or p.role_pref is null)) then
    set local role authenticated;
    perform public.complete_profile('[P2] Rosa Schedule', 'pm');
    reset role;
  end if;
  if not exists (select 1 from public.company_members cm where cm.user_id = v_uid) then
    set local role authenticated;
    perform public.create_company(c_company);
    reset role;
  end if;
  select cm.company_id into strict v_company from public.company_members cm where cm.user_id = v_uid and cm.role = 'owner_pm';

  -- 3. Projects with their WBS, then Active (captures Baseline v1).
  for v_spec in select e.value from jsonb_array_elements(c_projects) e loop
    select p.id into v_pid from public.projects p
     where p.company_id = v_company and p.name_key = private.name_key(v_spec ->> 'name') and p.deleted_at is null;
    if v_pid is null then
      set local role authenticated;
      v_project := public.create_project(
        v_spec ->> 'name', c_today + (v_spec ->> 'start')::int, c_today + (v_spec ->> 'end')::int,
        (v_spec ->> 'budget')::numeric, 'Test site', null, 'Stage A Gantt / S-curve test data (tagged [P2]).',
        (v_spec ->> 'color')::public.project_color);
      reset role;
      v_pid := v_project.id;
      raise notice 'created project %', v_spec ->> 'name';
    end if;

    if not exists (select 1 from public.activities a where a.project_id = v_pid and a.deleted_at is null) then
      v_ids := '{}';
      for r in
        select e.v ->> 'c' as code, e.v ->> 'n' as name, (e.v ->> 's')::int as s, (e.v ->> 'h')::numeric as hours,
               (e.v ->> 'k')::numeric as cost
          from jsonb_array_elements(v_spec -> 'wbs') with ordinality as e(v, i) order by e.i
      loop
        v_parent := case when position('.' in r.code) > 0 then (v_ids ->> regexp_replace(r.code, '\.[0-9]+$', ''))::uuid end;
        v_start := case when r.s is null then null else c_today + r.s end;
        v_end := pg_temp.p2_end_date(v_pid, v_start, r.hours); -- as postgres: pg_temp is not granted to the app role
        set local role authenticated;
        v_act := public.create_activity(v_pid, v_parent, r.name, null, jsonb_strip_nulls(jsonb_build_object(
          'start_date', v_start, 'duration_hours', r.hours, 'end_date', v_end, 'est_cost', r.cost)));
        reset role;
        if v_act.wbs_code <> r.code then
          raise exception 'WBS code mismatch: expected %, got %', r.code, v_act.wbs_code;
        end if;
        v_ids := v_ids || jsonb_build_object(r.code, v_act.id);
      end loop;

      set local role authenticated;
      perform public.set_project_status(v_pid, 'active', null);
      reset role;

      -- After Baseline v1: move one work package a week later (variance on the baseline overlay).
      if v_spec ->> 'key' = 'lab' then
        select * into strict v_act from public.activities a where a.id = (v_ids ->> '2.2.2')::uuid;
        v_start := v_act.start_date + 7;
        v_end := pg_temp.p2_end_date(v_pid, v_start, v_act.duration_hours);
        set local role authenticated;
        perform public.update_activity(v_act.id, jsonb_build_object('start_date', v_start, 'end_date', v_end), v_act.version);
        reset role;
      end if;
      raise notice 'planned and activated %', v_spec ->> 'name';
    end if;
    v_pid := null;
  end loop;

  perform set_config('request.jwt.claims', '', true);
end
$p2$;

commit;

select p.name, p.status, p.start_date, p.end_date,
       (select count(*) from public.activities a where a.project_id = p.id and a.deleted_at is null) as activities,
       (select count(*) from public.baselines b where b.project_id = p.id) as baselines
  from public.projects p
  join public.company_members cm on cm.company_id = p.company_id
  join auth.users u on u.id = cm.user_id
 where u.email = 'p2-pm@civpms.test' and p.deleted_at is null
 order by p.name;
