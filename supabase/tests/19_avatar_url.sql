-- CivPMS database test 19_avatar_url: B-10, profiles.avatar_url allowlist
-- (migration 20261122100000_avatar_url_allowlist.sql). Only this project's avatars bucket (own
-- folder) or a Google photo host; enforced in update_profile, on direct updates and in the auth
-- metadata trigger. Everything runs in ONE transaction and is rolled back at the end.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <this file>
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
    json_build_object('sub', v.id, 'email', v.email, 'role', 'authenticated',
                      'iss', 'https://test-ref.supabase.co/auth/v1')::text, true);
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
-- Setup (as postgres)
-- ===========================================================================
select tests.new_user('a', 'avatar-a@b10.test', 'Ava');
select tests.new_user('b', 'avatar-b@b10.test', 'Ben');

-- Test JWT issuer (tests.login): https://test-ref.supabase.co/auth/v1
select tests.set('own', 'https://test-ref.supabase.co/storage/v1/object/public/avatars/' || tests.uid('a') || '/0b8f1e2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b.webp');
select tests.set('google', 'https://lh3.googleusercontent.com/a/ACg8ocL_test-Photo=s96-c');

-- ---------------------------------------------------------------------------
-- 1. Auth metadata (user-controlled) keeps Google photos only
-- ---------------------------------------------------------------------------
update auth.users set raw_user_meta_data = '{"avatar_url": "https://tracker.example/p.png"}' where id = tests.uid('a');
select tests.ok((select avatar_url is null from public.profiles where id = tests.uid('a')),
                'metadata update with an outside link is dropped');
update auth.users set raw_user_meta_data = jsonb_build_object('picture', tests.get('google')) where id = tests.uid('b');
select tests.eq((select avatar_url from public.profiles where id = tests.uid('b')), tests.get('google'),
                'Google photo from metadata is kept');

-- ---------------------------------------------------------------------------
-- 2. update_profile
-- ---------------------------------------------------------------------------
select tests.login('a');
select tests.eq((public.update_profile(jsonb_build_object('avatar_url', tests.get('own')))).avatar_url, tests.get('own'),
                'own bucket photo accepted');
select tests.eq((public.update_profile(jsonb_build_object('avatar_url', tests.get('google')))).avatar_url, tests.get('google'),
                'Google photo accepted');
select tests.ok((public.update_profile('{"avatar_url": null}')).avatar_url is null, 'clearing is allowed');
select tests.expect_error('select public.update_profile(''{"avatar_url": "https://tracker.example/p.png"}'')', 'VALIDATION');
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  'https://test-ref.supabase.co/storage/v1/object/public/avatars/' || tests.uid('b') || '/x.webp')), 'VALIDATION');
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  'https://other-ref.supabase.co/storage/v1/object/public/avatars/' || tests.uid('a') || '/x.webp')), 'VALIDATION');
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  'https://test-ref.supabase.co/storage/v1/object/public/avatars/' || tests.uid('a') || '/../x.webp')), 'VALIDATION');
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  'https://test-ref.supabase.co/storage/v1/object/public/project-media/' || tests.uid('a') || '/x.webp')), 'VALIDATION');
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  'https://lh3.googleusercontent.com.tracker.example/a/x')), 'VALIDATION');
select tests.eq(split_part(tests.error_of('select public.update_profile(''{"avatar_url": "https://tracker.example/p.png"}'')'), '|', 2),
                'Upload a photo instead of linking to one.', 'friendly message');

-- ---------------------------------------------------------------------------
-- 3. Direct updates (column grant) hit the table trigger
-- ---------------------------------------------------------------------------
select tests.expect_sqlstate(format('update public.profiles set avatar_url = ''https://tracker.example/p.png'' where id = %L', tests.uid('a')), '23514');
update public.profiles set avatar_url = tests.get('own') where id = tests.uid('a');
select tests.eq((select avatar_url from public.profiles where id = tests.uid('a')), tests.get('own'), 'own bucket photo via direct update');
-- unchanged value + other columns: no re-check
update public.profiles set full_name = 'Ava A.' where id = tests.uid('a');
select tests.logout();

-- Without an issuer claim the bucket rule fails closed (Google still works).
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('a'), 'role', 'authenticated')::text, true);
set local role authenticated;
select tests.expect_error(format('select public.update_profile(%L)', jsonb_build_object('avatar_url',
  replace(tests.get('own'), '0b8f1e2a', '1b8f1e2a'))), 'VALIDATION');
select tests.eq((public.update_profile(jsonb_build_object('avatar_url', tests.get('google')))).avatar_url, tests.get('google'),
                'Google photo without issuer');
select tests.logout();

-- Trusted callers (no user claims: migrations, seeds, service role) are not checked.
update public.profiles set avatar_url = 'https://seed.example/a.png' where id = tests.uid('b');
select tests.eq((select avatar_url from public.profiles where id = tests.uid('b')), 'https://seed.example/a.png', 'trusted write allowed');

-- ---------------------------------------------------------------------------
-- 4. Wording: "Log in" / "Log out"
-- ---------------------------------------------------------------------------
-- A request without a user id (expired or missing session).
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
set local role authenticated;
select tests.eq(split_part(tests.error_of('select public.update_profile(''{}'')'), '|', 2), 'Please log in to continue.', 'require_uid wording');
select tests.logout();

select '19_avatar_url: all assertions passed' as result;
rollback;
