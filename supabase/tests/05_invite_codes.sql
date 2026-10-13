-- CivPMS database test 05_invite_codes: inspector invite codes and rate limiting
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
-- 05 · Inspector invite codes (D11): create, normalise, redeem, revoke,
--      expiry, usage limit, rate limiting
-- ===========================================================================
select tests.new_user('a_owner', 'a.owner@example.com', 'Alice Owner');
select tests.new_user('a_pm', 'a.pm@example.com', 'Arthur PM');
select tests.new_user('a_pm2', 'a.pm2@example.com', 'Amy Other PM');
select tests.new_user('a_insp', 'a.insp@example.com', 'Andy Inspector');
select tests.new_user('b_owner', 'b.owner@example.com', 'Bob Owner');
select tests.new_user('i1', 'ines@example.com', 'Ines Inspector');
select tests.new_user('i2', 'ivan@example.com', 'Ivan Inspector');
select tests.new_user('i3', 'iris@example.com', 'Iris Inspector');

select tests.login('b_owner');
select tests.set('company_b', (public.create_company('Bravo Builders')).id::text);
select tests.logout();
select tests.login('a_owner');
select tests.set('company_a', (public.create_company('Alpha Construction')).id::text);
select tests.set('p1', (public.create_project('Alpha Tower', '2026-10-01', '2027-06-30', 5000000)).id::text);
select tests.logout();
insert into public.company_members (company_id, user_id, role) values
  (tests.id('company_a'), tests.uid('a_pm'), 'pm'),
  (tests.id('company_a'), tests.uid('a_pm2'), 'pm'),
  (tests.id('company_a'), tests.uid('a_insp'), 'inspector');
select tests.login('a_owner');
select public.add_project_member(tests.id('p1'), tests.uid('a_pm'), 'pm');
select public.add_project_member(tests.id('p1'), tests.uid('a_insp'), 'inspector');

-- company-wide code by the Owner PM
select tests.set('code_c', (public.create_invite_code()).id::text);
select tests.ok((select code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' and project_id is null and role = 'inspector'
                   from public.invite_codes where id = tests.id('code_c')), 'format XXXX-XXXX, Crockford alphabet, company-wide');
select tests.expect_error('select public.create_invite_code(null, 0)', 'VALIDATION');
select tests.expect_error('select public.create_invite_code(null, null, 0)', 'VALIDATION');
select tests.logout();

-- project code by a project PM; non-member PM / inspector cannot
select tests.login('a_pm');
select tests.set('code_p', (public.create_invite_code(tests.id('p1'), 7, 5)).id::text);
select tests.ok((select expires_at > now() + interval '6 days' and max_uses = 5 from public.invite_codes where id = tests.id('code_p')),
                'expiry and max uses stored');
select tests.eq((select count(*) from public.invite_codes), 2::bigint, 'project PM sees company-wide + project codes');
select tests.logout();
select tests.login('a_pm2');
select tests.expect_error(format('select public.create_invite_code(%L)', tests.id('p1')), 'NOT_FOUND');
select tests.eq((select count(*) from public.invite_codes), 1::bigint, 'non-member PM sees only company-wide codes');
select tests.set('code_c2', (public.create_invite_code()).id::text);
select tests.logout();
select tests.login('a_insp');
select tests.expect_error('select public.create_invite_code()', 'FORBIDDEN');
select tests.expect_error(format('select public.revoke_invite_code(%L)', tests.id('code_c')), 'FORBIDDEN');
select tests.logout();
select tests.login('b_owner');
select tests.eq((select count(*) from public.invite_codes), 0::bigint, 'other company sees no codes');
select tests.expect_error(format('select public.revoke_invite_code(%L)', tests.id('code_c')), 'NOT_FOUND');
select tests.logout();

-- fixed, known codes for normalisation tests (set up as postgres)
insert into public.invite_codes (company_id, project_id, code, created_by) values
  (tests.id('company_a'), null, '0K1M-2345', tests.uid('a_owner'));
insert into public.invite_codes (company_id, project_id, code, max_uses, created_by) values
  (tests.id('company_a'), tests.id('p1'), 'P1AB-CDEF', 1, tests.uid('a_pm'));
insert into public.invite_codes (company_id, project_id, code, expires_at, created_by) values
  (tests.id('company_a'), null, 'EXP1-RED0', now() - interval '1 minute', tests.uid('a_owner'));

-- ---------------------------------------------------------------------------
-- Preview + redeem
-- ---------------------------------------------------------------------------
select tests.login('i1');
-- normalisation: lowercase, spaces, missing dash, O→0, I/L→1
select tests.eq(public.preview_invite_code(' ok1m 2345 ') ->> 'code', '0K1M-2345', 'O→0, spaces stripped, dash re-inserted');
select tests.eq(public.preview_invite_code('oKlm-2345') ->> 'code', '0K1M-2345', 'L→1');
select tests.eq(public.preview_invite_code('OKIM2345') ->> 'code', '0K1M-2345', 'I→1');
select tests.eq((public.preview_invite_code('0K1M-2345') ->> 'valid')::boolean, true, 'valid');
select tests.eq(public.preview_invite_code('0K1M-2345') ->> 'company_name', 'Alpha Construction', 'preview shows company');
select tests.ok(public.preview_invite_code('0K1M-2345') -> 'project_name' = 'null'::jsonb, 'company-wide code has no project');
select tests.eq(public.preview_invite_code('ZZZZ-ZZZZ') ->> 'reason', 'INVALID_CODE', 'unknown code');
select tests.ok(public.preview_invite_code('ZZZZ-ZZZZ') -> 'company_name' = 'null'::jsonb, 'no names for unusable codes');
select tests.eq(public.preview_invite_code('EXP1-RED0') ->> 'reason', 'CODE_EXPIRED', 'expired code (preview)');

