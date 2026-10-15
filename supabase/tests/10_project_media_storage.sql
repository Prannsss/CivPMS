-- CivPMS database test 10_project_media_storage: project-media bucket + storage.objects policies
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
-- 10 · project-media bucket: private, WebP only; viewers read/write their
--      projects' folders, only managers delete, other companies see nothing
-- ===========================================================================

-- Catalog checks.
select tests.ok(exists (select 1 from storage.buckets where id = 'project-media' and not public
                          and file_size_limit = 3145728
                          and allowed_mime_types = array['image/webp']),
                'project-media bucket is private, 3 MB, WebP only');
select tests.eq((select string_agg(policyname || ':' || cmd, ',' order by policyname)
                   from pg_policies
                  where schemaname = 'storage' and tablename = 'objects' and policyname like 'project_media_%'),
                'project_media_delete:DELETE,project_media_insert:INSERT,project_media_select:SELECT',
                'exactly select/insert/delete policies (objects are immutable: no update)');

-- Fixtures: company A (owner, project PM, inspector, PM not on the project), company B (rival).
select tests.new_user('a_owner', 'media.owner@example.com', 'Media Owner');
select tests.new_user('a_pm', 'media.pm@example.com', 'Media PM');
select tests.new_user('a_insp', 'media.insp@example.com', 'Media Inspector');
select tests.new_user('a_pm2', 'media.pm2@example.com', 'Media Outsider PM');
select tests.new_user('b_owner', 'media.rival@example.com', 'Media Rival');

select tests.login('a_owner');
select tests.set('company_a', (public.create_company('Media Alpha Builders')).id::text);
select tests.set('p1', (public.create_project('Media Alpha Tower', '2026-10-01', '2027-06-30', 5000000)).id::text);
select tests.logout();

select tests.login('b_owner');
select tests.set('company_b', (public.create_company('Media Bravo Builders')).id::text);
select tests.set('pb', (public.create_project('Media Bravo Mall', '2026-10-01', '2027-06-30', 1000000)).id::text);
select tests.logout();

insert into public.company_members (company_id, user_id, role) values
  (tests.id('company_a'), tests.uid('a_pm'), 'pm'),
  (tests.id('company_a'), tests.uid('a_insp'), 'inspector'),
  (tests.id('company_a'), tests.uid('a_pm2'), 'pm');
select tests.login('a_owner');
select public.add_project_member(tests.id('p1'), tests.uid('a_pm'), 'pm');
select public.add_project_member(tests.id('p1'), tests.uid('a_insp'), 'inspector');
select tests.logout();

-- Object names exactly as the media service generates them.
select tests.set('p1_main', tests.get('p1') || '/2026/10/' || gen_random_uuid() || '.webp');
select tests.set('p1_thumb', replace(tests.get('p1_main'), '.webp', '_thumb.webp'));
select tests.set('p1_insp', tests.get('p1') || '/2026/11/' || gen_random_uuid() || '.webp');
select tests.set('pb_main', tests.get('pb') || '/2026/10/' || gen_random_uuid() || '.webp');

-- ---------------------------------------------------------------------------
-- Owner PM: can upload and read under their project
-- ---------------------------------------------------------------------------
select tests.login('a_owner');
insert into storage.objects (bucket_id, name) values ('project-media', tests.get('p1_main'));
insert into storage.objects (bucket_id, name) values ('project-media', tests.get('p1_thumb'));
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 2::bigint, 'owner sees both objects');
-- Only names the service generates are accepted.
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('p1') || '/2026/10/photo.png'), '42501');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('p1') || '/' || gen_random_uuid() || '.webp'), '42501');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('p1') || '/2026/13/' || gen_random_uuid() || '.webp'), '42501');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    'not-a-uuid/2026/10/' || gen_random_uuid() || '.webp'), '42501');
-- ...and never in another company's project.
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('pb_main')), '42501');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Inspector on the project: can view and upload, cannot delete
-- ---------------------------------------------------------------------------
select tests.login('a_insp');
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 2::bigint, 'inspector sees project objects');
insert into storage.objects (bucket_id, name) values ('project-media', tests.get('p1_insp'));
select set_config('storage.allow_delete_query', 'true', true);
with gone as (delete from storage.objects where bucket_id = 'project-media' returning 1)
select tests.eq((select count(*) from gone), 0::bigint, 'inspector cannot delete');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Same-company PM who is not on the project, and a rival company: nothing
-- ---------------------------------------------------------------------------
select tests.login('a_pm2');
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 0::bigint, 'non-member PM sees nothing');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('p1') || '/2026/10/' || gen_random_uuid() || '.webp'), '42501');
select tests.logout();

select tests.login('b_owner');
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 0::bigint, 'rival sees nothing');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''project-media'', %L)',
                                    tests.get('p1') || '/2026/10/' || gen_random_uuid() || '.webp'), '42501');
-- The rival can of course use their own project.
insert into storage.objects (bucket_id, name) values ('project-media', tests.get('pb_main'));
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 1::bigint, 'rival sees only their own object');
select set_config('storage.allow_delete_query', 'true', true);
with gone as (delete from storage.objects where bucket_id = 'project-media'
                and name like tests.get('p1') || '/%' returning 1)
select tests.eq((select count(*) from gone), 0::bigint, 'rival cannot delete another company''s objects');
select tests.logout();

select tests.login('a_owner');
select tests.eq((select count(*) from storage.objects where bucket_id = 'project-media'), 3::bigint, 'owner sees 3 objects, not the rival''s');
select tests.logout();

-- ---------------------------------------------------------------------------
-- Project PM and Owner PM can delete
-- ---------------------------------------------------------------------------
select tests.login('a_pm');
select set_config('storage.allow_delete_query', 'true', true);
with gone as (delete from storage.objects where bucket_id = 'project-media'
                and name = tests.get('p1_insp') returning 1)
select tests.eq((select count(*) from gone), 1::bigint, 'project PM deletes');
select tests.logout();

select tests.login('a_owner');
select set_config('storage.allow_delete_query', 'true', true);
with gone as (delete from storage.objects where bucket_id = 'project-media' returning 1)
select tests.eq((select count(*) from gone), 2::bigint, 'owner PM deletes the rest of their project');
select tests.logout();

-- The avatars bucket is unaffected: a project path is not a user folder.
select tests.login('a_owner');
select tests.expect_sqlstate(format('insert into storage.objects (bucket_id, name) values (''avatars'', %L)',
                                    tests.get('p1_main')), '42501');
select tests.logout();

select '10_project_media_storage: all assertions passed' as result;
rollback;
