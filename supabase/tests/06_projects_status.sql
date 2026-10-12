-- CivPMS database test 06_projects_status: projects, status transitions, baseline, archive, trash
-- Everything below runs in ONE transaction and is rolled back at the end.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
-- (or paste into the Supabase SQL editor). Any failed assertion raises.
begin;

-- ---------------------------------------------------------------------------
-- Test harness (schema `tests` only exists inside this transaction)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create table tests.users (key text primary key, id uuid not null unique, email text not null);
create table tests.vars (key text primary key, val text);
grant select on tests.users to anon, authenticated, service_role;
grant select, insert, update on tests.vars to anon, authenticated, service_role;

-- Throwaway auth user (+ profile via the auth trigger). Run as postgres.
create function tests.new_user(p_key text, p_email text, p_name text default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role, created_at, updated_at)
  values (v_id, p_email,
          case when p_name is null then '{}'::jsonb else jsonb_build_object('full_name', p_name) end,
          'authenticated', 'authenticated', now(), now());
  insert into tests.users values (p_key, v_id, lower(p_email));
  return v_id;
end $$;

-- Impersonate a test user: `set local role authenticated` + request.jwt.claims.
create function tests.login(p_key text) returns void language plpgsql as $$
declare
  v tests.users;
begin
  select * into v from tests.users where key = p_key;
  if not found then
    raise exception 'unknown test user %', p_key;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v.id, 'email', v.email, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;

-- Back to the migration role (postgres) for setup steps.
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;

create function tests.uid(p_key text) returns uuid language sql stable as $$
  select u.id from tests.users u where u.key = p_key
$$;

create function tests.set(p_key text, p_val text) returns void language sql as $$
  insert into tests.vars values (p_key, p_val) on conflict (key) do update set val = excluded.val
$$;
create function tests.get(p_key text) returns text language sql stable as $$
  select v.val from tests.vars v where v.key = p_key
$$;
create function tests.id(p_key text) returns uuid language sql stable as $$
  select v.val::uuid from tests.vars v where v.key = p_key
$$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
end $$;

