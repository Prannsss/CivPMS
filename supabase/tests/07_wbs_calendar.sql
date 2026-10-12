-- CivPMS database test 07_wbs_calendar: WBS structure, moves, delete/restore, schedule and calendar
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
-- 07 · WBS: create/insert/renumber, move (depth + descendant guards),
--      delete/restore subtrees, STALE_VERSION, apply_schedule, save_calendar
-- ===========================================================================
select tests.new_user('owner', 'owner@example.com', 'Olive Owner');

-- WBS outline as "code name" in tree order
create function tests.outline(p_project uuid) returns text language sql stable as $$
  select string_agg(a.wbs_code || ' ' || a.name, ' | ' order by string_to_array(a.wbs_code, '.')::integer[])
    from public.activities a
   where a.project_id = p_project and a.deleted_at is null
$$;
grant execute on function tests.outline(uuid) to authenticated;
create function tests.act(p_project uuid, p_name text) returns uuid language sql stable as $$
  select a.id from public.activities a where a.project_id = p_project and a.name = p_name and a.deleted_at is null
$$;
grant execute on function tests.act(uuid, text) to authenticated;

select tests.login('owner');
select tests.set('company', (public.create_company('Acme Builders')).id::text);
select tests.set('p', (public.create_project('WBS Project', '2026-10-01', '2027-06-30', 1000000)).id::text);
select tests.set('other', (public.create_project('Other Project', '2026-10-01', '2027-06-30', 1000000)).id::text);

-- ---------------------------------------------------------------------------
-- create_activity: append, levels, codes, validation
-- ---------------------------------------------------------------------------
select public.create_activity(tests.id('p'), null, 'A');
select public.create_activity(tests.id('p'), null, 'B');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'A'), 'A1');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'A'), 'A2');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'A1'), 'A1a');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'A1'), 'A1b');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'B'), 'B1');
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A1 | 1.1.1 A1a | 1.1.2 A1b | 1.2 A2 | 2 B | 2.1 B1', 'initial outline');
select tests.eq((select level from public.activities where id = tests.act(tests.id('p'), 'A1a')), 3::smallint, 'work package level 3');
select tests.expect_error(format('select public.create_activity(%L, %L, ''Too deep'')', tests.id('p'), tests.act(tests.id('p'), 'A1a')), 'MAX_DEPTH_EXCEEDED');
select tests.expect_error(format('select public.create_activity(%L, %L, ''Wrong project'')', tests.id('other'), tests.act(tests.id('p'), 'A')), 'PARENT_NOT_FOUND');
select tests.expect_error(format('select public.create_activity(%L, null, ''   '')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', null, ''{"est_cost": -1}'')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', null, ''{"duration_hours": -8}'')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', null, ''{"start_date": "2026-10-10", "end_date": "2026-10-09"}'')', tests.id('p')), 'INVALID_DATES');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', null, ''{"start_date": "2026-02-30"}'')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', null, ''{"status": "completed"}'')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.create_activity(%L, null, ''X'', -1)', tests.id('p')), 'VALIDATION');
select tests.ok(exists (select 1 from public.activity_logs where activity_id = tests.act(tests.id('p'), 'A1b') and action = 'create'
                          and summary = 'Added 1.1.2 A1b' and wbs_code = '1.1.2'), 'create logged with its code');

-- insert at index 0 under A: siblings and their children renumber
select tests.set('v_a1a', (select version::text from public.activities where id = tests.act(tests.id('p'), 'A1a')));
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'A'), 'A0', 0);
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A0 | 1.2 A1 | 1.2.1 A1a | 1.2.2 A1b | 1.3 A2 | 2 B | 2.1 B1', 'insert at the top');
select tests.eq((select version from public.activities where id = tests.act(tests.id('p'), 'A1a')), tests.get('v_a1a')::integer,
                'renumbering does not bump versions');
select tests.eq((select count(*) from public.activity_logs where activity_id = tests.act(tests.id('p'), 'A1a')), 1::bigint,
                'renumbering is not logged per row');
select public.create_activity(tests.id('p'), null, 'C', 99);
select tests.eq((select wbs_code from public.activities where id = tests.act(tests.id('p'), 'C')), '3', 'index beyond the end appends');

