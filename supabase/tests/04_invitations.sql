-- CivPMS database test 04_invitations: email invitations
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
-- 04 · Email invitations (spec §4.4)
-- ===========================================================================
select tests.new_user('a_owner', 'a.owner@example.com', 'Alice Owner');
select tests.new_user('a_insp', 'a.insp@example.com', 'Andy Inspector');
select tests.new_user('b_owner', 'b.owner@example.com', 'Bob Owner');
select tests.new_user('b_insp', 'b.insp@example.com', 'Bea Inspector');

select tests.login('b_owner');
select tests.set('company_b', (public.create_company('Bravo Secret Holdings')).id::text);
select tests.set('pb', (public.create_project('Bravo Mall', '2026-10-01', '2027-06-30', 1000000)).id::text);
select tests.logout();
insert into public.company_members (company_id, user_id, role) values (tests.id('company_b'), tests.uid('b_insp'), 'inspector');

select tests.login('a_owner');
select tests.set('company_a', (public.create_company('Alpha Construction')).id::text);
select tests.set('p1', (public.create_project('Alpha Tower', '2026-10-01', '2027-06-30', 5000000)).id::text);
select tests.set('p2', (public.create_project('Alpha Bridge', '2026-10-01', '2027-06-30', 5000000)).id::text);

-- invite an email without an account
select tests.set('inv1', public.invite_to_project(tests.id('p1'), '  New.Person@Example.com ', 'inspector')::text);
select tests.ok((tests.get('inv1')::jsonb ->> 'token') ~ '^[0-9a-f]{64}$', 'plaintext token returned once');
select tests.eq((tests.get('inv1')::jsonb ->> 'existing_user')::boolean, false, 'no account yet');
select tests.eq((tests.get('inv1')::jsonb ->> 'resent')::boolean, false, 'first invite');
select tests.eq(tests.get('inv1')::jsonb ->> 'company_name', 'Alpha Construction', 'company_name');
select tests.eq(tests.get('inv1')::jsonb ->> 'project_name', 'Alpha Tower', 'project_name');
select tests.eq(tests.get('inv1')::jsonb ->> 'inviter_name', 'Alice Owner', 'inviter_name');
select tests.eq((select email from public.invitations where id = (tests.get('inv1')::jsonb ->> 'invitation_id')::uuid),
                'new.person@example.com', 'email stored lowercased');
select tests.ok((select token_hash <> (tests.get('inv1')::jsonb ->> 'token')
                   and token_hash = encode(extensions.digest(tests.get('inv1')::jsonb ->> 'token', 'sha256'), 'hex')
                   and expires_at > now() + interval '6 days 23 hours'
                   from public.invitations where id = (tests.get('inv1')::jsonb ->> 'invitation_id')::uuid),
                'only the sha256 of the token is stored; 7-day expiry');
-- re-inviting a pending email refreshes token + expiry on the same invitation
select tests.set('inv1b', public.invite_to_project(tests.id('p1'), 'new.person@example.com', 'inspector')::text);
select tests.eq(tests.get('inv1b')::jsonb ->> 'invitation_id', tests.get('inv1')::jsonb ->> 'invitation_id', 'same invitation');
select tests.eq((tests.get('inv1b')::jsonb ->> 'resent')::boolean, true, 'resent flag');
select tests.ok((tests.get('inv1b')::jsonb ->> 'token') <> (tests.get('inv1')::jsonb ->> 'token'), 'new token');
select tests.eq((select count(*) from public.invitations where email = 'new.person@example.com'), 1::bigint, 'one pending row');

-- validation and blocking rules
select tests.expect_error(format('select public.invite_to_project(%L, ''not-an-email'', ''pm'')', tests.id('p1')), 'VALIDATION');
select tests.expect_error(format('select public.invite_to_project(%L, ''A.Owner@example.com'', ''pm'')', tests.id('p1')), 'CANNOT_INVITE_SELF');
select tests.eq(tests.error_of(format('select public.invite_to_project(%L, ''b.insp@example.com'', ''inspector'')', tests.id('p1'))),
                'INVITEE_IN_OTHER_COMPANY|This person already belongs to another company.',
                'other-company invitee blocked without naming the company');
