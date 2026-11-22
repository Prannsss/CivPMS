-- CivPMS golden-path accounts for e2e/final-golden-path.spec.ts. See supabase/seed/README.md.
--
-- * Creates three confirmed, NOT onboarded email/password accounts for one QA run:
--     qa-<stamp>-pm@civpms.test         -> onboards as PM and creates "[QA] <stamp>"
--     qa-<stamp>-inspector@civpms.test  -> accepts the PM's email invitation (inspector)
--     qa-<stamp>-rival@civpms.test      -> another company; must never see the QA project
--   Everything else (company, project, WBS, calendar, invitation) is created by the spec through
--   the app's UI, so the run exercises the real golden path.
-- * The stamp comes from the session setting `civpms.qa_stamp` (10–14 digits, e.g. 1016074512):
--       select set_config('civpms.qa_stamp', '1016074512', false);
--   Use the same value as QA_STAMP when running the spec.
-- * Password: `civpms.demo_password` when set (same as demo.sql); otherwise the password hash of
--   owner@civpms.test is copied, so agents never have to send the password itself.
-- * Removed by demo-cleanup.sql together with every other @civpms.test account.

begin;

do $qa$
declare
  c_stamp constant text := current_setting('civpms.qa_stamp', true);
  c_pw constant text := current_setting('civpms.demo_password', true);
  v_hash text;
  v_email text;
  v_uid uuid;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;
  if c_stamp is null or c_stamp !~ '^[0-9]{10,14}$' then
    raise exception 'Set the run stamp first: select set_config(''civpms.qa_stamp'', ''<10-14 digits>'', false);';
  end if;
  if c_pw is not null and char_length(c_pw) >= 10 then
    v_hash := extensions.crypt(c_pw, extensions.gen_salt('bf', 10));
  else
    select u.encrypted_password into v_hash from auth.users u where lower(u.email) = 'owner@civpms.test';
  end if;
  if v_hash is null or v_hash = '' then
    raise exception 'Set the demo password first (10+ characters): select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false); or run demo.sql.';
  end if;

  foreach v_email in array array[
    format('qa-%s-pm@civpms.test', c_stamp),
    format('qa-%s-inspector@civpms.test', c_stamp),
    format('qa-%s-rival@civpms.test', c_stamp)] loop
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
        v_hash, now(),
        '', '', '', '', '', '', '', '',
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
        now(), now(), false, false);
      raise notice 'created account %', v_email;
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
$qa$;

commit;
