-- CivPMS database test 01_privileges: privileges, RLS coverage, function hardening
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
-- 01 · Privileges, RLS coverage and function hardening (catalog checks)
-- ===========================================================================

-- RLS is enabled on every table in public.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
), 'every public table has RLS enabled');

-- anon has no privilege on any public table or view.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
), 'anon has no table privileges in public');

-- authenticated cannot write any table directly, except the column-limited profile update.
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'DELETE')
          or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          or (has_table_privilege('authenticated', c.oid, 'UPDATE') and c.relname <> 'profiles'))
), 'authenticated has no direct write privileges (except profile columns)');
select tests.ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
                and not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
                and not has_column_privilege('authenticated', 'public.profiles', 'onboarded_at', 'UPDATE')
                and not has_column_privilege('authenticated', 'public.profiles', 'role_pref', 'UPDATE'),
                'profiles: only full_name/avatar_url/duration_unit are client-updatable');
select tests.ok(not has_table_privilege('authenticated', 'public.invite_code_attempts', 'SELECT'),
                'invite_code_attempts is not readable by clients');

-- anon may execute exactly one public function: get_invitation_by_token.
select tests.eq(
  (select string_agg(p.proname, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'get_invitation_by_token',
  'anon-executable public functions');

-- service-role-only RPCs.
select tests.ok(not has_function_privilege('authenticated', 'public.claim_email_batch(integer)', 'EXECUTE'), 'claim_email_batch not for authenticated');
select tests.ok(not has_function_privilege('authenticated', 'public.complete_email(uuid, text, text)', 'EXECUTE'), 'complete_email not for authenticated');
select tests.ok(not has_function_privilege('authenticated', 'public.run_daily_checks()', 'EXECUTE'), 'run_daily_checks not for authenticated');
select tests.ok(has_function_privilege('service_role', 'public.claim_email_batch(integer)', 'EXECUTE'), 'claim_email_batch for service_role');
select tests.ok(has_function_privilege('service_role', 'public.run_daily_checks()', 'EXECUTE'), 'run_daily_checks for service_role');

-- Every other public RPC is executable by authenticated.
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('claim_email_batch', 'complete_email', 'run_daily_checks')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
), 'authenticated can execute the client RPCs');

-- private schema: no usage for anon, nothing executable by anon/public.
select tests.ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no usage on private');
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE')
), 'no private function is executable by anon');
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proacl is null
), 'private functions never fall back to default (PUBLIC) execute');

-- SECURITY DEFINER functions all pin search_path = ''.
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not coalesce(p.proconfig @> array['search_path=""'], false)
), 'every SECURITY DEFINER function sets search_path to empty');
-- ...and so do all other functions we own in public/private.
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and not coalesce(p.proconfig @> array['search_path=""'], false)
), 'every public/private function sets search_path');

-- project_overview is security_invoker.
select tests.ok((select coalesce(c.reloptions @> array['security_invoker=true'], false)
                   from pg_class c where c.oid = 'public.project_overview'::regclass),
                'project_overview is security_invoker');

-- notifications are in the realtime publication.
select tests.ok(exists (select 1 from pg_publication_tables
                         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
                'notifications are published to realtime');

-- daily job is scheduled at 16:05 UTC.
select tests.ok(exists (select 1 from cron.job where jobname = 'civpms-daily-checks'
                          and schedule = '5 16 * * *' and command = 'select private.run_daily_checks()'),
                'pg_cron job scheduled');

-- avatars bucket.
select tests.ok(exists (select 1 from storage.buckets where id = 'avatars' and public
                          and file_size_limit = 2097152
                          and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']),
                'avatars bucket configured');

-- PH holidays seeded for 2026 and 2027.
select tests.eq((select count(*) from public.ph_holidays where year = 2026), 20::bigint, '2026 holidays');
select tests.eq((select count(*) from public.ph_holidays where year = 2027), 18::bigint, '2027 holidays');

-- ---------------------------------------------------------------------------
-- Live checks as anon
-- ---------------------------------------------------------------------------
select tests.login_anon();
select tests.expect_sqlstate('select public.notification_catalog()', '42501');
select tests.expect_sqlstate('select public.create_company(''X Corp'')', '42501');
select tests.expect_sqlstate('select public.my_pending_invitations()', '42501');
select tests.expect_sqlstate('select * from public.projects', '42501');
select tests.expect_sqlstate('select * from public.project_overview', '42501');
select tests.expect_sqlstate('select * from public.ph_holidays', '42501');
-- the one anon RPC answers (NOT_FOUND for an unknown token)
select tests.expect_error('select public.get_invitation_by_token(repeat(''a'', 64))', 'NOT_FOUND');
select tests.logout();

-- Authenticated without a session-user row: RPCs need a signed-in user.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select tests.expect_error('select public.create_company(''Ghost Co'')', 'UNAUTHENTICATED');
select tests.logout();

select '01_privileges: all assertions passed' as result;
rollback;