create function tests.eq(p_actual anycompatible, p_expected anycompatible, p_msg text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
end $$;

-- Run p_sql and return 'CODE|detail' of the error it raises (NULL if it succeeds).
create function tests.error_of(p_sql text) returns text language plpgsql as $$
declare
  v_msg text;
  v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    return v_msg || '|' || coalesce(v_detail, '');
  end;
  return null;
end $$;

-- Assert that p_sql fails with application error code p_code (MESSAGE = code).
create function tests.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_msg = p_code then
      return;
    end if;
    raise exception 'ASSERTION FAILED: expected % from [%] but got % %', p_code, p_sql, v_state, v_msg;
  end;
  raise exception 'ASSERTION FAILED: expected % but [%] succeeded', p_code, p_sql;
end $$;

-- Assert that p_sql fails with SQLSTATE p_state (e.g. 42501 permission denied).
create function tests.expect_sqlstate(p_sql text, p_state text) returns void language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_state then
      return;
    end if;
    raise exception 'ASSERTION FAILED: expected SQLSTATE % from [%] but got % %', p_state, p_sql, v_state, v_msg;
  end;
  raise exception 'ASSERTION FAILED: expected SQLSTATE % but [%] succeeded', p_state, p_sql;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ===========================================================================
-- 06 · Projects: create/validate, edit with STALE_VERSION, status rules
--      (spec §5.2), Baseline v1, archive, soft delete/restore
-- ===========================================================================
select tests.new_user('owner', 'owner@example.com', 'Olive Owner');
select tests.new_user('pm', 'pm@example.com', 'Pete PM');
select tests.new_user('insp', 'insp@example.com', 'Ivy Inspector');

select tests.login('owner');
select tests.set('company', (public.create_company('Acme Builders')).id::text);
select tests.logout();
insert into public.company_members (company_id, user_id, role) values
  (tests.id('company'), tests.uid('pm'), 'pm'),
  (tests.id('company'), tests.uid('insp'), 'inspector');

-- ---------------------------------------------------------------------------
-- create_project
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.expect_error('select public.create_project(''AB'', ''2026-10-01'', ''2026-12-31'', 1000)', 'VALIDATION');
select tests.expect_error('select public.create_project(''Valid Name'', ''2026-10-01'', ''2026-09-30'', 1000)', 'INVALID_DATES');
select tests.eq(split_part(tests.error_of('select public.create_project(''Valid Name'', ''2026-10-01'', ''2026-09-30'', 1000)'), '|', 2),
                'End date must be on or after 1 Oct 2026.', 'date message names the fix');
select tests.expect_error('select public.create_project(''Valid Name'', null, ''2026-09-30'', 1000)', 'VALIDATION');
select tests.expect_error('select public.create_project(''Valid Name'', ''2026-10-01'', ''2026-12-31'', 0)', 'INVALID_BUDGET');
select tests.expect_error('select public.create_project(''Valid Name'', ''2026-10-01'', ''2026-12-31'', 10.005)', 'INVALID_BUDGET');
select tests.set('p', row_to_json(public.create_project('  Riverside   Tower ', '2026-10-01', '2027-03-31', 1000000.50,
                                                          'Site A', 'Pasig City', 'Phase 1', 'teal'))::text);
select tests.set('p1', tests.get('p')::jsonb ->> 'id');
select tests.eq(tests.get('p')::jsonb ->> 'name', 'Riverside Tower', 'name cleaned');
select tests.eq(tests.get('p')::jsonb ->> 'status', 'planning', 'starts in planning');
select tests.eq(tests.get('p')::jsonb ->> 'color', 'teal', 'color');
select tests.eq((tests.get('p')::jsonb ->> 'version')::integer, 1, 'version 1');
select tests.expect_error('select public.create_project(''riverside TOWER'', ''2026-10-01'', ''2027-03-31'', 5)', 'PROJECT_NAME_TAKEN');
-- creator is PM member; calendar + PH holidays for 2026..2027 copied
select tests.eq((select role::text from public.project_members where project_id = tests.id('p1') and user_id = tests.uid('pm')), 'pm', 'creator is pm');
select tests.eq((select work_days from public.calendars where project_id = tests.id('p1')), '{1,2,3,4,5}'::smallint[], 'Mon–Fri default');
select tests.eq((select count(*) from public.calendar_dates where project_id = tests.id('p1') and kind = 'holiday'), 38::bigint, '2026+2027 holidays copied');
select tests.eq((select name from public.calendar_dates where project_id = tests.id('p1') and date = '2026-12-25'), 'Christmas Day', 'holiday name');
select tests.eq((select count(*) from public.activity_logs where project_id = tests.id('p1') and entity_type = 'calendar_date'), 0::bigint,
                'holiday copy is not logged row by row');
select public.add_project_member(tests.id('p1'), tests.uid('insp'), 'inspector');
select tests.logout();

-- ---------------------------------------------------------------------------
-- update_project + optimistic concurrency
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.expect_error(format('select public.update_project(%L, ''{"budget": 1200000}'', 7)', tests.id('p1')), 'STALE_VERSION');
select tests.expect_error(format('select public.update_project(%L, ''{"status": "active"}'', 1)', tests.id('p1')), 'VALIDATION');
select tests.expect_error(format('select public.update_project(%L, ''{"end_date": "2026-01-01"}'', 1)', tests.id('p1')), 'INVALID_DATES');
select tests.expect_error(format('select public.update_project(%L, ''{"color": "red"}'', 1)', tests.id('p1')), 'VALIDATION');
select tests.expect_error(format('select public.update_project(%L, ''{"near_budget_threshold": 0.2}'', 1)', tests.id('p1')), 'VALIDATION');
select tests.eq((public.update_project(tests.id('p1'), '{"budget": 1200000, "site_name": "Site B"}', 1)).version, 2, 'version bumped');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and field = 'budget'
                          and summary = 'Budget: ₱1,000,000.50 → ₱1,200,000.00'), 'budget change logged with ₱ formatting');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and field = 'site_name'
                          and summary = 'Site name: Site A → Site B'), 'one log row per changed field');
select tests.expect_error(format('select public.update_project(%L, ''{"budget": 1300000}'', 1)', tests.id('p1')), 'STALE_VERSION');
-- extending into 2028 copies that year's holidays (none seeded yet → 0), no error
select tests.eq((public.update_project(tests.id('p1'), '{"end_date": "2028-02-01"}', 2)).end_date, '2028-02-01'::date, 'end date moved');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Activities for the status rules
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.set('d1', (public.create_activity(tests.id('p1'), null, 'Foundations')).id::text);
select tests.set('w1', (public.create_activity(tests.id('p1'), tests.id('d1'), 'Excavation', null,
                         '{"est_cost": 400000, "duration_hours": 80, "start_date": "2026-10-05", "end_date": "2026-10-16"}')).id::text);