select tests.ok(position('Bravo' in tests.error_of(format('select public.invite_to_project(%L, ''b.owner@example.com'', ''pm'')', tests.id('p1')))) = 0,
                'the other company''s name never leaks');
select tests.logout();

insert into public.company_members (company_id, user_id, role) values (tests.id('company_a'), tests.uid('a_insp'), 'inspector');
select tests.login('a_owner');
select public.add_project_member(tests.id('p1'), tests.uid('a_insp'), 'inspector');
select tests.expect_error(format('select public.invite_to_project(%L, ''a.insp@example.com'', ''inspector'')', tests.id('p1')), 'ALREADY_MEMBER');
select tests.logout();

-- A PM of A tries to invite the Owner PM, who already sees every project
insert into public.company_members (company_id, user_id, role)
select tests.id('company_a'), tests.new_user('a_pm', 'a.pm@example.com', 'Arthur PM'), 'pm';
select tests.login('a_owner');
select public.add_project_member(tests.id('p1'), tests.uid('a_pm'), 'pm');
select tests.logout();
select tests.login('a_pm');
select tests.expect_error(format('select public.invite_to_project(%L, ''a.owner@example.com'', ''pm'')', tests.id('p1')), 'ALREADY_MEMBER');
select tests.eq((select count(*) from public.invitations where project_id = tests.id('p1')), 1::bigint, 'PM of the project sees its invitations');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Invite landing page (anon) shows a minimal preview
-- ---------------------------------------------------------------------------
select tests.login_anon();
select tests.set('preview', public.get_invitation_by_token(tests.get('inv1b')::jsonb ->> 'token')::text);
select tests.eq(tests.get('preview')::jsonb ->> 'email_hint', 'n***@example.com', 'masked email');
select tests.eq(tests.get('preview')::jsonb ->> 'company_name', 'Alpha Construction', 'preview company');
select tests.eq(tests.get('preview')::jsonb ->> 'status', 'pending', 'preview status');
select tests.eq((tests.get('preview')::jsonb ->> 'expired')::boolean, false, 'not expired');
select tests.ok(not (tests.get('preview')::jsonb ? 'invitation_id') and not (tests.get('preview')::jsonb ? 'email'), 'no ids or full email');
-- the refreshed token replaced the old one
select tests.expect_error(format('select public.get_invitation_by_token(%L)', tests.get('inv1')::jsonb ->> 'token'), 'NOT_FOUND');
select tests.expect_sqlstate(format('select public.accept_invitation(%L)', tests.get('inv1b')::jsonb ->> 'token'), '42501');
select tests.logout();

-- ---------------------------------------------------------------------------
-- The invitee signs up with that email and accepts
-- ---------------------------------------------------------------------------
select tests.new_user('newbie', 'NEW.person@example.com', 'Nina Newbie');
select tests.new_user('stranger', 'stranger@example.com', 'Sam Stranger');

select tests.login('stranger');
select tests.eq((select count(*) from public.my_pending_invitations()), 0::bigint, 'stranger has no invitations');
select tests.expect_error(format('select public.accept_invitation(%L)', tests.get('inv1b')::jsonb ->> 'token'), 'INVITE_EMAIL_MISMATCH');
select tests.ok(position('n***@example.com' in tests.error_of(format('select public.accept_invitation(%L)', tests.get('inv1b')::jsonb ->> 'token'))) > 0,
                'mismatch message shows the masked address');
select tests.expect_error(format('select public.accept_invitation(null, %L)', tests.get('inv1')::jsonb ->> 'invitation_id'), 'NOT_FOUND');
select tests.expect_error(format('select public.decline_invitation(%L)', tests.get('inv1')::jsonb ->> 'invitation_id'), 'NOT_FOUND');
select tests.eq((select count(*) from public.invitations), 0::bigint, 'invitees cannot select invitations directly');
select tests.logout();