-- ---------------------------------------------------------------------------
-- move_activity
-- ---------------------------------------------------------------------------
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A'), tests.act(tests.id('p'), 'A')), 'INVALID_MOVE');
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A'), tests.act(tests.id('p'), 'A1')), 'INVALID_MOVE');
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A'), tests.act(tests.id('p'), 'A1a')), 'INVALID_MOVE');
-- A (height 2) under B would need 4 levels
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A'), tests.act(tests.id('p'), 'B')), 'MAX_DEPTH_EXCEEDED');
-- A1 (height 1) under B1 (level 2) would need 4 levels
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A1'), tests.act(tests.id('p'), 'B1')), 'MAX_DEPTH_EXCEEDED');
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A2'), gen_random_uuid()), 'PARENT_NOT_FOUND');
-- A1 (with children) under B at index 0 → becomes 2.1, children 2.1.1/2.1.2
select tests.set('mv', public.move_activity(tests.act(tests.id('p'), 'A1'), tests.act(tests.id('p'), 'B'), 0)::text);
select tests.eq(tests.get('mv')::jsonb ->> 'old_wbs_code', '1.2', 'old code');
select tests.eq(tests.get('mv')::jsonb ->> 'new_wbs_code', '2.1', 'new code');
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A0 | 1.2 A2 | 2 B | 2.1 A1 | 2.1.1 A1a | 2.1.2 A1b | 2.2 B1 | 3 C', 'after re-parent');
select tests.eq((select count(*) from public.activity_logs where action = 'move'), 1::bigint, 'exactly one move entry');
select tests.ok(exists (select 1 from public.activity_logs where action = 'move' and summary = 'Moved A1 from 1.2 to 2.1'
                          and old_value ->> 'wbs_code' = '1.2' and new_value ->> 'wbs_code' = '2.1'), 'move entry content');
-- a leaf work package promoted to a top-level deliverable
select public.move_activity(tests.act(tests.id('p'), 'A1b'), null, 0);
select tests.eq(tests.outline(tests.id('p')), '1 A1b | 2 A | 2.1 A0 | 2.2 A2 | 3 B | 3.1 A1 | 3.1.1 A1a | 3.2 B1 | 4 C', 'promoted to level 1');
select tests.eq((select level from public.activities where id = tests.act(tests.id('p'), 'A1b')), 1::smallint, 'level recomputed');
-- reorder within the same parent (B1 to the front of B), and a no-op move
select public.move_activity(tests.act(tests.id('p'), 'B1'), tests.act(tests.id('p'), 'B'), 0);
select tests.eq(tests.outline(tests.id('p')), '1 A1b | 2 A | 2.1 A0 | 2.2 A2 | 3 B | 3.1 B1 | 3.2 A1 | 3.2.1 A1a | 4 C', 'reordered');
select tests.eq((public.move_activity(tests.act(tests.id('p'), 'B1'), tests.act(tests.id('p'), 'B'), 0) ->> 'changed')::boolean, false, 'no-op move');
select tests.eq((select count(*) from public.activity_logs where action = 'move'), 3::bigint, 'no-op is not logged');
-- move a deliverable to the end (NULL index = append)
select public.move_activity(tests.act(tests.id('p'), 'A1b'), null, null);
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A0 | 1.2 A2 | 2 B | 2.1 B1 | 2.2 A1 | 2.2.1 A1a | 3 C | 4 A1b', 'appended');

-- ---------------------------------------------------------------------------
-- update_activity + STALE_VERSION
-- ---------------------------------------------------------------------------
select tests.set('a2', tests.act(tests.id('p'), 'A2')::text);
select tests.set('a2v', (select version::text from public.activities where id = tests.id('a2')));
select tests.set('a2row', row_to_json(public.update_activity(tests.id('a2'),
  '{"est_cost": 125000.5, "duration_hours": 12, "start_date": "2026-10-05", "end_date": "2026-10-06", "description": "Pour slab"}',
  tests.get('a2v')::integer))::text);
select tests.eq((tests.get('a2row')::jsonb ->> 'version')::integer, tests.get('a2v')::integer + 1, 'version bumped once');
select tests.expect_error(format('select public.update_activity(%L, ''{"est_cost": 1}'', %s)', tests.id('a2'), tests.get('a2v')), 'STALE_VERSION');
select tests.expect_error(format('select public.update_activity(%L, ''{"percent": 50}'', %s)', tests.id('a2'), (tests.get('a2row')::jsonb ->> 'version')), 'VALIDATION');
select tests.expect_error(format('select public.update_activity(%L, ''{"end_date": "2026-10-01"}'', %s)', tests.id('a2'), (tests.get('a2row')::jsonb ->> 'version')), 'INVALID_DATES');
select tests.expect_error(format('select public.update_activity(%L, ''{"est_cost": 1.234}'', %s)', tests.id('a2'), (tests.get('a2row')::jsonb ->> 'version')), 'VALIDATION');
select tests.ok(exists (select 1 from public.activity_logs where activity_id = tests.id('a2') and field = 'est_cost'
                          and summary = 'Estimated cost: — → ₱125,000.50' and wbs_code = '1.2' and activity_name = 'A2'), 'cost change logged');