-- redeem the company-wide code: joins as inspector, onboarded, creator notified
select tests.set('r1', public.redeem_invite_code('0k1m 2345')::text);
select tests.eq((tests.get('r1')::jsonb ->> 'ok')::boolean, true, 'redeemed');
select tests.eq((tests.get('r1')::jsonb ->> 'company_id')::uuid, tests.id('company_a'), 'company_id returned');
select tests.ok(tests.get('r1')::jsonb -> 'project_id' = 'null'::jsonb, 'company-wide → no project');
select tests.eq((select role::text from public.company_members where user_id = tests.uid('i1')), 'inspector', 'joined as inspector');
select tests.ok((select onboarded_at is not null and role_pref = 'inspector' from public.profiles where id = tests.uid('i1')), 'onboarded');
select tests.eq((select count(*) from public.projects), 0::bigint, 'company-wide code grants no project yet');
-- redeeming again is harmless
select tests.eq((public.redeem_invite_code('0K1M-2345') ->> 'already_member')::boolean, true, 'already member');
-- project code (max 1 use): adds the project
select tests.eq((public.redeem_invite_code('p1ab cdef') ->> 'project_id')::uuid, tests.id('p1'), 'project code adds the project');
select tests.eq((select count(*) from public.projects), 1::bigint, 'now sees P1');
select tests.eq((select role::text from public.project_members where user_id = tests.uid('i1')), 'inspector', 'project inspector');
select tests.logout();

select tests.eq((select use_count from public.invite_codes where code = '0K1M-2345'), 1, 'use counted once');
select tests.eq((select use_count from public.invite_codes where code = 'P1AB-CDEF'), 1, 'project code used once');
select tests.login('a_owner');
select tests.ok(exists (select 1 from public.notifications where type = 'member_joined'), 'code creator notified');
select tests.ok(exists (select 1 from public.activity_logs where via = 'invite_code' and action = 'join'), 'join logged via invite_code');
select tests.logout();

-- exhausted / expired / revoked / invalid
select tests.login('i2');
select tests.eq(public.redeem_invite_code('P1AB-CDEF') ->> 'error_code', 'CODE_EXHAUSTED', 'exhausted');
select tests.eq(public.redeem_invite_code('EXP1-RED0') ->> 'error_code', 'CODE_EXPIRED', 'expired');
select tests.eq((public.redeem_invite_code('EXP1-RED0') ->> 'ok')::boolean, false, 'ok=false on problems');
select tests.eq(public.redeem_invite_code('not a code') ->> 'error_code', 'INVALID_CODE', 'invalid');
select tests.eq((select count(*) from public.company_members), 0::bigint, 'nothing joined');
select tests.logout();
select tests.login('a_owner');
select tests.eq((public.revoke_invite_code(tests.id('code_c'))).revoked_at is not null, true, 'revoked');
select tests.eq((public.revoke_invite_code(tests.id('code_c2'))).revoked_at is not null, true, 'owner revokes another PM''s company-wide code');
select tests.ok(exists (select 1 from public.activity_logs where action = 'revoke' and entity_type = 'invite_code'), 'revocation logged');
select tests.set('code_c_text', (select code from public.invite_codes where id = tests.id('code_c')));
select tests.logout();
select tests.login('i2');
select tests.eq(public.redeem_invite_code(tests.get('code_c_text')) ->> 'error_code', 'CODE_REVOKED', 'revoked');
select tests.logout();

-- members of another company cannot redeem
select tests.login('b_owner');
select tests.expect_error('select public.redeem_invite_code(''0K1M-2345'')', 'INVITEE_IN_OTHER_COMPANY');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Rate limit: 10 failed attempts per user per rolling hour → RATE_LIMITED
-- ---------------------------------------------------------------------------
select tests.login('i3');
select public.redeem_invite_code('AAAA-AAA' || n::text) from generate_series(0, 4) n;   -- 5 failures
select public.preview_invite_code('BBBB-BBB' || n::text) from generate_series(0, 4) n;  -- 5 more (previews count)
select tests.expect_error('select public.redeem_invite_code(''0K1M-2345'')', 'RATE_LIMITED');
select tests.expect_error('select public.preview_invite_code(''0K1M-2345'')', 'RATE_LIMITED');
select tests.expect_sqlstate('select * from public.invite_code_attempts', '42501');
select tests.logout();
-- failures older than an hour no longer count
update public.invite_code_attempts set attempted_at = now() - interval '61 minutes' where user_id = tests.uid('i3');
select tests.login('i3');
select tests.eq((public.redeem_invite_code('0K1M-2345') ->> 'ok')::boolean, true, 'allowed again after the window');
select tests.logout();

select '05_invite_codes: all assertions passed' as result;
rollback;