select tests.login('newbie');
select tests.eq((select count(*) from public.my_pending_invitations()), 1::bigint, 'pending invitation matched by email');
select tests.eq((select inviter_name from public.my_pending_invitations()), 'Alice Owner', 'inviter name via RPC');
select tests.eq((select project_name from public.my_pending_invitations()), 'Alpha Tower', 'project name via RPC');
select tests.eq((select count(*) from public.profiles where id = tests.uid('a_owner')), 0::bigint, 'inviter profile itself stays private');
select tests.set('acc', public.accept_invitation(tests.get('inv1b')::jsonb ->> 'token')::text);
select tests.eq((tests.get('acc')::jsonb ->> 'project_id')::uuid, tests.id('p1'), 'accept returns project_id');
select tests.eq((select role::text from public.company_members where user_id = tests.uid('newbie')), 'inspector', 'joined as inspector');
select tests.eq((select role::text from public.project_members where user_id = tests.uid('newbie')), 'inspector', 'project member');
select tests.ok((select onboarded_at is not null from public.profiles where id = tests.uid('newbie')), 'onboarded');
select tests.eq((select count(*) from public.projects), 1::bigint, 'sees the project now');
select tests.eq((select count(*) from public.my_pending_invitations()), 0::bigint, 'no longer pending');
select tests.expect_error(format('select public.accept_invitation(%L)', tests.get('inv1b')::jsonb ->> 'token'), 'INVITE_NOT_PENDING');
select tests.logout();

select tests.login('a_owner');
select tests.eq((select status::text from public.invitations where id = (tests.get('inv1')::jsonb ->> 'invitation_id')::uuid), 'accepted', 'status accepted');
select tests.ok(exists (select 1 from public.notifications where type = 'invitation_accepted' and email_status = 'pending'), 'inviter notified (in-app + email)');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('p1') and action = 'accept' and via = 'invitation'), 'acceptance logged');
-- a member of company A cannot be invited by company B
select tests.logout();
select tests.login('b_owner');
select tests.expect_error(format('select public.invite_to_project(%L, ''new.person@example.com'', ''inspector'')', tests.id('pb')), 'INVITEE_IN_OTHER_COMPANY');
select tests.logout();

-- ---------------------------------------------------------------------------
-- A pending invitation from B for someone who has since joined A
-- ---------------------------------------------------------------------------
select tests.new_user('switcher', 'switcher@example.com', 'Sid Switcher');
select tests.login('b_owner');
select tests.set('inv_b', public.invite_to_project(tests.id('pb'), 'switcher@example.com', 'inspector')::text);
select tests.eq((tests.get('inv_b')::jsonb ->> 'existing_user')::boolean, true, 'existing user detected');
select tests.logout();
select tests.login('switcher');
select tests.ok(exists (select 1 from public.notifications where type = 'invitation_received'), 'existing user notified of the invitation');
select tests.logout();
insert into public.company_members (company_id, user_id, role) values (tests.id('company_a'), tests.uid('switcher'), 'inspector');
select tests.login('switcher');
select tests.expect_error(format('select public.accept_invitation(%L)', tests.get('inv_b')::jsonb ->> 'token'), 'INVITEE_IN_OTHER_COMPANY');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Decline, revoke, expire, resend
-- ---------------------------------------------------------------------------
select tests.login('a_owner');
select tests.set('inv_s', public.invite_to_project(tests.id('p2'), 'stranger@example.com', 'pm')::text);
select tests.set('inv_r', public.invite_to_project(tests.id('p2'), 'revoked.person@example.com', 'inspector')::text);
select tests.set('inv_e', public.invite_to_project(tests.id('p2'), 'late.person@example.com', 'inspector')::text);
select public.revoke_invitation((tests.get('inv_r')::jsonb ->> 'invitation_id')::uuid);
select tests.expect_error(format('select public.revoke_invitation(%L)', tests.get('inv_r')::jsonb ->> 'invitation_id'), 'INVITE_NOT_PENDING');
select tests.logout();