select tests.ok(exists (select 1 from public.activity_logs where activity_id = tests.id('a2') and field = 'duration_hours'
                          and summary = 'Duration: — → 12 h'), 'duration change logged');

-- ---------------------------------------------------------------------------
-- delete_activity / restore_activity
-- ---------------------------------------------------------------------------
-- outline: 1 A | 1.1 A0 | 1.2 A2 | 2 B | 2.1 B1 | 2.2 A1 | 2.2.1 A1a | 3 C | 4 A1b
select tests.set('delB', public.delete_activity(tests.act(tests.id('p'), 'B'))::text);
select tests.eq((tests.get('delB')::jsonb ->> 'total')::integer, 4, 'B + 3 descendants');
select tests.eq(tests.get('delB')::jsonb -> 'counts', '{"deliverables": 1, "sub_deliverables": 2, "work_packages": 1}'::jsonb, 'counts by level');
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A0 | 1.2 A2 | 2 C | 3 A1b', 'renumbered after delete');
select tests.eq((select total from public.activity_trash(tests.id('p')) where batch_id = (tests.get('delB')::jsonb ->> 'batch_id')::uuid), 4,
                'the subtree is one trash batch');
select tests.ok(exists (select 1 from public.activity_logs where action = 'delete' and summary = 'Deleted 2 B and 3 activities under it'), 'one delete entry');

-- a child and then its parent: two batches; the child cannot come back first
select tests.set('delA0', public.delete_activity(tests.act(tests.id('p'), 'A0'))::text);
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A2 | 2 C | 3 A1b', 'child deleted');
select tests.set('delA', public.delete_activity(tests.act(tests.id('p'), 'A'))::text);
select tests.eq((tests.get('delA')::jsonb ->> 'total')::integer, 2, 'A + its remaining child');
select tests.eq(tests.outline(tests.id('p')), '1 C | 2 A1b', 'after parent delete');
select tests.eq((select count(*) from public.activity_trash(tests.id('p'))), 3::bigint, 'three batches in the trash');
select tests.eq((select total from public.activity_trash(tests.id('p')) where name = 'B'), 4, 'trash shows batch size');
select tests.ok((select parent_deleted from public.activity_trash(tests.id('p')) where name = 'A0'), 'trash flags a deleted parent');
select tests.expect_error(format('select public.restore_activity(%L)', tests.get('delA0')::jsonb ->> 'batch_id'), 'PARENT_DELETED');
-- restore in order: everything returns to its original position and code
select public.restore_activity((tests.get('delA')::jsonb ->> 'batch_id')::uuid);
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A2 | 2 C | 3 A1b', 'A back at position 1');
select public.restore_activity((tests.get('delA0')::jsonb ->> 'batch_id')::uuid);
select public.restore_activity((tests.get('delB')::jsonb ->> 'batch_id')::uuid);
select tests.eq(tests.outline(tests.id('p')), '1 A | 1.1 A0 | 1.2 A2 | 2 B | 2.1 B1 | 2.2 A1 | 2.2.1 A1a | 3 C | 4 A1b',
                'fully restored with the same codes as before');
select tests.expect_error(format('select public.restore_activity(%L)', tests.get('delB')::jsonb ->> 'batch_id'), 'NOT_FOUND');
select tests.eq((select count(*) from public.activity_trash(tests.id('p'))), 0::bigint, 'trash empty');
select tests.ok(exists (select 1 from public.activity_logs where action = 'restore'
                          and summary = 'Restored 2 B and 3 activities under it from the trash'), 'one restore entry');

