-- CivPMS e2e accounts for the auth/onboarding specs (e2e/f1-*.spec.ts). See supabase/seed/README.md.
--
-- Onboarding is one-way (a finished account stays onboarded), so the specs need fresh accounts on
-- every run. This script creates a pool of confirmed, NOT onboarded email/password accounts on the
-- reserved @civpms.test domain:
--     f1-pool-01@civpms.test … f1-pool-NN@civpms.test   (NN = civpms.f1_pool_size, default 60)
--     f1-owner@civpms.test     -> becomes Owner PM of "[F1] Invitations Co." (set up by the specs)
-- Each spec run takes the next accounts that are still not onboarded (about 6 per run). When the
-- pool runs out the specs skip with a message: run this script again with a bigger pool size,
--       select set_config('civpms.f1_pool_size', '80', false);
-- Everything else (profiles, companies, projects, codes, invitations) is created by the specs
-- through the app's RPCs and tagged "[F1]".
--
-- * Idempotent: existing accounts keep their data; only the password is reset.
-- * Password = civpms.demo_password (same as demo.sql and found-e2e.sql):
--       select set_config('civpms.demo_password', '<DEMO_PASSWORD from .env.local>', false);
-- * Removed by demo-cleanup.sql together with every other @civpms.test account.

begin;

do $f1$
declare
  c_pw constant text := current_setting('civpms.demo_password', true);
  c_size constant int := coalesce(nullif(current_setting('civpms.f1_pool_size', true), '')::int, 60);
  v_emails text[] := array['f1-owner@civpms.test'];
  v_email text;
  v_uid uuid;
begin
  if c_pw is null or char_length(c_pw) < 10 then
    raise exception 'Set the demo password first (10+ characters): select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false);';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;
  if c_size < 1 or c_size > 500 then
    raise exception 'civpms.f1_pool_size must be between 1 and 500.';
  end if;

  for i in 1..c_size loop
    v_emails := v_emails || format('f1-pool-%s@civpms.test', lpad(i::text, 2, '0'));
  end loop;

  foreach v_email in array v_emails loop
    select u.id into v_uid from auth.users u where lower(u.email) = v_email and u.is_sso_user = false;
    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
      values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
        extensions.crypt(c_pw, extensions.gen_salt('bf', 10)), now(),
        '', '', '', '', '', '', '', '',
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
        now(), now(), false, false);
    else
      update auth.users
         set encrypted_password = extensions.crypt(c_pw, extensions.gen_salt('bf', 10)),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
    end if;
    if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'email') then
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid::text, v_uid,
              jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
              'email', null, now(), now());
    end if;
    v_uid := null;
  end loop;
end
$f1$;

commit;

select count(*) filter (where p.onboarded_at is null) as fresh_pool_accounts,
       count(*) as pool_accounts
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.email like 'f1-pool-%@civpms.test';