select tests.login('stranger');
select public.decline_invitation((tests.get('inv_s')::jsonb ->> 'invitation_id')::uuid);
select tests.eq((select count(*) from public.company_members), 0::bigint, 'declining joins nothing');
select tests.expect_error(format('select public.accept_invitation(%L)', tests.get('inv_s')::jsonb ->> 'token'), 'INVITE_NOT_PENDING');
select tests.logout();

select tests.login('a_owner');
select tests.eq((select status::text from public.invitations where id = (tests.get('inv_s')::jsonb ->> 'invitation_id')::uuid), 'declined', 'declined');
select tests.ok(exists (select 1 from public.notifications where type = 'invitation_declined'), 'inviter notified of decline');
select tests.logout();

select tests.login_anon();
select tests.eq(public.get_invitation_by_token(tests.get('inv_r')::jsonb ->> 'token') ->> 'status', 'revoked', 'revoked preview');
select tests.logout();

-- expire one invitation
update public.invitations set expires_at = now() - interval '1 minute'
 where id = (tests.get('inv_e')::jsonb ->> 'invitation_id')::uuid;
select tests.new_user('late', 'late.person@example.com', 'Lee Late');
select tests.login('late');
select tests.eq((select count(*) from public.my_pending_invitations()), 0::bigint, 'expired invitations are not listed');
select tests.expect_error(format('select public.accept_invitation(%L)', tests.get('inv_e')::jsonb ->> 'token'), 'INVITE_EXPIRED');
select tests.logout();
select tests.login_anon();
select tests.eq((public.get_invitation_by_token(tests.get('inv_e')::jsonb ->> 'token') ->> 'expired')::boolean, true, 'preview says expired');
select tests.logout();
select tests.eq((private.run_daily_checks() ->> 'invitations_expired')::integer, 1, 'daily job expires it');
-- resend revives it with a fresh token and expiry
select tests.login('a_owner');
select tests.set('inv_e2', public.resend_invitation((tests.get('inv_e')::jsonb ->> 'invitation_id')::uuid)::text);
select tests.eq((select status::text from public.invitations where id = (tests.get('inv_e')::jsonb ->> 'invitation_id')::uuid), 'pending', 'resend → pending');
select tests.expect_error(format('select public.resend_invitation(%L)', tests.get('inv_s')::jsonb ->> 'invitation_id'), 'INVITE_NOT_PENDING');
select tests.logout();
select tests.login('late');
select tests.set('acc_e', public.accept_invitation(tests.get('inv_e2')::jsonb ->> 'token')::text);
select tests.eq((tests.get('acc_e')::jsonb ->> 'project_id')::uuid, tests.id('p2'), 'accepted after resend');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Role mapping keeps the higher role (owner_pm > pm > inspector)
-- ---------------------------------------------------------------------------
select tests.login('a_owner');
select tests.set('inv_up', public.invite_to_project(tests.id('p2'), 'a.insp@example.com', 'pm')::text);
select tests.logout();
select tests.login('a_insp');
select public.accept_invitation(null, (tests.get('inv_up')::jsonb ->> 'invitation_id')::uuid);
select tests.eq((select role::text from public.company_members where user_id = tests.uid('a_insp')), 'pm', 'inspector promoted to pm by a PM invitation');
select tests.eq((select role::text from public.project_members where user_id = tests.uid('a_insp') and project_id = tests.id('p2')), 'pm', 'project pm');
select tests.logout();
-- a company PM accepting an inspector invitation stays a company PM
select tests.login('a_owner');
select tests.set('inv_low', public.invite_to_project(tests.id('p2'), 'a.pm@example.com', 'inspector')::text);
select tests.logout();
select tests.login('a_pm');
select public.accept_invitation(tests.get('inv_low')::jsonb ->> 'token');
select tests.eq((select role::text from public.company_members where user_id = tests.uid('a_pm')), 'pm', 'company role is never lowered');
select tests.eq((select role::text from public.project_members where user_id = tests.uid('a_pm') and project_id = tests.id('p2')),
                'inspector', 'project role as invited');
select tests.logout();

select '04_invitations: all assertions passed' as result;
rollback;
