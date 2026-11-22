-- CivPMS: remove ALL demo data (supabase/seed/demo.sql) before going to production.
-- Do NOT run this on a database you are still testing with: the demo accounts are used by the
-- app's browser tests and by everyone reviewing the app.
--
-- In one transaction it deletes:
--   1. every Supabase Auth user whose email ends in @civpms.test (the demo accounts and any other test
--      accounts on that reserved domain), with their identities and sessions (cascaded by Auth),
--      profiles, notifications, memberships and invite-code attempts — EXCEPT the accounts listed in
--      c_keep (the owner's own PM account rhecy@civpms.test and its company RHEngineering stay);
--   2. the companies those users own (Dela Cruz Builders, Bayanihan Construction, ...) and everything
--      under them: members, projects, calendars, activities, baselines, invitations and invite codes;
--   3. invitations addressed to *@civpms.test in any company (except to the c_keep accounts);
--   4. activity-log rows of those companies and users. The log is append-only, so this step briefly
--      disables its delete guard inside this transaction. Set c_purge_logs to false to keep the rows
--      instead: they then stay as orphaned snapshots that no one can see.
-- Avatar files in Storage are not deleted here; the notices list any to remove in
-- Dashboard → Storage → avatars.
--
-- Run as postgres in the Supabase SQL editor (or psql). The last query must return 0, 0 and the
-- number of kept accounts (1).

begin;

do $cleanup$
declare
  c_purge_logs constant boolean := true;
  -- Accounts on @civpms.test that are NOT demo data and must survive the cleanup.
  c_keep constant text[] := array['rhecy@civpms.test'];
  v_users uuid[];
  v_companies uuid[];
  v_count bigint;
  v_avatar text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;

  select coalesce(array_agg(u.id), '{}') into v_users
    from auth.users u
   where lower(u.email) like '%@civpms.test'
     and lower(u.email) <> all (c_keep);
  select coalesce(array_agg(c.id), '{}') into v_companies
    from public.companies c
   where c.owner_id = any (v_users);
  raise notice 'Removing % @civpms.test account(s) and % company/companies they own.',
    cardinality(v_users), cardinality(v_companies);

  begin
    for v_avatar in
      select o.name from storage.objects o
       where o.bucket_id = 'avatars' and split_part(o.name, '/', 1) in (select x::text from unnest(v_users) x)
    loop
      raise notice 'Delete this avatar in Dashboard → Storage → avatars: %', v_avatar;
    end loop;
  exception when others then
    raise notice 'Could not list avatar files (%). Check Dashboard → Storage → avatars by hand.', sqlerrm;
  end;

  -- The removals themselves are not written to the activity log.
  perform set_config('pms.audit', 'off', true);

  if c_purge_logs then
    alter table public.activity_logs disable trigger activity_logs_no_delete;
    with gone as (
      delete from public.activity_logs l
       where l.company_id = any (v_companies) or l.actor_id = any (v_users)
      returning 1
    )
    select count(*) into v_count from gone;
    alter table public.activity_logs enable trigger activity_logs_no_delete;
    raise notice 'Activity log rows removed: %', v_count;
  end if;

  with gone as (
    delete from public.invitations i
     where lower(i.email) like '%@civpms.test' and lower(i.email) <> all (c_keep)
    returning 1
  )
  select count(*) into v_count from gone;
  raise notice 'Invitations to @civpms.test removed: %', v_count;

  -- Cascades to members, projects and everything under them, invitations and invite codes.
  with gone as (
    delete from public.companies c where c.id = any (v_companies) returning 1
  )
  select count(*) into v_count from gone;
  raise notice 'Companies removed: %', v_count;

  -- Cascades to identities, sessions, profiles, notifications, memberships and code attempts.
  with gone as (
    delete from auth.users u where u.id = any (v_users) returning 1
  )
  select count(*) into v_count from gone;
  raise notice 'Accounts removed: %', v_count;

  perform set_config('pms.audit', 'on', true);
end
$cleanup$;

commit;

select (select count(*) from auth.users
         where lower(email) like '%@civpms.test'
           and lower(email) <> all (array['rhecy@civpms.test'])) as civpms_test_accounts_left,
       (select count(*) from public.companies
         where name_key in ('dela cruz builders', 'bayanihan construction')) as demo_companies_left,
       (select count(*) from auth.users
         where lower(email) = any (array['rhecy@civpms.test'])) as kept_accounts;
