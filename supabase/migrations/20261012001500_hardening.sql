-- Hardening after review of 0100–0700:
--   1. activity_logs: the only UPDATE allowed is ON DELETE SET NULL clearing a
--      foreign key whose referenced row is really gone (a plain
--      `update activity_logs set actor_id = null` by any role now fails).
--   2. Inviting the company's Owner PM to a project is ALREADY_MEMBER (they
--      already see every project).
--   3. profiles.avatar_url must be an https:// URL (the column is client-writable).
--   4. Objects created later in public are not granted to anon by default.

-- 1 -------------------------------------------------------------------------
create or replace function private.activity_logs_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fk constant text[] := array['company_id', 'project_id', 'activity_id', 'actor_id'];
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - c_fk) = (to_jsonb(old) - c_fk)
     and (new.company_id is not distinct from old.company_id
          or (new.company_id is null
              and not exists (select 1 from public.companies c where c.id = old.company_id)))
     and (new.project_id is not distinct from old.project_id
          or (new.project_id is null
              and not exists (select 1 from public.projects p where p.id = old.project_id)))
     and (new.activity_id is not distinct from old.activity_id
          or (new.activity_id is null
              and not exists (select 1 from public.activities a where a.id = old.activity_id)))
     and (new.actor_id is not distinct from old.actor_id
          or (new.actor_id is null
              and not exists (select 1 from public.profiles pr where pr.id = old.actor_id))) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'LOG_IMMUTABLE',
    detail = 'Activity log entries cannot be changed or deleted.',
    hint = '';
end;
$$;
revoke all on function private.activity_logs_append_only() from public, anon, authenticated;

-- 2 -------------------------------------------------------------------------
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
  v_invitee_role public.company_role;
begin
  select p.company_id into v_company_id from public.projects p where p.id = p_project_id;
  if p_email = private.my_email() then
    perform private.raise_error('CANNOT_INVITE_SELF', 'That is your own email. Enter the email of the person you want to invite.', 'email');
  end if;
  select pr.id into v_invitee from public.profiles pr where pr.email = p_email limit 1;
  if v_invitee is null then
    return null;
  end if;
  select cm.company_id, cm.role into v_invitee_company, v_invitee_role
    from public.company_members cm where cm.user_id = v_invitee;
  if v_invitee_company is not null and v_invitee_company <> v_company_id then
    perform private.raise_error('INVITEE_IN_OTHER_COMPANY', 'This person already belongs to another company.', 'email');
  end if;
  if v_invitee_role = 'owner_pm' then
    perform private.raise_error('ALREADY_MEMBER', 'This person is the Owner PM and already has access to every project.', 'email');
  end if;
  if exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = v_invitee) then
    perform private.raise_error('ALREADY_MEMBER', 'This person is already on the project.', 'email');
  end if;
  return v_invitee;
end;
$$;

-- 3 -------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_avatar_url_https_check check (avatar_url is null or avatar_url ~ '^https://');

create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_text(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120));
  v_avatar text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')), '');
begin
  if v_avatar is not null and (char_length(v_avatar) > 2048 or v_avatar !~ '^https://') then
    v_avatar := null;
  end if;
  insert into public.profiles as p (id, email, full_name, avatar_url)
  values (new.id, lower(new.email), v_name, v_avatar)
  on conflict (id) do update
    set email = excluded.email,
        -- never overwrite what the user chose in the app; only fill blanks
        full_name = coalesce(p.full_name, excluded.full_name),
        avatar_url = coalesce(p.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

-- 4 -------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
revoke all on all sequences in schema public from anon;

revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
-- 0800 ran the same blanket revoke after 0700 granted anon access to the invite
-- landing preview; restore it (the only anon-callable RPC).
grant execute on function public.get_invitation_by_token(text) to anon;
