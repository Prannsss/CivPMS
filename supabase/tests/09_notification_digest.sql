-- CivPMS database test 09_notification_digest: daily email digest preference and job
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
-- 09 · email digest
-- ===========================================================================
select tests.new_user('ana', 'ana.digest@example.test', 'Ana Digest');
select tests.new_user('ben', 'ben.digest@example.test', 'Ben Instant');

-- Preference validation and storage
select tests.login('ana');
select tests.expect_error($q$select public.update_notification_prefs('{"email_digest": "weekly"}')$q$, 'VALIDATION');
select tests.expect_error($q$select public.update_notification_prefs('{"email_digest": true}')$q$, 'VALIDATION');
select tests.expect_error($q$select public.update_notification_prefs('{"unknown_type": {"email": true}}')$q$, 'VALIDATION');
select tests.eq(public.update_notification_prefs('{"email_digest": "daily", "project_delayed": {"in_app": true}}') ->> 'email_digest',
                'daily', 'digest stored as a top-level key');
select tests.eq((select notification_prefs -> 'project_delayed' ->> 'in_app' from public.profiles where id = tests.uid('ana')),
                'true', 'per-type keys still merge alongside the digest');
select tests.expect_sqlstate('select private.send_email_digests()', '42501');
select tests.logout();

-- private.notify holds emails while the digest is on; in-app rows are unaffected
select private.notify(tests.uid('ana'), 'project_delayed', '[T09] Tower A is delayed', 'body', '/');
select private.notify(tests.uid('ana'), 'project_budget_exceeded', '[T09] Tower A is over budget', 'body', '/');
select private.notify(tests.uid('ana'), 'project_status_changed', '[T09] Tower A is now Active', 'body', '/');
select private.notify(tests.uid('ben'), 'project_delayed', '[T09] Ben delayed', 'body', '/');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('ana') and email_status = 'digest'),
                2::bigint, 'emailed types are held for the digest');
select tests.ok((select in_app and read_at is null from public.notifications
                  where user_id = tests.uid('ana') and title = '[T09] Tower A is delayed'), 'in-app copy still unread in the bell');
select tests.eq((select email_status from public.notifications where user_id = tests.uid('ana') and title = '[T09] Tower A is now Active'),
                'skipped', 'types without email stay skipped');
select tests.eq((select email_status from public.notifications where user_id = tests.uid('ben')),
                'pending', 'people without the digest are emailed right away');

-- The job queues ONE email per person and releases nothing else
select tests.ok(private.send_email_digests() >= 1, 'job queues at least one digest');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('ana') and email_status = 'digested'),
                2::bigint, 'held rows are marked digested');
select tests.ok((select count(*) = 1 and bool_and(not in_app) and bool_and(read_at is not null) and bool_and(email_status = 'pending')
                   and bool_and(title = 'Your CivPMS daily summary: 2 updates') and bool_and(body like '%• [T09] Tower A is delayed%')
                   and bool_and(link = '/notifications')
                   from public.notifications where user_id = tests.uid('ana') and type = 'email_digest'),
                'one email-only digest row is queued for the outbox');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('ben') and type = 'email_digest'),
                0::bigint, 'no digest for people without held emails');
select tests.ok(private.send_email_digests() >= 0, 'running again is harmless');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('ana') and type = 'email_digest'),
                1::bigint, 'nothing is sent twice');

-- The digest row is not visible in the bell (in_app = false)
select tests.login('ana');
select tests.eq((select count(*) from public.notifications where type = 'email_digest'), 0::bigint, 'digest row hidden from the bell');
select tests.logout();

-- Turning the digest off releases anything still held
select private.notify(tests.uid('ana'), 'project_delayed', '[T09] Tower B is delayed', 'body', '/');
select tests.eq((select email_status from public.notifications where title = '[T09] Tower B is delayed'), 'digest', 'held again');
select tests.login('ana');
select tests.eq(public.update_notification_prefs('{"email_digest": "off"}') ->> 'email_digest', 'off', 'digest turned off');
select tests.logout();
select tests.eq((select email_status from public.notifications where title = '[T09] Tower B is delayed'), 'pending',
                'held email released to the outbox');

select '09_notification_digest: all assertions passed' as result;
rollback;
