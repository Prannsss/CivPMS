-- CivPMS database test 03_isolation_rls: visibility, cross-company isolation, roles, append-only log
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
-- 03 · Visibility & isolation: cross-company, roles, soft-deleted projects,
--      append-only activity log, private notifications
-- ===========================================================================
select tests.new_user('a_owner', 'a.owner@example.com', 'Alice Owner');
select tests.new_user('a_pm', 'a.pm@example.com', 'Arthur PM');
select tests.new_user('a_pm2', 'a.pm2@example.com', 'Amy Outsider PM');
select tests.new_user('a_insp', 'a.insp@example.com', 'Andy Inspector');
select tests.new_user('b_owner', 'b.owner@example.com', 'Bob Owner');

select tests.login('a_owner');
select tests.set('company_a', (public.create_company('Alpha Construction')).id::text);
select tests.set('p1', (public.create_project('Alpha Tower', '2026-10-01', '2027-06-30', 5000000)).id::text);
select tests.set('p2', (public.create_project('Alpha Bridge', '2026-11-01', '2027-02-28', 2000000)).id::text);
select tests.set('d1', (public.create_activity(tests.id('p1'), null, 'Foundations')).id::text);
select tests.set('w1', (public.create_activity(tests.id('p1'), tests.id('d1'), 'Excavation', null,
                         '{"est_cost": 100000, "duration_hours": 40, "start_date": "2026-10-05", "end_date": "2026-10-09"}')).id::text);
select tests.logout();

select tests.login('b_owner');
select tests.set('company_b', (public.create_company('Bravo Builders')).id::text);
select tests.set('pb', (public.create_project('Bravo Mall', '2026-10-01', '2027-06-30', 1000000)).id::text);
select tests.logout();

-- company A members (as if they had accepted invitations)
insert into public.company_members (company_id, user_id, role) values
  (tests.id('company_a'), tests.uid('a_pm'), 'pm'),
  (tests.id('company_a'), tests.uid('a_pm2'), 'pm'),
  (tests.id('company_a'), tests.uid('a_insp'), 'inspector');
select tests.login('a_owner');
select public.add_project_member(tests.id('p1'), tests.uid('a_pm'), 'pm');
select public.add_project_member(tests.id('p1'), tests.uid('a_insp'), 'inspector');
select public.add_project_member(tests.id('p2'), tests.uid('a_pm'), 'pm');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Owner PM sees all company projects; PMs/inspectors only their projects
-- ---------------------------------------------------------------------------
select tests.login('a_owner');
select tests.eq((select count(*) from public.projects), 2::bigint, 'owner sees both projects');
select tests.eq((select count(*) from public.project_overview), 2::bigint, 'owner overview rows');
select tests.eq((select my_company_role::text from public.project_overview where id = tests.id('p1')), 'owner_pm', 'my_company_role');
select tests.logout();

select tests.login('a_pm');
select tests.eq((select count(*) from public.projects), 2::bigint, 'pm sees projects they are on');
select tests.eq((select my_project_role::text from public.project_overview where id = tests.id('p1')), 'pm', 'my_project_role');
select tests.logout();

