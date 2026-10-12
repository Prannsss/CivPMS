-- CivPMS database test 02_onboarding_company: onboarding, profiles, company and membership
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
-- 02 · Onboarding, profiles, company and company membership
-- ===========================================================================
select tests.new_user('owner', 'Olive.Owner@Example.com', 'Olive Owner');
select tests.new_user('pm', 'pete.pm@example.com', 'Pete PM');
select tests.new_user('insp', 'ivy.inspector@example.com');
select tests.new_user('other', 'oscar.other@example.com', 'Oscar Other');

-- auth trigger created profiles (lowercased email, name from metadata)
select tests.eq((select email from public.profiles where id = tests.uid('owner')), 'olive.owner@example.com', 'profile email lowercased');
select tests.eq((select full_name from public.profiles where id = tests.uid('owner')), 'Olive Owner', 'profile name from metadata');
select tests.ok((select full_name is null from public.profiles where id = tests.uid('insp')), 'no name in metadata → null');

-- email changes in auth.users are mirrored
update auth.users set email = 'Ivy.Q@Example.com' where id = tests.uid('insp');
select tests.eq((select email from public.profiles where id = tests.uid('insp')), 'ivy.q@example.com', 'email sync on update');
update auth.users set email = 'ivy.inspector@example.com' where id = tests.uid('insp');

-- complete_profile (step 1) does not finish onboarding
select tests.login('insp');
select tests.expect_error('select public.complete_profile(''Ivy Inspector'', ''viewer'')', 'VALIDATION');
select tests.expect_error('select public.complete_profile(''   '', ''inspector'')', 'VALIDATION');
select tests.eq((public.complete_profile('  Ivy   Inspector ', 'inspector')).full_name, 'Ivy Inspector', 'name cleaned');
select tests.ok((select onboarded_at is null and role_pref = 'inspector' from public.profiles where id = tests.uid('insp')),
                'complete_profile sets role_pref only');
-- inspectors without a code finish in "No company yet"
select tests.ok((public.finish_onboarding_without_company()).onboarded_at is not null, 'finish without company');
select tests.eq((select count(*) from public.company_members), 0::bigint, 'still no company');
select tests.expect_error('select public.create_project(''Nope'', ''2026-01-01'', ''2026-02-01'', 100)', 'FORBIDDEN');
select tests.logout();

-- Owner creates the company
select tests.login('owner');
select tests.ok(public.company_name_available('Acme Builders'), 'name available');
select tests.set('company', (public.create_company('  Acme   Builders ')).id::text);
select tests.eq((select name from public.companies where id = tests.id('company')), 'Acme Builders', 'name whitespace collapsed');
select tests.eq((select role::text from public.company_members where user_id = tests.uid('owner')), 'owner_pm', 'creator is owner_pm');
select tests.ok((select onboarded_at is not null and role_pref = 'pm' from public.profiles where id = tests.uid('owner')), 'owner onboarded');
select tests.expect_error('select public.create_company(''Second Co'')', 'ALREADY_IN_COMPANY');
select tests.logout();

-- Name uniqueness is case/whitespace-insensitive
select tests.login('other');
select tests.ok(not public.company_name_available('  acme   BUILDERS'), 'taken name is unavailable');
select tests.expect_error('select public.create_company(''ACME  builders'')', 'COMPANY_NAME_TAKEN');
select tests.eq(split_part(tests.error_of('select public.create_company(''acme builders'')'), '|', 2),
                'A company with this name already exists. Ask its Owner PM to invite you.', 'spec §4.2 message');
select tests.set('company_b', (public.create_company('Beta Works')).id::text);
-- cannot see company A or its members
select tests.eq((select count(*) from public.companies), 1::bigint, 'B sees only its own company');
select tests.eq((select count(*) from public.company_members where company_id = tests.id('company')), 0::bigint, 'B cannot see A members');
select tests.eq((select count(*) from public.profiles where id = tests.uid('owner')), 0::bigint, 'B cannot see A profiles');
select tests.logout();

-- one company per user, enforced by the table too
select tests.expect_sqlstate(format('insert into public.company_members (company_id, user_id, role) values (%L, %L, ''pm'')',
                                    tests.id('company_b'), tests.uid('owner')), '23505');

-- Setup: pm + inspector join company A (as if through invitations)
insert into public.company_members (company_id, user_id, role) values
  (tests.id('company'), tests.uid('pm'), 'pm'),
  (tests.id('company'), tests.uid('insp'), 'inspector');

-- Company settings are Owner-PM only
select tests.login('pm');
select tests.expect_error('select public.rename_company(''Acme Two'')', 'FORBIDDEN');
select tests.expect_error('select public.update_company_defaults(''{1,2,3}'', 8)', 'FORBIDDEN');
select tests.expect_error(format('select public.remove_company_member(%L)', tests.uid('insp')), 'FORBIDDEN');
select tests.expect_error(format('select public.set_company_member_role(%L, ''pm'')', tests.uid('insp')), 'FORBIDDEN');
-- teammates are visible inside the company
select tests.eq((select count(*) from public.profiles), 3::bigint, 'pm sees the 3 company profiles');
select tests.logout();

select tests.login('owner');
select tests.expect_error('select public.rename_company(''beta   WORKS'')', 'COMPANY_NAME_TAKEN');
select tests.expect_error('select public.rename_company(''A'')', 'VALIDATION');
select tests.eq((public.rename_company('Acme Builders Inc.')).name, 'Acme Builders Inc.', 'renamed');
select tests.ok(exists (select 1 from public.activity_logs where company_id = tests.id('company') and action = 'rename'
                          and summary = 'Company name: Acme Builders → Acme Builders Inc.'), 'rename logged');
