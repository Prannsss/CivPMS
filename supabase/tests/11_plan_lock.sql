-- CivPMS database test 11_plan_lock: completed / cancelled projects refuse WBS and calendar edits
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
-- 11 · Plan lock: every WBS / calendar RPC refuses a Completed or Cancelled
--      project (FORBIDDEN, after the permission check); reopening unlocks it
-- ===========================================================================
select tests.new_user('owner', 'owner@example.com', 'Olive Owner');
select tests.new_user('outsider', 'outsider@example.com', 'Oscar Outsider');

select tests.login('owner');
select public.create_company('Lock Builders');
select tests.set('p', (public.create_project('Locked Bridge', '2026-10-05', '2027-03-31', 1000000)).id::text);
select tests.set('d', (public.create_activity(tests.id('p'), null, 'Deliverable')).id::text);
select tests.set('w', (public.create_activity(tests.id('p'), tests.id('d'), 'Work package', null,
                        '{"est_cost": 250000, "duration_hours": 16, "start_date": "2026-10-05", "end_date": "2026-10-06"}')).id::text);
select tests.set('gone', (public.create_activity(tests.id('p'), tests.id('d'), 'Deleted package')).id::text);
select tests.set('batch', (public.delete_activity(tests.id('gone')) ->> 'batch_id'));
select public.set_project_status(tests.id('p'), 'active');
select tests.logout();

-- every activity done (progress updates are Phase 3) → the PM completes the project
update public.activities set status = 'completed', percent = 100 where project_id = tests.id('p');
select tests.login('owner');
select tests.eq((public.set_project_status(tests.id('p'), 'completed')).status::text, 'completed', 'project completed');
select tests.set('n_acts', (select count(*)::text from public.activities where project_id = tests.id('p')));
select tests.set('v_w', (select version::text from public.activities where id = tests.id('w')));

-- completed: every plan edit is refused with the plain-language reason
select tests.ok(tests.error_of(format('select public.create_activity(%L, null, ''New'')', tests.id('p')))
                  like 'FORBIDDEN|This project is completed, so its plan is locked.%', 'create_activity refused with the reason');
select tests.expect_error(format('select public.create_activity(%L, %L, ''Child'')', tests.id('p'), tests.id('d')), 'FORBIDDEN');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "Renamed"}'', %s)', tests.id('w'), tests.get('v_w')), 'FORBIDDEN');
select tests.expect_error(format('select public.update_activity(%L, ''{"est_cost": 1}'', %s)', tests.id('w'), tests.get('v_w')), 'FORBIDDEN');
select tests.expect_error(format('select public.move_activity(%L, null, 0)', tests.id('w')), 'FORBIDDEN');
select tests.expect_error(format('select public.delete_activity(%L)', tests.id('w')), 'FORBIDDEN');
select tests.expect_error(format('select public.restore_activity(%L)', tests.id('batch')), 'FORBIDDEN');
select tests.expect_error(format('select public.apply_schedule(%L, ''[]'')', tests.id('p')), 'FORBIDDEN');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, ''[]'', ''[]'')', tests.id('p')), 'FORBIDDEN');
select tests.eq((select count(*)::text from public.activities where project_id = tests.id('p')), tests.get('n_acts'), 'no activity added');
select tests.ok((select name = 'Work package' and est_cost = 250000 and parent_id = tests.id('d') and deleted_at is null
                   and version = tests.get('v_w')::integer
                   from public.activities where id = tests.id('w')), 'work package untouched');
-- reads and project-level actions still work (activities RLS hides deleted rows: read the trash)
select tests.ok(exists (select 1 from public.activity_trash(tests.id('p')) t where t.batch_id = tests.id('batch')),
                'trash untouched and still readable');
select tests.eq((public.set_project_archived(tests.id('p'), true)).is_archived, true, 'completed project can be archived');
select tests.logout();

-- people without access learn nothing new: NOT_FOUND comes before the lock
select tests.login('outsider');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'')', tests.id('p')), 'NOT_FOUND');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "X"}'', 1)', tests.id('w')), 'NOT_FOUND');
select tests.expect_error(format('select public.save_calendar(%L, ''{1}'', true, 8, ''[]'', ''[]'')', tests.id('p')), 'NOT_FOUND');
select tests.logout();

-- reopening (Completed → Active) unlocks the plan
select tests.login('owner');
select tests.eq((public.set_project_status(tests.id('p'), 'active')).status::text, 'active', 'reopened');
select tests.eq((public.update_activity(tests.id('w'), '{"name": "Renamed"}', tests.get('v_w')::integer)).name, 'Renamed', 'edit allowed again');
select tests.eq((public.restore_activity(tests.id('batch')) ->> 'total')::integer, 1, 'restore allowed again');
select tests.ok((public.create_activity(tests.id('p'), null, 'After reopen')).id is not null, 'create allowed again');
select tests.ok(public.save_calendar(tests.id('p'), '{1,2,3,4,5}', true, 8, '[]', '[]') is not null, 'calendar save allowed again');

-- cancelled is final: the plan stays locked
select tests.set('c', (public.create_project('Cancelled Seawall', '2026-10-05', '2027-03-31', 500000)).id::text);
select tests.set('cw', (public.create_activity(tests.id('c'), null, 'Seawall works')).id::text);
select public.set_project_status(tests.id('c'), 'active');
select tests.eq((public.set_project_status(tests.id('c'), 'cancelled', 'Client withdrew')).status::text, 'cancelled', 'cancelled');
select tests.ok(tests.error_of(format('select public.create_activity(%L, null, ''New'')', tests.id('c')))
                  like 'FORBIDDEN|This project is cancelled, so its plan can''t be changed.%', 'cancelled: refused with the reason');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "X"}'', 1)', tests.id('cw')), 'FORBIDDEN');
select tests.expect_error(format('select public.delete_activity(%L)', tests.id('cw')), 'FORBIDDEN');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, ''[]'', ''[]'')', tests.id('c')), 'FORBIDDEN');
select tests.logout();

select '11_plan_lock: all assertions passed' as result;
rollback;