-- deleted activities are hidden and cannot be edited or used as parents
select tests.set('delC', public.delete_activity(tests.act(tests.id('p'), 'C'))::text);
select tests.eq((select count(*) from public.activities where id = (tests.get('delC')::jsonb ->> 'activity_id')::uuid), 0::bigint, 'hidden by RLS');
select tests.expect_error(format('select public.update_activity(%L, ''{"name": "x"}'', 1)', tests.get('delC')::jsonb ->> 'activity_id'), 'NOT_FOUND');
select tests.expect_error(format('select public.delete_activity(%L)', tests.get('delC')::jsonb ->> 'activity_id'), 'NOT_FOUND');
select tests.expect_error(format('select public.create_activity(%L, %L, ''Orphan'')', tests.id('p'), tests.get('delC')::jsonb ->> 'activity_id'), 'PARENT_NOT_FOUND');
select tests.expect_error(format('select public.move_activity(%L, %L, 0)', tests.act(tests.id('p'), 'A2'), tests.get('delC')::jsonb ->> 'activity_id'), 'PARENT_NOT_FOUND');
select tests.logout();
-- older than 30 days: no longer restorable
update public.activities set deleted_at = now() - interval '31 days'
 where deleted_batch = (tests.get('delC')::jsonb ->> 'batch_id')::uuid;
select tests.login('owner');
select tests.expect_error(format('select public.restore_activity(%L)', tests.get('delC')::jsonb ->> 'batch_id'), 'RESTORE_EXPIRED');
select tests.eq((select count(*) from public.activity_trash(tests.id('p'))), 0::bigint, 'expired batches leave the trash');

-- restoring under a parent that moved deeper would exceed 3 levels
select public.create_activity(tests.id('p'), null, 'X');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'X'), 'Y');
select public.create_activity(tests.id('p'), tests.act(tests.id('p'), 'Y'), 'Z');
select tests.set('delY', public.delete_activity(tests.act(tests.id('p'), 'Y'))::text);
select public.move_activity(tests.act(tests.id('p'), 'X'), tests.act(tests.id('p'), 'A1b'), 0);
select tests.expect_error(format('select public.restore_activity(%L)', tests.get('delY')::jsonb ->> 'batch_id'), 'MAX_DEPTH_EXCEEDED');

-- ---------------------------------------------------------------------------
-- apply_schedule
-- ---------------------------------------------------------------------------
select tests.set('o1', (public.create_activity(tests.id('other'), null, 'Other A')).id::text);
select tests.eq(public.apply_schedule(tests.id('p'), jsonb_build_array(
  jsonb_build_object('id', tests.act(tests.id('p'), 'A0'), 'start_date', '2026-11-02', 'duration_hours', 16, 'end_date', '2026-11-03'),
  jsonb_build_object('id', tests.act(tests.id('p'), 'A2'), 'start_date', '2026-10-05', 'duration_hours', 12, 'end_date', '2026-10-06'),
  jsonb_build_object('id', tests.act(tests.id('p'), 'B1'), 'end_date', null))), 1, 'only rows that really change are written');
select tests.ok(exists (select 1 from public.activity_logs where activity_id = tests.act(tests.id('p'), 'A0')
                          and field = 'start_date' and via = 'schedule'), 'logged via schedule');
select tests.expect_error(format('select public.apply_schedule(%L, %L)', tests.id('p'),
  jsonb_build_array(jsonb_build_object('id', tests.act(tests.id('p'), 'A2'), 'start_date', '2026-12-01', 'end_date', '2026-12-01'),
                    jsonb_build_object('id', tests.id('o1'), 'start_date', '2026-12-01'))), 'VALIDATION');
select tests.eq((select start_date from public.activities where id = tests.act(tests.id('p'), 'A2')), '2026-10-05'::date, 'a rejected batch changes nothing');
select tests.expect_error(format('select public.apply_schedule(%L, %L)', tests.id('p'),
  jsonb_build_array(jsonb_build_object('id', tests.act(tests.id('p'), 'A0'), 'end_date', '2026-10-01'))), 'INVALID_DATES');
select tests.expect_error(format('select public.apply_schedule(%L, ''[{"id": "%s", "est_cost": 5}]'')', tests.id('p'), tests.act(tests.id('p'), 'A0')), 'VALIDATION');
select tests.expect_error(format('select public.apply_schedule(%L, ''{}'')', tests.id('p')), 'VALIDATION');

-- ---------------------------------------------------------------------------
-- save_calendar (settings + full date list + reschedule, atomically)
-- ---------------------------------------------------------------------------
select tests.expect_error(format('select public.save_calendar(%L, ''{}'', true, 8, ''[]'')', tests.id('p')), 'NO_WORKING_DAYS');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 0, ''[]'')', tests.id('p')), 'VALIDATION');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, %L)', tests.id('p'),
  '[{"date": "2026-12-26", "kind": "override_nonworking"}, {"date": "2026-12-26", "kind": "override_working"}]'), 'VALIDATION');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, %L)', tests.id('p'),
  '[{"date": "2026-12-26", "kind": "holiday"}, {"date": "2026-12-26", "kind": "holiday"}]'), 'VALIDATION');
