-- CivPMS database test 08_overview_jobs: project_overview numbers, budget alerts, daily job, email outbox
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
-- 08 · project_overview numbers, budget-exceeded notifications, daily job
--      (delayed, purge), email outbox (service_role)
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
-- Cost weighting, parents ignored, near/exceeded thresholds
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.set('p', (public.create_project('Budget Project', '2026-10-01', '2027-06-30', 1000000)).id::text);
select public.add_project_member(tests.id('p'), tests.uid('insp'), 'inspector');
select tests.set('d', (public.create_activity(tests.id('p'), null, 'Deliverable', null, '{"est_cost": 850000}')).id::text);
select tests.eq((select allocated from public.project_overview where id = tests.id('p')), 850000.00, 'a lone deliverable is a leaf and counts');
select tests.eq((select budget_state from public.project_overview where id = tests.id('p')), 'ok', '85% → ok');
-- once it has children its own cost is ignored (D21)
select tests.set('w1', (public.create_activity(tests.id('p'), tests.id('d'), 'Leaf 1', null,
                          '{"est_cost": 600000, "duration_hours": 40, "start_date": "2026-10-05"}')).id::text);
select tests.set('w2', (public.create_activity(tests.id('p'), tests.id('d'), 'Leaf 2', null,
                          '{"est_cost": 300000, "duration_hours": 10, "start_date": "2026-10-12", "end_date": "2026-10-13"}')).id::text);
select tests.logout();
update public.activities set percent = 50, status = 'ongoing' where id = tests.id('w1');
update public.activities set percent = 100, status = 'completed' where id = tests.id('w2');

select tests.login('insp');
select tests.eq((select allocated from public.project_overview where id = tests.id('p')), 900000.00, 'allocated = Σ leaves (parent cost ignored)');
select tests.eq((select remaining from public.project_overview where id = tests.id('p')), 100000.00, 'remaining');
select tests.eq((select leaf_count from public.project_overview where id = tests.id('p')), 2, 'leaf_count');
select tests.eq((select activity_count from public.project_overview where id = tests.id('p')), 3, 'activity_count');
select tests.eq((select completed_count from public.project_overview where id = tests.id('p')), 1, 'completed_count');
-- (600000·50 + 300000·100) / 900000 = 66.67
select tests.eq((select percent_complete from public.project_overview where id = tests.id('p')), 66.67, 'cost-weighted percent');
select tests.eq((select budget_state from public.project_overview where id = tests.id('p')), 'near', 'exactly 90% → near');
select tests.eq((select unscheduled_count from public.project_overview where id = tests.id('p')), 0, 'all leaves have start, duration and cost');
select tests.eq((select is_delayed from public.project_overview where id = tests.id('p')), false, 'not delayed');
select tests.logout();

