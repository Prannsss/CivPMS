-- Email invitations (spec §4.4) and inspector invite codes (D11).
-- Tokens: 32 random bytes as 64 lowercase hex chars, returned once; only the
-- sha256 hex digest is stored. One company per user (D13).

create or replace function private.new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(32), 'hex');
$$;

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'), 'hex');
$$;

-- The caller's sign-in email (lowercase), from auth.users.
create or replace function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select lower(u.email) from auth.users u where u.id = (select auth.uid())),
    lower((select auth.jwt()) ->> 'email'));
$$;

create or replace function private.normalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' or char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform private.raise_error('VALIDATION', 'Enter a valid email address, like name@company.com.', 'email');
  end if;
  return v_email;
end;
$$;

-- Validates that an email may be invited to a project; returns the invitee's
-- user id when an account exists.
create or replace function private.check_invitee(p_project_id uuid, p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_invitee uuid;
  v_invitee_company uuid;
begin
  select p.company_id into v_company_id from public.projects p where p.id = p_project_id;
  if p_email = private.my_email() then
    perform private.raise_error('CANNOT_INVITE_SELF', 'That is your own email. Enter the email of the person you want to invite.', 'email');
  end if;
  select pr.id into v_invitee from public.profiles pr where pr.email = p_email limit 1;
  if v_invitee is null then
    return null;
  end if;
  select cm.company_id into v_invitee_company from public.company_members cm where cm.user_id = v_invitee;
  if v_invitee_company is not null and v_invitee_company <> v_company_id then
    perform private.raise_error('INVITEE_IN_OTHER_COMPANY', 'This person already belongs to another company.', 'email');
  end if;
  if exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = v_invitee) then
    perform private.raise_error('ALREADY_MEMBER', 'This person is already on the project.', 'email');
  end if;
  return v_invitee;
end;
$$;