select tests.set('w2', (public.create_activity(tests.id('p1'), tests.id('d1'), 'Footings', null,
                         '{"est_cost": 200000, "duration_hours": 0, "start_date": "2026-10-19", "end_date": "2026-10-19"}')).id::text);
select tests.set('d2', (public.create_activity(tests.id('p1'), null, 'Structure')).id::text);
select tests.logout();

-- ---------------------------------------------------------------------------
-- set_project_status
-- ---------------------------------------------------------------------------
select tests.login('insp');
select tests.expect_error(format('select public.set_project_status(%L, ''active'')', tests.id('p1')), 'FORBIDDEN');
select tests.logout();

select tests.login('pm');
select tests.expect_error(format('select public.set_project_status(%L, ''completed'')', tests.id('p1')), 'INVALID_TRANSITION');
select tests.expect_error(format('select public.set_project_status(%L, ''on_hold'', ''rain'')', tests.id('p1')), 'INVALID_TRANSITION');
select tests.expect_error(format('select public.set_project_status(%L, ''planning'')', tests.id('p1')), 'INVALID_TRANSITION');
select tests.expect_error(format('select public.set_project_status(%L, ''cancelled'', ''budget cut'')', tests.id('p1')), 'FORBIDDEN');
-- planning → active captures Baseline v1
select tests.eq((public.set_project_status(tests.id('p1'), 'active')).status::text, 'active', 'activated');
select tests.eq((select count(*) from public.baselines where project_id = tests.id('p1') and version_no = 1 and is_active), 1::bigint, 'Baseline v1 captured');
select tests.eq((select count(*) from public.baseline_activities ba join public.baselines b on b.id = ba.baseline_id
                  where b.project_id = tests.id('p1')), 4::bigint, 'every activity frozen');
select tests.eq((select cost from public.baseline_activities where activity_id = tests.id('d1')), 600000.00, 'parent cost rolled up from leaves');
select tests.eq((select start_date from public.baseline_activities where activity_id = tests.id('d1')), '2026-10-05'::date, 'parent start = min');
select tests.eq((select end_date from public.baseline_activities where activity_id = tests.id('d1')), '2026-10-19'::date, 'parent end = max');
select tests.eq((select weight from public.baseline_activities where activity_id = tests.id('d2')), 1.0, 'empty leaf weighs 1');
select tests.ok((select is_leaf from public.baseline_activities where activity_id = tests.id('w1'))
                and not (select is_leaf from public.baseline_activities where activity_id = tests.id('d1')), 'leaf flags');
-- active ↔ on_hold (reason required)
select tests.expect_error(format('select public.set_project_status(%L, ''on_hold'')', tests.id('p1')), 'REASON_REQUIRED');
select tests.expect_error(format('select public.set_project_status(%L, ''on_hold'', ''   '')', tests.id('p1')), 'REASON_REQUIRED');
select tests.eq((public.set_project_status(tests.id('p1'), 'on_hold', 'Rainy season')).status_reason, 'Rainy season', 'on hold with reason');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and action = 'status_change'
                          and summary = 'Status: Active → On-Hold' and note = 'Rainy season' and is_escalation), 'on-hold logged as escalation');
select tests.eq((public.set_project_status(tests.id('p1'), 'active')).status::text, 'active', 'resumed');
-- completion is blocked until every activity at every level is completed
select tests.eq(tests.error_of(format('select public.set_project_status(%L, ''completed'')', tests.id('p1'))),
                'PROJECT_HAS_INCOMPLETE_ACTIVITIES|4 activities are not completed yet: 1 Foundations, 1.1 Excavation, 1.2 Footings, 2 Structure. Complete them first, then try again.',
                'blocked with the list of open activities');