select tests.expect_error('select public.update_company_defaults(''{}'', 8)', 'NO_WORKING_DAYS');
select tests.expect_error('select public.update_company_defaults(''{1,8}'', 8)', 'VALIDATION');
select tests.expect_error('select public.update_company_defaults(''{1,2}'', 25)', 'VALIDATION');
select tests.eq((public.update_company_defaults('{6,1,2,2,3}', 9.5)).default_work_days, '{1,2,3,6}'::smallint[], 'defaults normalised');

-- new projects copy the company calendar template
select tests.set('p1', (public.create_project('Tower One', '2026-10-01', '2027-03-31', 1000000)).id::text);
select tests.eq((select work_days from public.calendars where project_id = tests.id('p1')), '{1,2,3,6}'::smallint[], 'calendar from company defaults');
select tests.eq((select hours_per_day from public.calendars where project_id = tests.id('p1')), 9.5, 'hours from company defaults');
select public.add_project_member(tests.id('p1'), tests.uid('pm'), 'pm');
select public.add_project_member(tests.id('p1'), tests.uid('insp'), 'inspector');
select tests.expect_error(format('select public.add_project_member(%L, %L, ''pm'')', tests.id('p1'), tests.uid('other')), 'NOT_FOUND');

-- set_company_member_role
select tests.expect_error(format('select public.set_company_member_role(%L, ''inspector'')', tests.uid('owner')), 'CANNOT_CHANGE_OWNER_ROLE');
select tests.expect_error(format('select public.set_company_member_role(%L, ''owner_pm'')', tests.uid('pm')), 'VALIDATION');
select tests.eq((public.set_company_member_role(tests.uid('pm'), 'inspector')).role::text, 'inspector', 'pm demoted');
select tests.eq((select role::text from public.project_members where project_id = tests.id('p1') and user_id = tests.uid('pm')),
                'inspector', 'project PM role demoted with the company role');
select tests.eq((public.set_company_member_role(tests.uid('pm'), 'pm')).role::text, 'pm', 'promoted back');

-- remove_company_member
select tests.expect_error(format('select public.remove_company_member(%L)', tests.uid('owner')), 'CANNOT_REMOVE_OWNER');
select tests.expect_error(format('select public.remove_company_member(%L)', tests.uid('other')), 'NOT_FOUND');
select public.remove_company_member(tests.uid('insp'));
select tests.eq((select count(*) from public.project_members where user_id = tests.uid('insp')), 0::bigint, 'project access removed');
select tests.ok(exists (select 1 from public.activity_logs where company_id = tests.id('company') and project_id is null
                          and action = 'remove' and summary = 'Ivy Inspector was removed from the company'),
                'company-scoped removal logged (visible to the owner)');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and action = 'remove'
                          and via = 'company_removal'), 'project removal logged via company_removal');
select tests.logout();

select tests.login('insp');
select tests.eq((select count(*) from public.company_members), 0::bigint, 'removed inspector is back to "No company yet"');
select tests.eq((select count(*) from public.projects), 0::bigint, 'removed inspector sees no projects');
select tests.ok(exists (select 1 from public.notifications where type = 'removed_from_company' and email_status = 'pending'),
                'removal notification (emailed by default)');
select tests.ok(exists (select 1 from public.notifications where type = 'added_to_project' and email_status = 'skipped'),
                'added_to_project is in-app only by default');
select tests.logout();

-- company-scoped log entries are owner-only
select tests.login('pm');
select tests.eq((select count(*) from public.activity_logs where project_id is null), 0::bigint, 'PM cannot see company-scoped log');
select tests.ok((select count(*) from public.activity_logs where project_id = tests.id('p1')) > 0, 'PM sees the project log');
select tests.logout();

-- Profiles: column-limited direct update + RPC
select tests.login('pm');
update public.profiles set full_name = 'Peter P. Manager' where id = tests.uid('pm');
select tests.eq((select full_name from public.profiles where id = tests.uid('pm')), 'Peter P. Manager', 'own name updated directly');
update public.profiles set full_name = 'Hacked' where id = tests.uid('owner');
select tests.eq((select full_name from public.profiles where id = tests.uid('owner')), 'Olive Owner', 'cannot update someone else');
select tests.expect_sqlstate(format('update public.profiles set email = ''x@y.z'' where id = %L', tests.uid('pm')), '42501');
select tests.expect_sqlstate(format('update public.profiles set onboarded_at = null where id = %L', tests.uid('pm')), '42501');
select tests.expect_sqlstate(format('update public.profiles set avatar_url = ''javascript:alert(1)'' where id = %L', tests.uid('pm')), '23514');
select tests.expect_error('select public.update_profile(''{"avatar_url": "http://x.test/a.png"}'')', 'VALIDATION');
select tests.expect_error('select public.update_profile(''{"email": "x@y.z"}'')', 'VALIDATION');
select tests.eq((public.update_profile('{"duration_unit": "days", "avatar_url": "https://cdn.test/a.png"}')).duration_unit::text,
                'days', 'update_profile');
select tests.logout();

-- notification prefs
select tests.login('pm');
select tests.expect_error('select public.update_notification_prefs(''{"nope": {"email": true}}'')', 'VALIDATION');
select tests.expect_error('select public.update_notification_prefs(''{"project_delayed": {"email": "yes"}}'')', 'VALIDATION');
select tests.eq(public.update_notification_prefs('{"project_delayed": {"email": false}}') -> 'project_delayed' ->> 'email',
                'false', 'prefs merged');
select tests.eq(public.update_notification_prefs('{"project_delayed": {"in_app": false}}') -> 'project_delayed',
                '{"email": false, "in_app": false}'::jsonb, 'prefs merged per key');
select tests.logout();

select '02_onboarding_company: all assertions passed' as result;
rollback;
