-- CivPMS e2e accounts for the WBS + calendar specs (e2e/f4-*.spec.ts). See supabase/seed/README.md.
--
-- * Creates three confirmed email/password accounts on the reserved @civpms.test domain:
--     f4-owner@civpms.test      -> Owner PM of "[F4] WBS Lab Builders" (set up by e2e/f4-tenant.ts)
--     f4-pm@civpms.test         -> project PM on "[F4] WBS Lab" (joins by email invitation)
--     f4-inspector@civpms.test  -> inspector on "[F4] WBS Lab" (joins by email invitation)
--   Everything else is created by the specs through the app's RPCs, so they never touch demo data.
-- * Idempotent. Passwords: `civpms.demo_password` when set (same as demo.sql):
--       select set_config('civpms.demo_password', '<DEMO_PASSWORD from .env.local>', false);
--   otherwise the password hash of owner@civpms.test is reused, so the plaintext never has to be typed.
-- * Removed by demo-cleanup.sql together with every other @civpms.test account.

begin;

do $f4$
declare
  c_pw constant text := nullif(current_setting('civpms.demo_password', true), '');
  c_emails constant text[] := array['f4-owner@civpms.test', 'f4-pm@civpms.test', 'f4-inspector@civpms.test'];
  v_email text;
  v_uid uuid;
  v_hash text;
begin
  if c_pw is not null and char_length(c_pw) < 10 then
    raise exception 'The demo password needs 10+ characters.';
  end if;
  if c_pw is null then
    select u.encrypted_password into v_hash from auth.users u where u.email = 'owner@civpms.test';
    if v_hash is null then
      raise exception 'Set the demo password first: select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false);';
    end if;
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
        coalesce(v_hash, extensions.crypt(c_pw, extensions.gen_salt('bf', 10))), now(),
        '', '', '', '', '', '', '', '',
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
        now(), now(), false, false);
      raise notice 'created account %', v_email;
    else
      update auth.users
         set encrypted_password = coalesce(v_hash, extensions.crypt(c_pw, extensions.gen_salt('bf', 10))),
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
$f4$;

commit;

select u.email, u.email_confirmed_at is not null as confirmed, p.onboarded_at is not null as onboarded
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.email in ('f4-owner@civpms.test', 'f4-pm@civpms.test', 'f4-inspector@civpms.test')
 order by u.email;