select tests.logout();
-- more than 10 open activities: list is capped at 10 + "and N more"
update public.activities set status = 'completed', percent = 100 where project_id = tests.id('p1');
select tests.login('pm');
select public.create_activity(tests.id('p1'), tests.id('d2'), 'Column ' || n) from generate_series(1, 12) n;
select tests.ok(tests.error_of(format('select public.set_project_status(%L, ''completed'')', tests.id('p1')))
                  like 'PROJECT_HAS_INCOMPLETE_ACTIVITIES|12 activities are not completed yet: 2.1 Column 1, 2.2 Column 2, %, 2.10 Column 10 and 2 more.%',
                'capped list with total count');
select tests.logout();
update public.activities set status = 'completed', percent = 100 where project_id = tests.id('p1');
select tests.login('pm');
select tests.eq((public.set_project_status(tests.id('p1'), 'completed')).status::text, 'completed', 'completed when all activities are');
select tests.ok((select closed_at is not null from public.projects where id = tests.id('p1')), 'closed_at set');
select tests.eq((public.set_project_archived(tests.id('p1'), true)).is_archived, true, 'archived');
-- reopen: completed → active clears closed_at and the archive flag
select tests.eq((public.set_project_status(tests.id('p1'), 'active')).status::text, 'active', 'reopened');
select tests.ok((select closed_at is null and not is_archived from public.projects where id = tests.id('p1')), 'reopen resets retention clock + archive');
select tests.expect_error(format('select public.set_project_archived(%L, true)', tests.id('p1')), 'NOT_CLOSED');
select tests.eq((select count(*) from public.baselines where project_id = tests.id('p1')), 1::bigint, 'no second automatic baseline');
select tests.logout();

-- a project without activities can never be completed
select tests.login('pm');
select tests.set('p2', (public.create_project('Empty Project', '2026-10-01', '2026-12-31', 1000)).id::text);
select public.set_project_status(tests.id('p2'), 'active');
select tests.expect_error(format('select public.set_project_status(%L, ''completed'')', tests.id('p2')), 'PROJECT_HAS_INCOMPLETE_ACTIVITIES');
select tests.logout();

-- cancel: Owner PM only, reason required, terminal
select tests.login('owner');
select tests.expect_error(format('select public.set_project_status(%L, ''cancelled'')', tests.id('p2')), 'REASON_REQUIRED');
select tests.eq((public.set_project_status(tests.id('p2'), 'cancelled', 'Client withdrew')).status::text, 'cancelled', 'cancelled by owner');
select tests.expect_error(format('select public.set_project_status(%L, ''active'')', tests.id('p2')), 'INVALID_TRANSITION');
select tests.eq((public.set_project_archived(tests.id('p2'), true)).is_archived, true, 'cancelled projects can be archived');
select tests.eq((public.set_project_archived(tests.id('p2'), false)).is_archived, false, 'and unarchived');
select tests.logout();
select tests.login('insp');
select tests.ok(exists (select 1 from public.notifications where type = 'project_status_changed'), 'members notified of status changes');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Soft delete / restore (Owner PM only, 30 days, name conflicts)
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.expect_error(format('select public.delete_project(%L)', tests.id('p1')), 'FORBIDDEN');
select tests.logout();
select tests.login('owner');
select tests.ok((public.delete_project(tests.id('p1')) ->> 'restore_until') is not null, 'deleted');
select tests.expect_error(format('select public.delete_project(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.set('p3', (public.create_project('RIVERSIDE tower', '2026-10-01', '2027-03-31', 10)).id::text);
select tests.ok((select name_conflict from public.project_trash() where id = tests.id('p1')), 'trash flags the name conflict');
select tests.expect_error(format('select public.restore_project(%L)', tests.id('p1')), 'PROJECT_NAME_TAKEN');
select public.update_project(tests.id('p3'), '{"name": "Riverside Tower (new)"}', 1);
select tests.eq((public.restore_project(tests.id('p1'))).deleted_at, null::timestamptz, 'restored');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and action = 'restore'), 'restore logged');
select tests.logout();
update public.projects set deleted_at = now() - interval '31 days', deleted_by = tests.uid('owner') where id = tests.id('p3');
select tests.login('owner');
select tests.eq((select count(*) from public.project_trash() where id = tests.id('p3')), 0::bigint, 'older than 30 days leaves the trash list');
select tests.expect_error(format('select public.restore_project(%L)', tests.id('p3')), 'RESTORE_EXPIRED');
select tests.logout();

select '06_projects_status: all assertions passed' as result;
rollback;
