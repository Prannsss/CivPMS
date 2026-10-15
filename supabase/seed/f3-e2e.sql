-- CivPMS e2e accounts for the project-workspace specs (e2e/f3-*.spec.ts). See supabase/seed/README.md.
--
-- * Creates three confirmed email/password accounts on the reserved @civpms.test domain:
--     f3-owner@civpms.test      -> Owner PM of "[F3] Workspace QA" (set up by e2e/helpers/f3-tenant.ts)
--     f3-pm@civpms.test         -> company PM (joins through an email invitation)
--     f3-inspector@civpms.test  -> inspector (joins with a company invite code)
--   Everything else (profiles, company, projects, codes, invitations) is created by the specs
--   themselves through the app's RPCs, so they are re-runnable and never touch the demo tenant.
-- * Idempotent. Re-running resets the passwords to `civpms.demo_password` (same as demo.sql):
--       select set_config('civpms.demo_password', '<DEMO_PASSWORD from .env.local>', false);
-- * Removed by demo-cleanup.sql together with every other @civpms.test account.

begin;

do $f3$
declare
  c_pw constant text := current_setting('civpms.demo_password', true);
  c_emails constant text[] := array['f3-owner@civpms.test', 'f3-pm@civpms.test', 'f3-inspector@civpms.test'];
  v_email text;
  v_uid uuid;
begin
  if c_pw is null or char_length(c_pw) < 10 then
    raise exception 'Set the demo password first (10+ characters): select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false);';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;

  foreach v_email in array c_emails loop
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
      raise notice 'created account %', v_email;
    else
      update auth.users
         set encrypted_password = extensions.crypt(c_pw, extensions.gen_salt('bf', 10)),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
      raise notice 'reset password of %', v_email;
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
$f3$;

commit;

select u.email, u.email_confirmed_at is not null as confirmed, p.onboarded_at is not null as onboarded
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.email in ('f3-owner@civpms.test', 'f3-pm@civpms.test', 'f3-inspector@civpms.test')
 order by u.email;