-- Shared result for invite_to_project/resend_invitation; notifies existing users.
create or replace function private.invitation_result(p_invitation public.invitations, p_token text, p_resent boolean, p_invitee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_name text;
  v_company_name text;
  v_inviter_name text := private.profile_name(p_invitation.invited_by);
begin
  select p.name into v_project_name from public.projects p where p.id = p_invitation.project_id;
  select c.name into v_company_name from public.companies c where c.id = p_invitation.company_id;
  if p_invitee is not null then
    perform private.notify(p_invitee, 'invitation_received',
      format('Invitation to %s', v_project_name),
      format('%s invited you to join "%s" at %s as %s. Open CivPMS to accept or decline.',
             v_inviter_name, v_project_name, v_company_name, private.status_label(p_invitation.role::text)),
      '/',
      jsonb_build_object('invitation_id', p_invitation.id, 'project_name', v_project_name,
                         'company_name', v_company_name, 'role', p_invitation.role,
                         'inviter_name', v_inviter_name, 'expires_at', p_invitation.expires_at),
      null, null);
  end if;
  return jsonb_build_object(
    'invitation_id', p_invitation.id,
    'token', p_token,
    'resent', p_resent,
    'existing_user', p_invitee is not null,
    'email', p_invitation.email,
    'role', p_invitation.role,
    'company_name', v_company_name,
    'project_name', v_project_name,
    'inviter_name', v_inviter_name,
    'expires_at', p_invitation.expires_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Email invitations
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_project(p_project_id uuid, p_email text, p_role public.project_role)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text;
  v_project public.projects;
  v_invitee uuid;
  v_inv public.invitations;
  v_token text := private.new_token();
  v_resent boolean := false;
begin
  perform private.assert_can_manage_project(p_project_id);
  if p_role is null then
    perform private.raise_error('VALIDATION', 'Choose PM or Inspector.', 'role');
  end if;
  v_email := private.normalize_email(p_email);
  select * into v_project from public.projects where id = p_project_id;
  v_invitee := private.check_invitee(p_project_id, v_email);

  select * into v_inv from public.invitations
   where project_id = p_project_id and email = v_email and status = 'pending'
   for update;
  if found then
    update public.invitations
       set token_hash = private.token_hash(v_token),
           expires_at = now() + interval '7 days',
           role = p_role,
           invited_by = v_uid
     where id = v_inv.id
    returning * into v_inv;
    v_resent := true;
  else
    insert into public.invitations (company_id, project_id, email, role, invited_by, token_hash)
    values (v_project.company_id, p_project_id, v_email, p_role, v_uid, private.token_hash(v_token))
    returning * into v_inv;
  end if;
  return private.invitation_result(v_inv, v_token, v_resent, v_invitee);
end;
$$;

create or replace function public.resend_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.invitations;
  v_other public.invitations;
  v_invitee uuid;
  v_token text := private.new_token();
begin
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This invitation does not exist.', 'invitation_id');
  end if;
  perform private.assert_can_manage_project(v_inv.project_id);
  if v_inv.status not in ('pending', 'expired') then
    perform private.raise_error('INVITE_NOT_PENDING', format('This invitation was already %s. Send a new invitation instead.', v_inv.status), 'invitation_id');
  end if;
  v_invitee := private.check_invitee(v_inv.project_id, v_inv.email);
  if v_inv.status = 'expired' then
    select * into v_other from public.invitations
     where project_id = v_inv.project_id and email = v_inv.email and status = 'pending' and id <> v_inv.id
     for update;
    if found then
      v_inv := v_other;
    end if;
  end if;
  update public.invitations
     set status = 'pending',
         token_hash = private.token_hash(v_token),
         expires_at = now() + interval '7 days',
         invited_by = v_uid,
         responded_at = null
   where id = v_inv.id
  returning * into v_inv;
  return private.invitation_result(v_inv, v_token, true, v_invitee);
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  perform private.require_uid();
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This invitation does not exist.', 'invitation_id');
  end if;
  perform private.assert_can_manage_project(v_inv.project_id);
  if v_inv.status <> 'pending' then
    perform private.raise_error('INVITE_NOT_PENDING', format('This invitation was already %s.', v_inv.status), 'invitation_id');
  end if;
  update public.invitations set status = 'revoked', responded_at = now() where id = v_inv.id;
end;
$$;

-- Pending, unexpired invitations addressed to the caller's sign-in email.
create or replace function public.my_pending_invitations()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  project_id uuid,
  project_name text,
  role public.project_role,
  inviter_name text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.company_id, c.name, i.project_id, p.name, i.role,
         coalesce(pr.full_name, pr.email, 'A project manager'), i.expires_at, i.created_at
    from public.invitations i
    join public.companies c on c.id = i.company_id
    join public.projects p on p.id = i.project_id and p.deleted_at is null
    left join public.profiles pr on pr.id = i.invited_by
   where i.status = 'pending'
     and i.expires_at > now()
     and i.email = private.my_email()
   order by i.created_at desc;
$$;

-- Invite landing page preview (callable by anon): no ids, masked email.
create or replace function public.get_invitation_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_project public.projects;
  v_company_name text;
  v_expired boolean;
begin
  if p_token is null or lower(btrim(p_token)) !~ '^[0-9a-f]{64}$' then
    perform private.raise_error('NOT_FOUND', 'This invitation link is not valid. Ask the person who invited you to send a new one.', 'token');
  end if;
  select * into v_inv from public.invitations where token_hash = private.token_hash(p_token);
  if not found then
    perform private.raise_error('NOT_FOUND', 'This invitation link is not valid. Ask the person who invited you to send a new one.', 'token');
  end if;
  select * into v_project from public.projects where id = v_inv.project_id;
  select c.name into v_company_name from public.companies c where c.id = v_inv.company_id;
  v_expired := v_inv.status = 'expired' or (v_inv.status = 'pending' and v_inv.expires_at <= now());
  return jsonb_build_object(
    'company_name', v_company_name,
    'project_name', v_project.name,
    'role', v_inv.role,
    'inviter_name', private.profile_name(v_inv.invited_by),
    'email_hint', private.mask_email(v_inv.email),
    'status', case when v_expired then 'expired' else v_inv.status::text end,
    'expired', v_expired,
    'expires_at', v_inv.expires_at,
    'project_available', v_project.deleted_at is null);
end;
$$;

-- Find an invitation by token or id for the caller. Wrong-email access by id
-- looks like NOT_FOUND; by token it explains the mismatch.
create or replace function private.lock_my_invitation(p_token text, p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_email text := private.my_email();
begin
  if p_token is null and p_invitation_id is null then
    perform private.raise_error('VALIDATION', 'Open the invitation link again, or pick the invitation from your list.', 'token');
  end if;
  if p_invitation_id is not null then
    select * into v_inv from public.invitations where id = p_invitation_id for update;
  else
    select * into v_inv from public.invitations where token_hash = private.token_hash(p_token) for update;
  end if;
  if not found or (p_invitation_id is not null and v_inv.email is distinct from v_email) then
    perform private.raise_error('NOT_FOUND', 'This invitation does not exist. Ask the person who invited you to send a new one.', 'token');
  end if;
  if v_inv.email is distinct from v_email then
    perform private.raise_error('INVITE_EMAIL_MISMATCH',
      format('This invitation was sent to %s. Sign in with that email to accept it.', private.mask_email(v_inv.email)), 'email');
  end if;
  return v_inv;
end;
$$;

create or replace function public.accept_invitation(p_token text default null, p_invitation_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.invitations;
  v_project public.projects;
  v_company_name text;
  v_current public.company_members;
  v_new_role public.company_role;
begin
  v_inv := private.lock_my_invitation(p_token, p_invitation_id);
  if v_inv.status = 'expired' or (v_inv.status = 'pending' and v_inv.expires_at <= now()) then
    perform private.raise_error('INVITE_EXPIRED',
      format('This invitation expired. Ask %s to send a new one.', private.profile_name(v_inv.invited_by)), 'token');
  end if;
  if v_inv.status <> 'pending' then
    perform private.raise_error('INVITE_NOT_PENDING', format('This invitation was already %s.', v_inv.status), 'token');
  end if;
  select * into v_project from public.projects where id = v_inv.project_id;
  if v_project.deleted_at is not null then
    perform private.raise_error('NOT_FOUND', 'The project for this invitation is no longer available.', 'token');
  end if;
  select c.name into v_company_name from public.companies c where c.id = v_inv.company_id;

  select * into v_current from public.company_members where user_id = v_uid for update;
  if found and v_current.company_id <> v_inv.company_id then
    perform private.raise_error('INVITEE_IN_OTHER_COMPANY',
      'You already belong to another company. An account can only belong to one company.', 'token');
  end if;

  perform set_config('pms.via', 'invitation', true);
  v_new_role := v_inv.role::text::public.company_role;
  if v_current.id is null then
    insert into public.company_members (company_id, user_id, role)
    values (v_inv.company_id, v_uid, v_new_role);
  elsif private.company_role_rank(v_new_role) > private.company_role_rank(v_current.role) then
    update public.company_members set role = v_new_role where id = v_current.id;
  end if;

  insert into public.project_members as pm (project_id, user_id, role, invited_by)
  values (v_inv.project_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (project_id, user_id) do update
    set role = case when pm.role = 'pm' or excluded.role = 'pm'
                    then 'pm'::public.project_role else 'inspector'::public.project_role end;

  update public.invitations
     set status = 'accepted', responded_at = now(), accepted_by = v_uid
   where id = v_inv.id;
  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now()),
         role_pref = coalesce(role_pref, v_inv.role::text)
   where id = v_uid;

  if v_inv.invited_by is not null and v_inv.invited_by <> v_uid then
    perform private.notify(v_inv.invited_by, 'invitation_accepted',
      format('%s joined %s', private.profile_name(v_uid), v_project.name),
      format('%s accepted your invitation to "%s" as %s.',
             private.profile_name(v_uid), v_project.name, private.status_label(v_inv.role::text)),
      format('/projects/%s/collaborators', v_project.id),
      jsonb_build_object('invitation_id', v_inv.id, 'user_id', v_uid, 'project_name', v_project.name, 'role', v_inv.role),
      v_project.id, v_inv.company_id);
  end if;
  perform set_config('pms.via', '', true);

  return jsonb_build_object(
    'company_id', v_inv.company_id,
    'project_id', v_inv.project_id,
    'company_name', v_company_name,
    'project_name', v_project.name,
    'role', v_inv.role);
end;
$$;

create or replace function public.decline_invitation(p_invitation_id uuid default null, p_token text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.invitations;
  v_project_name text;
begin
  v_inv := private.lock_my_invitation(p_token, p_invitation_id);
  if v_inv.status <> 'pending' then
    perform private.raise_error('INVITE_NOT_PENDING', format('This invitation was already %s.', v_inv.status), 'invitation_id');
  end if;
  update public.invitations set status = 'declined', responded_at = now() where id = v_inv.id;
  select p.name into v_project_name from public.projects p where p.id = v_inv.project_id;
  if v_inv.invited_by is not null and v_inv.invited_by <> v_uid then
    perform private.notify(v_inv.invited_by, 'invitation_declined',
      format('%s declined your invitation', v_inv.email),
      format('%s declined your invitation to "%s".', private.profile_name(v_uid), v_project_name),
      format('/projects/%s/collaborators', v_inv.project_id),
      jsonb_build_object('invitation_id', v_inv.id, 'project_name', v_project_name),
      v_inv.project_id, v_inv.company_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite codes (inspectors). Format XXXX-XXXX, Crockford base32 alphabet.
-- ---------------------------------------------------------------------------
create or replace function private.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  for i in 0..7 loop
    v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i = 3 then
      v_code := v_code || '-';
    end if;
  end loop;
  return v_code;
end;
$$;

-- Uppercase, strip spaces/dashes, map O→0 and I/L→1, re-insert the dash.
create or replace function private.normalize_invite_code(p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := translate(upper(regexp_replace(coalesce(p_code, ''), '[\s-]+', '', 'g')), 'OIL', '011');
begin
  if v !~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    return null;
  end if;
  return substr(v, 1, 4) || '-' || substr(v, 5, 4);
end;
$$;

create or replace function private.invite_code_message(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'INVALID_CODE' then 'This code is not valid. Check it with your Project Manager; codes look like ABCD-2345.'
    when 'CODE_EXPIRED' then 'This code has expired. Ask your Project Manager for a new one.'
    when 'CODE_REVOKED' then 'This code was turned off by your Project Manager. Ask them for a new one.'
    when 'CODE_EXHAUSTED' then 'This code has reached its usage limit. Ask your Project Manager for a new one.'
    else null end;
$$;

-- Max 10 failed attempts per user per rolling hour.
create or replace function private.assert_code_rate_limit(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures integer;
  v_oldest timestamptz;
  v_minutes integer;
begin
  select count(*), min(a.attempted_at) into v_failures, v_oldest
    from public.invite_code_attempts a
   where a.user_id = p_uid and not a.success and a.attempted_at > now() - interval '1 hour';
  if v_failures >= 10 then
    v_minutes := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())) / 60)::integer);
    perform private.raise_error('RATE_LIMITED',
      format('Too many incorrect codes. Try again in %s minute(s), or ask your Project Manager for the code.', v_minutes), 'code');
  end if;
end;
$$;

-- Why a code cannot be used right now (NULL = usable).
create or replace function private.invite_code_problem(p_code public.invite_codes)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_code.id is null then 'INVALID_CODE'
    when p_code.project_id is not null
         and not exists (select 1 from public.projects p where p.id = p_code.project_id and p.deleted_at is null) then 'INVALID_CODE'
    when p_code.revoked_at is not null then 'CODE_REVOKED'
    when p_code.expires_at is not null and p_code.expires_at <= now() then 'CODE_EXPIRED'
    when p_code.max_uses is not null and p_code.use_count >= p_code.max_uses then 'CODE_EXHAUSTED'
    else null end;
$$;

create or replace function public.create_invite_code(
  p_project_id uuid default null,
  p_expires_in_days integer default null,
  p_max_uses integer default null
)
returns public.invite_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_company_id uuid;
  v_code text;
  v_row public.invite_codes;
begin
  if p_project_id is null then
    v_company_id := private.pm_company_id();
    if v_company_id is null then
      perform private.raise_error('FORBIDDEN', 'Only PMs can create company-wide invite codes.');
    end if;
  else
    perform private.assert_can_manage_project(p_project_id);
    select p.company_id into v_company_id from public.projects p where p.id = p_project_id;
  end if;
  if p_expires_in_days is not null and (p_expires_in_days < 1 or p_expires_in_days > 365) then
    perform private.raise_error('VALIDATION', 'Expiry must be between 1 and 365 days.', 'expires_in_days');
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    perform private.raise_error('VALIDATION', 'Maximum uses must be between 1 and 1,000.', 'max_uses');
  end if;
  for i in 1..20 loop
    v_code := private.generate_invite_code();
    exit when not exists (select 1 from public.invite_codes c where c.code = v_code);
  end loop;
  insert into public.invite_codes (company_id, project_id, code, expires_at, max_uses, created_by)
  values (v_company_id, p_project_id, v_code,
          case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end,
          p_max_uses, v_uid)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.revoke_invite_code(p_id uuid)
returns public.invite_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.invite_codes;
begin
  perform private.require_uid();
  select * into v_row from public.invite_codes where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'This invite code does not exist.', 'id');
  end if;
  if v_row.project_id is null then
    if private.pm_company_id() is distinct from v_row.company_id then
      if private.is_company_member(v_row.company_id) then
        perform private.raise_error('FORBIDDEN', 'Only PMs can turn off company-wide invite codes.');
      end if;
      perform private.raise_error('NOT_FOUND', 'This invite code does not exist.', 'id');
    end if;
  else
    perform private.assert_can_manage_project(v_row.project_id);
  end if;
  if v_row.revoked_at is null then
    update public.invite_codes set revoked_at = now() where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- Onboarding preview: counts as an attempt (rate limited). Names are only
-- revealed for usable codes.
create or replace function public.preview_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_norm text := private.normalize_invite_code(p_code);
  v_code public.invite_codes;
  v_reason text;
  v_company_name text;
  v_project_name text;
begin
  perform private.assert_code_rate_limit(v_uid);
  if v_norm is not null then
    select * into v_code from public.invite_codes where code = v_norm;
  end if;
  v_reason := private.invite_code_problem(v_code);
  insert into public.invite_code_attempts (user_id, success) values (v_uid, v_reason is null);
  if v_reason is not null then
    return jsonb_build_object('valid', false, 'reason', v_reason, 'message', private.invite_code_message(v_reason),
                              'code', v_norm, 'company_name', null, 'project_name', null, 'scope', null);
  end if;
  select c.name into v_company_name from public.companies c where c.id = v_code.company_id;
  select p.name into v_project_name from public.projects p where p.id = v_code.project_id;
  return jsonb_build_object('valid', true, 'reason', null, 'message', null, 'code', v_code.code,
                            'company_name', v_company_name, 'project_name', v_project_name,
                            'scope', case when v_code.project_id is null then 'company' else 'project' end);
end;
$$;

-- Redeem a code. Code problems are RETURNED (ok = false, error_code) instead of
-- raised so the failed attempt is committed for rate limiting.
create or replace function public.redeem_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_norm text := private.normalize_invite_code(p_code);
  v_code public.invite_codes;
  v_reason text;
  v_current public.company_members;
  v_changed boolean := false;
  v_company_name text;
  v_project_name text;
begin
  perform private.assert_code_rate_limit(v_uid);
  if v_norm is not null then
    select * into v_code from public.invite_codes where code = v_norm for update;
  end if;
  v_reason := private.invite_code_problem(v_code);
  if v_reason is not null then
    insert into public.invite_code_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error_code', v_reason, 'error_message', private.invite_code_message(v_reason),
                              'company_id', null, 'project_id', null, 'company_name', null, 'project_name', null,
                              'already_member', false);
  end if;

  select * into v_current from public.company_members where user_id = v_uid for update;
  if found and v_current.company_id <> v_code.company_id then
    perform private.raise_error('INVITEE_IN_OTHER_COMPANY',
      'You already belong to another company. An account can only belong to one company.', 'code');
  end if;

  perform set_config('pms.via', 'invite_code', true);
  if v_current.id is null then
    insert into public.company_members (company_id, user_id, role) values (v_code.company_id, v_uid, 'inspector');
    v_changed := true;
  end if;
  if v_code.project_id is not null
     and not exists (select 1 from public.project_members pm
                      where pm.project_id = v_code.project_id and pm.user_id = v_uid) then
    insert into public.project_members (project_id, user_id, role, invited_by)
    values (v_code.project_id, v_uid, 'inspector', v_code.created_by);
    v_changed := true;
  end if;
  if v_changed then
    update public.invite_codes set use_count = use_count + 1 where id = v_code.id;
  end if;
  insert into public.invite_code_attempts (user_id, success) values (v_uid, true);
  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now()),
         role_pref = coalesce(role_pref, 'inspector')
   where id = v_uid;

  select c.name into v_company_name from public.companies c where c.id = v_code.company_id;
  select p.name into v_project_name from public.projects p where p.id = v_code.project_id;
  if v_changed and v_code.created_by is not null and v_code.created_by <> v_uid then
    perform private.notify(v_code.created_by, 'member_joined',
      format('%s joined with your invite code', private.profile_name(v_uid)),
      format('%s joined %s using code %s.', private.profile_name(v_uid),
             coalesce('"' || v_project_name || '"', v_company_name), v_code.code),
      case when v_code.project_id is null then '/settings'
           else format('/projects/%s/collaborators', v_code.project_id) end,
      jsonb_build_object('user_id', v_uid, 'code', v_code.code, 'project_name', v_project_name, 'company_name', v_company_name),
      v_code.project_id, v_code.company_id);
  end if;
  perform set_config('pms.via', '', true);

  return jsonb_build_object('ok', true, 'error_code', null, 'error_message', null,
                            'company_id', v_code.company_id, 'project_id', v_code.project_id,
                            'company_name', v_company_name, 'project_name', v_project_name,
                            'already_member', not v_changed);
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.invite_to_project(uuid, text, public.project_role),
  public.resend_invitation(uuid),
  public.revoke_invitation(uuid),
  public.my_pending_invitations(),
  public.get_invitation_by_token(text),
  public.accept_invitation(text, uuid),
  public.decline_invitation(uuid, text),
  public.create_invite_code(uuid, integer, integer),
  public.revoke_invite_code(uuid),
  public.preview_invite_code(text),
  public.redeem_invite_code(text)
to authenticated, service_role;
-- The invite landing page shows context before sign-in.
grant execute on function public.get_invitation_by_token(text) to anon;