select tests.login('pm');
select public.update_activity(tests.id('w2'), '{"est_cost": 299999.99}', (select version from public.activities where id = tests.id('w2')));
select tests.eq((select budget_state from public.project_overview where id = tests.id('p')), 'ok', 'just under 90% → ok');
select public.update_activity(tests.id('w2'), '{"est_cost": 400000}', (select version from public.activities where id = tests.id('w2')));
select tests.eq((select budget_state from public.project_overview where id = tests.id('p')), 'near', 'exactly 100% → near (not exceeded)');
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 0::bigint, 'no alert at exactly 100%');
-- crossing above the budget notifies the Owner PM and the project PMs once
select public.update_activity(tests.id('w2'), '{"est_cost": 400000.01}', (select version from public.activities where id = tests.id('w2')));
select tests.eq((select budget_state from public.project_overview where id = tests.id('p')), 'exceeded', '100% + ₱0.01 → exceeded');
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 1::bigint, 'pm alerted');
select tests.ok((select email_status = 'pending' from public.notifications where type = 'project_budget_exceeded'), 'budget alert is emailed by default');
select public.update_activity(tests.id('w2'), '{"est_cost": 450000}', (select version from public.activities where id = tests.id('w2')));
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 1::bigint, 'only once while over budget');
select tests.logout();
select tests.login('owner');
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 1::bigint, 'owner alerted too');
-- raising the budget clears the marker; going over again alerts again
select public.update_project(tests.id('p'), '{"budget": 2000000}', (select version from public.projects where id = tests.id('p')));
select tests.ok((select budget_exceeded_notified_at is null from public.projects where id = tests.id('p')), 'marker reset when back under');
select public.update_project(tests.id('p'), '{"budget": 1000000}', (select version from public.projects where id = tests.id('p')));
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 2::bigint, 'alerted again after a new crossing');
select tests.logout();
select tests.login('insp');
select tests.eq((select count(*) from public.notifications where type = 'project_budget_exceeded'), 0::bigint, 'inspectors are not alerted');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Hours weighting with fallbacks; unscheduled leaves; empty project
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.set('h', (public.create_project('Hours Project', '2026-10-01', '2027-06-30', 100)).id::text);
select public.update_project(tests.id('h'), '{"weighting": "hours", "near_budget_threshold": 0.8}', 1);
select tests.eq((select percent_complete from public.project_overview where id = tests.id('h')), 0.00, 'no leaves → 0%');
select tests.eq((select budget_state from public.project_overview where id = tests.id('h')), 'ok', 'no leaves → ok');
select tests.set('l1', (public.create_activity(tests.id('h'), null, 'Hours leaf', null, '{"duration_hours": 10, "est_cost": 9}')).id::text);
select tests.set('l2', (public.create_activity(tests.id('h'), null, 'Cost leaf', null, '{"duration_hours": 0, "est_cost": 30}')).id::text);
select tests.set('l3', (public.create_activity(tests.id('h'), null, 'Empty leaf')).id::text);
select tests.logout();
update public.activities set percent = 100 where id = tests.id('l1');
update public.activities set percent = 50 where id = tests.id('l3');
select tests.login('pm');
-- weights: 10 (hours) · 30 (cost fallback) · 1 (equal weight) → (10·100 + 30·0 + 1·50) / 41 = 25.61
select tests.eq((select percent_complete from public.project_overview where id = tests.id('h')), 25.61, 'hours weighting with fallbacks');
select tests.eq((select allocated from public.project_overview where id = tests.id('h')), 39.00, 'allocated');
select tests.eq((select budget_state from public.project_overview where id = tests.id('h')), 'ok', '39% of budget');
select tests.eq((select unscheduled_count from public.project_overview where id = tests.id('h')), 3, 'leaves missing a start date / cost');
select public.update_activity(tests.id('l2'), '{"est_cost": 71}', (select version from public.activities where id = tests.id('l2')));
select tests.eq((select budget_state from public.project_overview where id = tests.id('h')), 'near', 'custom 80% threshold');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Daily job: delayed projects (notify once), reset, purge
-- ---------------------------------------------------------------------------
select tests.login('pm');
select tests.set('late', (public.create_project('Late Project', '2026-01-05', '2026-03-31', 1000)).id::text);
select tests.eq((select is_delayed from public.project_overview where id = tests.id('late')), true, 'end date passed → delayed');
select tests.set('done', (public.create_project('Done Project', '2026-01-05', '2026-03-31', 1000)).id::text);
select public.create_activity(tests.id('done'), null, 'Only task');
select public.set_project_status(tests.id('done'), 'active');
select tests.logout();
update public.activities set status = 'completed', percent = 100 where project_id = tests.id('done');
select tests.login('pm');
select public.set_project_status(tests.id('done'), 'completed');
select tests.eq((select is_delayed from public.project_overview where id = tests.id('done')), false, 'completed projects are never delayed');
select tests.logout();

select tests.eq((private.run_daily_checks() ->> 'projects_delayed')::integer, 1, 'one project newly delayed');
select tests.eq((select count(*) from public.notifications where type = 'project_delayed' and project_id = tests.id('late')), 2::bigint,
                'owner + project PM notified');
select tests.ok(exists (select 1 from public.activity_logs where project_id = tests.id('late') and action = 'delayed'
                          and via = 'system' and actor_name = 'System' and is_escalation), 'delay logged by the system');
select tests.eq((private.run_daily_checks() ->> 'projects_delayed')::integer, 0, 'not notified twice');
select tests.login('pm');
select public.update_project(tests.id('late'), '{"end_date": "2027-12-31"}', (select version from public.projects where id = tests.id('late')));
select tests.ok((select delayed_notified_at is null from public.projects where id = tests.id('late')), 'moving the end date to the future resets the marker');
select tests.eq((select is_delayed from public.project_overview where id = tests.id('late')), false, 'no longer delayed');
select tests.logout();