select tests.expect_error(format('select public.save_calendar(%L, ''{1,2,3,4,5}'', true, 8, %L)', tests.id('p'),
  '[{"date": "2026-12-26", "kind": "vacation"}]'), 'VALIDATION');

select tests.set('cal', public.save_calendar(tests.id('p'), '{1,2,3,4,5,6}', false, 9,
  (select jsonb_agg(jsonb_build_object('date', cd.date, 'kind', cd.kind,
            'name', case when cd.date = '2026-12-24' then 'Christmas Eve (half day)' else cd.name end))
     from public.calendar_dates cd where cd.project_id = tests.id('p') and cd.date <> '2026-12-25')
  || '[{"date": "2026-12-26", "kind": "override_nonworking", "name": "Year-end shutdown"}]'::jsonb,
  jsonb_build_array(jsonb_build_object('id', tests.act(tests.id('p'), 'A0'), 'end_date', '2026-11-04')))::text);
select tests.eq((tests.get('cal')::jsonb ->> 'dates_removed')::integer, 1, 'one holiday removed');
select tests.eq((tests.get('cal')::jsonb ->> 'dates_added')::integer, 1, 'one override added');
select tests.eq((tests.get('cal')::jsonb ->> 'dates_updated')::integer, 1, 'one note changed');
select tests.eq((tests.get('cal')::jsonb ->> 'activities_rescheduled')::integer, 1, 'activity rescheduled in the same transaction');
select tests.eq(tests.get('cal')::jsonb -> 'calendar' -> 'work_days', '[1, 2, 3, 4, 5, 6]'::jsonb, 'work days saved');
select tests.eq((select hours_per_day from public.calendars where project_id = tests.id('p')), 9.00, 'hours per day saved');
select tests.eq((select count(*) from public.calendar_dates where project_id = tests.id('p')), 38::bigint, '37 holidays + 1 override');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p') and entity_type = 'calendar_date'
                          and action = 'delete' and via = 'calendar' and summary = 'Removed holiday 25 Dec 2026 (Christmas Day)'), 'holiday removal logged');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p') and entity_type = 'calendar_date'
                          and summary = 'Marked 26 Dec 2026 as a non-working day (Year-end shutdown)'), 'override logged');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p') and entity_type = 'calendar'
                          and summary = 'Working days: Mon, Tue, Wed, Thu, Fri → Mon, Tue, Wed, Thu, Fri, Sat'), 'settings change logged');
select tests.ok(exists (select 1 from public.activity_logs where activity_id = tests.act(tests.id('p'), 'A0')
                          and field = 'end_date' and via = 'calendar'), 'reschedule logged via calendar');
-- saving the same calendar again writes nothing
select tests.set('n_logs', (select count(*)::text from public.activity_logs where project_id = tests.id('p')));
select tests.set('cal2', public.save_calendar(tests.id('p'), '{6,5,4,3,2,1}', false, 9,
  (select jsonb_agg(jsonb_build_object('date', cd.date, 'kind', cd.kind, 'name', cd.name))
     from public.calendar_dates cd where cd.project_id = tests.id('p')), '[]')::text);
select tests.eq((tests.get('cal2')::jsonb ->> 'dates_added')::integer + (tests.get('cal2')::jsonb ->> 'dates_removed')::integer
                + (tests.get('cal2')::jsonb ->> 'dates_updated')::integer, 0, 'no date changes');
select tests.eq((select count(*) from public.activity_logs where project_id = tests.id('p')), tests.get('n_logs')::bigint, 'no new log rows');
-- flip the override on the same date from non-working to working
select tests.set('cal3', public.save_calendar(tests.id('p'), '{1,2,3,4,5,6}', false, 9,
  (select jsonb_agg(jsonb_build_object('date', cd.date, 'kind', case when cd.kind = 'override_nonworking' then 'override_working' else cd.kind::text end, 'name', cd.name))
     from public.calendar_dates cd where cd.project_id = tests.id('p')), null)::text);
select tests.eq((select kind::text from public.calendar_dates where project_id = tests.id('p') and date = '2026-12-26'), 'override_working', 'override flipped');
select tests.logout();

select '07_wbs_calendar: all assertions passed' as result;
rollback;