select tests.login('a_pm2');
select tests.eq((select count(*) from public.projects), 0::bigint, 'non-member PM sees no projects');
select tests.eq((select count(*) from public.activities), 0::bigint, 'non-member PM sees no activities');
select tests.eq((select count(*) from public.calendar_dates), 0::bigint, 'non-member PM sees no calendar');
select tests.eq((select count(*) from public.activity_logs where project_id is not null), 0::bigint, 'non-member PM sees no project log');
select tests.expect_error(format('select public.update_project(%L, ''{"budget": 1}'', 1)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.invite_to_project(%L, ''z@example.com'', ''inspector'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.set_project_status(%L, ''active'')', tests.id('p1')), 'NOT_FOUND');
-- PMs can still see their teammates' profiles
select tests.eq((select count(*) from public.profiles), 4::bigint, 'company profiles visible');
select tests.logout();

select tests.login('a_insp');
select tests.eq((select count(*) from public.projects), 1::bigint, 'inspector sees only P1');
select tests.eq((select count(*) from public.activities), 2::bigint, 'inspector sees P1 activities');
select tests.ok((select count(*) from public.activity_logs where project_id = tests.id('p1')) > 0, 'inspector sees P1 log');
select tests.eq((select my_project_role::text from public.project_overview), 'inspector', 'inspector overview role');
-- inspector cannot edit WBS / project / calendar / team
select tests.expect_error(format('select public.update_project(%L, ''{"budget": 1}'', 1)', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.set_project_status(%L, ''active'')', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.set_project_archived(%L, true)', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.delete_project(%L)', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'')', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "X"}'', 1)', tests.id('w1')), 'FORBIDDEN');
select tests.expect_error(format('select public.move_activity(%L, null, 0)', tests.id('w1')), 'FORBIDDEN');
select tests.expect_error(format('select public.delete_activity(%L)', tests.id('w1')), 'FORBIDDEN');
select tests.expect_error(format('select public.apply_schedule(%L, ''[]'')', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, ''[]'', ''[]'')', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.invite_to_project(%L, ''z@example.com'', ''inspector'')', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error(format('select public.remove_project_member(%L, %L)', tests.id('p1'), tests.uid('a_pm')), 'FORBIDDEN');
select tests.expect_error(format('select public.add_project_member(%L, %L, ''inspector'')', tests.id('p1'), tests.uid('a_pm2')), 'FORBIDDEN');
select tests.expect_error(format('select public.create_invite_code(%L)', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error('select public.create_invite_code()', 'FORBIDDEN');
select tests.expect_error(format('select * from public.activity_trash(%L)', tests.id('p1')), 'FORBIDDEN');
select tests.expect_error('select public.create_project(''Inspector Project'', ''2026-10-01'', ''2026-12-01'', 1000)', 'FORBIDDEN');
-- inspectors see no invitations / invite codes
select tests.eq((select count(*) from public.invitations), 0::bigint, 'inspector sees no invitations');
select tests.eq((select count(*) from public.invite_codes), 0::bigint, 'inspector sees no invite codes');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Company B sees nothing of company A and cannot call A's RPCs
-- ---------------------------------------------------------------------------
select tests.login('b_owner');
select tests.eq((select count(*) from public.projects), 1::bigint, 'B owner sees only B projects');
select tests.eq((select count(*) from public.project_overview where company_id = tests.id('company_a')), 0::bigint, 'no A rows in overview');
select tests.eq((select count(*) from public.activities where project_id = tests.id('p1')), 0::bigint, 'no A activities');
select tests.eq((select count(*) from public.project_members where project_id = tests.id('p1')), 0::bigint, 'no A project members');
select tests.eq((select count(*) from public.calendars where project_id = tests.id('p1')), 0::bigint, 'no A calendars');
select tests.eq((select count(*) from public.companies where id = tests.id('company_a')), 0::bigint, 'no A company');
select tests.eq((select count(*) from public.company_members where company_id = tests.id('company_a')), 0::bigint, 'no A members');
select tests.eq((select count(*) from public.profiles where id = tests.uid('a_owner')), 0::bigint, 'no A profiles');
select tests.eq((select count(*) from public.activity_logs where company_id = tests.id('company_a')), 0::bigint, 'no A log rows');
select tests.eq((select count(*) from public.notifications where user_id <> tests.uid('b_owner')), 0::bigint, 'no foreign notifications');
select tests.expect_error(format('select public.update_project(%L, ''{"budget": 1}'', 1)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.set_project_status(%L, ''cancelled'', ''x'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.delete_project(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.restore_project(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "X"}'', 1)', tests.id('w1')), 'NOT_FOUND');
select tests.expect_error(format('select public.delete_activity(%L)', tests.id('w1')), 'NOT_FOUND');
select tests.expect_error(format('select public.move_activity(%L, null, 0)', tests.id('w1')), 'NOT_FOUND');
select tests.expect_error(format('select public.apply_schedule(%L, ''[]'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.save_calendar(%L, ''{1}'', true, 8, ''[]'', ''[]'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.invite_to_project(%L, ''z@example.com'', ''pm'')', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.add_project_member(%L, %L, ''pm'')', tests.id('p1'), tests.uid('b_owner')), 'NOT_FOUND');
select tests.expect_error(format('select public.remove_project_member(%L, %L)', tests.id('p1'), tests.uid('a_pm')), 'NOT_FOUND');
select tests.expect_error(format('select public.create_invite_code(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select * from public.activity_trash(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.expect_error(format('select public.remove_company_member(%L)', tests.uid('a_pm')), 'NOT_FOUND');
select tests.expect_error(format('select public.set_company_member_role(%L, ''inspector'')', tests.uid('a_pm')), 'NOT_FOUND');
-- cannot move B's activity under A's activity (cross-project)
select tests.set('bd', (public.create_activity(tests.id('pb'), null, 'Bravo Deliverable')).id::text);
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.id('bd'), tests.id('d1')), 'INVALID_MOVE');
select tests.expect_error(format('select public.create_activity(%L, %L, ''X'')', tests.id('pb'), tests.id('d1')), 'PARENT_NOT_FOUND');
-- direct table writes are blocked for clients
select tests.expect_sqlstate(format('insert into public.projects (company_id, name, start_date, end_date, budget) values (%L, ''Direct'', ''2026-01-01'', ''2026-02-01'', 1)',
                                    tests.id('company_b')), '42501');
select tests.expect_sqlstate(format('update public.projects set budget = 1 where id = %L', tests.id('pb')), '42501');
select tests.expect_sqlstate(format('update public.activities set name = ''x'' where id = %L', tests.id('bd')), '42501');
select tests.expect_sqlstate('delete from public.activity_logs', '42501');
select tests.expect_sqlstate('update public.activity_logs set summary = ''x''', '42501');
select tests.expect_sqlstate('insert into public.notifications (user_id, type, title) values (auth.uid(), ''x'', ''x'')', '42501');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Soft-deleted projects: owner-only (trash), hidden from members
-- ---------------------------------------------------------------------------
select tests.login('a_pm');
select tests.expect_error(format('select public.delete_project(%L)', tests.id('p2')), 'FORBIDDEN');
select tests.logout();
select tests.login('a_owner');
select public.delete_project(tests.id('p2'));
select tests.eq((select count(*) from public.project_overview), 1::bigint, 'deleted project leaves the overview');
select tests.eq((select count(*) from public.projects where id = tests.id('p2') and deleted_at is not null), 1::bigint, 'owner still sees the deleted row');
select tests.eq((select count(*) from public.project_trash()), 1::bigint, 'owner trash lists it');
select tests.logout();
select tests.login('a_pm');
select tests.eq((select count(*) from public.projects where id = tests.id('p2')), 0::bigint, 'member no longer sees the deleted project');
select tests.eq((select count(*) from public.project_members where project_id = tests.id('p2')), 0::bigint, 'nor its members');
select tests.eq((select count(*) from public.project_trash()), 0::bigint, 'PM trash is empty (owner only)');
select tests.expect_error(format('select public.restore_project(%L)', tests.id('p2')), 'NOT_FOUND');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Notifications are private
-- ---------------------------------------------------------------------------
select tests.login('a_pm');
select tests.set('notif', (select id::text from public.notifications where type = 'added_to_project' limit 1));
select tests.ok(tests.get('notif') is not null, 'pm received added_to_project');
select tests.logout();
select tests.login('a_owner');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('a_pm')), 0::bigint, 'owner cannot read the pm''s notifications');
select tests.eq(public.mark_notifications_read(array[tests.id('notif')]), 0, 'owner cannot mark them read');
select tests.logout();
select tests.login('a_pm');
select tests.eq(public.mark_notifications_read(array[tests.id('notif')]), 1, 'pm marks own notification read');
select tests.ok((select read_at is not null from public.notifications where id = tests.id('notif')), 'read_at set');
select tests.ok(public.mark_notifications_read() >= 1, 'mark all read');
select tests.eq((select count(*) from public.notifications where read_at is null), 0::bigint, 'nothing unread');
select tests.logout();

-- ---------------------------------------------------------------------------
-- activity_logs are append-only, even for postgres through plain SQL
-- ---------------------------------------------------------------------------
select tests.ok((select count(*) from public.activity_logs) > 5, 'log has rows');
select tests.expect_error('update public.activity_logs set summary = ''tampered''', 'LOG_IMMUTABLE');
select tests.expect_error(format('update public.activity_logs set actor_id = null where actor_id = %L', tests.uid('a_owner')), 'LOG_IMMUTABLE');
select tests.expect_error(format('update public.activity_logs set project_id = null where project_id = %L', tests.id('p1')), 'LOG_IMMUTABLE');
select tests.expect_error('delete from public.activity_logs', 'LOG_IMMUTABLE');
select tests.expect_error('truncate public.activity_logs', 'LOG_IMMUTABLE');
select tests.ok((select count(*) from public.activity_logs where summary = 'tampered') = 0, 'nothing changed');

select '03_isolation_rls: all assertions passed' as result;
rollback;