-- purge: activities and projects soft-deleted more than 30 days ago
select tests.login('owner');
select tests.set('gone_act', (public.create_activity(tests.id('h'), null, 'Will be purged')).id::text);
select public.delete_activity(tests.id('gone_act'));
select tests.set('gone_proj', (public.create_project('Purged Project', '2026-10-01', '2026-12-31', 1000)).id::text);
select public.create_activity(tests.id('gone_proj'), null, 'Purged task');
select public.delete_project(tests.id('gone_proj'));
select tests.logout();
update public.activities set deleted_at = now() - interval '31 days' where id = tests.id('gone_act');
update public.projects set deleted_at = now() - interval '31 days' where id = tests.id('gone_proj');
select tests.set('purge', private.run_daily_checks()::text);
select tests.eq((tests.get('purge')::jsonb ->> 'activities_purged')::integer, 1, 'activity purged');
select tests.eq((tests.get('purge')::jsonb ->> 'projects_purged')::integer, 1, 'project purged');
select tests.eq((select count(*) from public.activities where id = tests.id('gone_act')), 0::bigint, 'activity row is gone');
select tests.eq((select count(*) from public.projects where id = tests.id('gone_proj')), 0::bigint, 'project row is gone');
select tests.eq((select count(*) from public.calendar_dates where project_id = tests.id('gone_proj')), 0::bigint, 'its calendar is gone');
-- the log keeps its snapshots (FKs set to NULL, text kept)
select tests.ok(exists (select 1 from public.activity_logs where entity_id = tests.id('gone_act') and action = 'create'
                          and activity_id is null and activity_name = 'Will be purged'), 'activity log survives the purge');
select tests.ok(exists (select 1 from public.activity_logs where entity_id = tests.id('gone_proj') and action = 'create'
                          and project_id is null and company_id = tests.id('company')), 'project log survives as company-scoped');
select tests.login('owner');
select tests.ok(exists (select 1 from public.activity_logs where entity_id = tests.id('gone_proj') and action = 'purge'
                          and summary like 'Permanently deleted project "Purged Project"%'), 'owner sees the purge entry');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Email outbox (service_role only)
-- ---------------------------------------------------------------------------
select tests.login('pm');
select public.update_notification_prefs('{"project_budget_exceeded": {"email": false}, "project_delayed": {"in_app": false, "email": false}}');
select tests.expect_sqlstate('select * from public.claim_email_batch(10)', '42501');
select tests.logout();
-- pending emails exist (budget alerts, delayed alerts, ...)
select tests.set('pending', (select count(*)::text from public.notifications where email_status = 'pending'));
select tests.ok(tests.get('pending')::integer > 0, 'there are pending emails');
set local role service_role;
select tests.set('batch', (select jsonb_agg(to_jsonb(b)) from public.claim_email_batch(2) b)::text);
select tests.eq(jsonb_array_length(tests.get('batch')::jsonb), 2, 'claims at most p_limit rows');
select tests.ok((tests.get('batch')::jsonb -> 0 ->> 'recipient_email') like '%@example.com', 'recipient email included');
select tests.eq((select count(*) from public.notifications where email_status = 'sending'), 2::bigint, 'claimed rows are marked sending');
select public.complete_email((tests.get('batch')::jsonb -> 0 ->> 'id')::uuid, 'sent');
select public.complete_email((tests.get('batch')::jsonb -> 1 ->> 'id')::uuid, 'failed', 'Brevo 503');
reset role;
select tests.ok((select email_status = 'sent' and emailed_at is not null from public.notifications
                  where id = (tests.get('batch')::jsonb -> 0 ->> 'id')::uuid), 'sent');
select tests.ok((select email_status = 'pending' and email_attempts = 1 and email_error = 'Brevo 503' from public.notifications
                  where id = (tests.get('batch')::jsonb -> 1 ->> 'id')::uuid), 'failed → retried later');
-- preferences: a new alert for the pm is in-app only now; a fully muted type is not stored
select tests.login('owner');
select public.update_project(tests.id('h'), '{"budget": 50}', (select version from public.projects where id = tests.id('h')));
select tests.logout();
select tests.ok((select email_status = 'skipped' from public.notifications
                  where user_id = tests.uid('pm') and type = 'project_budget_exceeded' and project_id = tests.id('h')),
                'email preference respected');
update public.projects set end_date = '2026-03-31', start_date = '2026-01-05' where id = tests.id('h');
select tests.eq((private.run_daily_checks() ->> 'projects_delayed')::integer, 1, 'hours project now delayed');
select tests.eq((select count(*) from public.notifications where type = 'project_delayed' and project_id = tests.id('h')
                   and user_id = tests.uid('pm')), 0::bigint, 'muted type is not stored for the pm');
select tests.eq((select count(*) from public.notifications where type = 'project_delayed' and project_id = tests.id('h')
                   and user_id = tests.uid('owner')), 1::bigint, 'owner still notified');

select '08_overview_jobs: all assertions passed' as result;
rollback;
