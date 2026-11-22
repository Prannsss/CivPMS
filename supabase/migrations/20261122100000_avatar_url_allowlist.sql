-- B-10 (docs/ROADMAP.md, HANDOFF §4): profiles.avatar_url may only point at
--   * this project's public `avatars` bucket, inside the profile owner's own folder
--     (`<supabase url>/storage/v1/object/public/avatars/<uid>/<file>`), or
--   * a Google profile-photo host (`https://lh3…lh6.googleusercontent.com/…`, Google sign-in).
-- Any other https link would load in teammates' browsers (member lists, menus) and leak their IP
-- addresses and when they looked to whoever runs that server.
--
-- Three ways in, one rule:
--   1. `update_profile` (the app's path) — friendly VALIDATION error.
--   2. direct `update public.profiles set avatar_url = …` (column grant) — the trigger below.
--   3. Auth user metadata (`raw_user_meta_data.avatar_url` / `picture`), which any user can set at
--      sign-up or later with `auth.updateUser({ data })` — `handle_auth_user_change` keeps Google
--      photos only and drops anything else (it never fails a sign-up).
-- The bucket host is the caller's own Supabase URL, read from the JWT issuer
-- (`https://<ref>.supabase.co/auth/v1`), so the rule follows the project (prod, staging, custom
-- domain) without a hard-coded ref. Requests without user claims (migrations, seeds, service role)
-- are trusted and skip the check. Also: "Log out and log in again" wording (owner rule 2026-11-22).

-- Google profile photos: https://lh3.googleusercontent.com/a/ACg8…=s96-c
create or replace function private.is_google_avatar_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url ~ '^https://lh[3-6]\.googleusercontent\.com/[A-Za-z0-9._~/=+-]+$';
$$;

-- True when p_url may be stored as p_uid's avatar (null clears it and is always allowed).
create or replace function private.avatar_url_allowed(p_url text, p_uid uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text;
  v_prefix text;
begin
  if p_url is null then
    return true;
  end if;
  if char_length(p_url) > 2048 then
    return false;
  end if;
  if private.is_google_avatar_url(p_url) then
    return true;
  end if;
  v_base := substring(coalesce(auth.jwt() ->> 'iss', '') from '^(https://[a-z0-9.-]+)/auth/v1$');
  if v_base is null or p_uid is null then
    return false;
  end if;
  v_prefix := v_base || '/storage/v1/object/public/avatars/' || p_uid::text || '/';
  return starts_with(p_url, v_prefix)
     and substr(p_url, char_length(v_prefix) + 1) ~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$';
end;
$$;

-- Table-level guard for direct updates (and any future write path) made with user claims.
create or replace function private.guard_profile_avatar_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.avatar_url is null
     or (tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url) then
    return new;
  end if;
  -- No user request (migration, seed, service role, the auth trigger): trusted.
  if coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if not private.avatar_url_allowed(new.avatar_url, new.id) then
    raise exception using
      errcode = '23514',
      message = 'VALIDATION',
      detail = 'Upload a photo instead of linking to one.',
      hint = 'avatar_url';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_avatar_url_guard on public.profiles;
create trigger profiles_avatar_url_guard
  before insert or update of avatar_url on public.profiles
  for each row execute function private.guard_profile_avatar_url();

create or replace function public.update_profile(p_patch jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_row public.profiles;
  v_name text;
  v_avatar text;
  v_unit text;
begin
  perform private.assert_patch_keys(p_patch, array['full_name', 'avatar_url', 'duration_unit']);
  select * into v_row from public.profiles where id = v_uid for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'Your profile was not found. Log out and log in again.');
  end if;

  if p_patch ? 'full_name' then
    v_name := private.clean_text(private.patch_text(p_patch, 'full_name'));
    if v_name is null then
      perform private.raise_error('VALIDATION', 'Enter your full name.', 'full_name');
    end if;
    if char_length(v_name) > 120 then
      perform private.raise_error('VALIDATION', 'Names can be up to 120 characters.', 'full_name');
    end if;
    v_row.full_name := v_name;
  end if;

  if p_patch ? 'avatar_url' then
    v_avatar := nullif(btrim(private.patch_text(p_patch, 'avatar_url')), '');
    if v_avatar is not null and v_avatar is distinct from v_row.avatar_url
       and not private.avatar_url_allowed(v_avatar, v_uid) then
      perform private.raise_error('VALIDATION', 'Upload a photo instead of linking to one.', 'avatar_url');
    end if;
    v_row.avatar_url := v_avatar;
  end if;

  if p_patch ? 'duration_unit' then
    v_unit := private.patch_text(p_patch, 'duration_unit');
    if v_unit is null or v_unit not in ('hours', 'days') then
      perform private.raise_error('VALIDATION', 'Choose Hours or Days.', 'duration_unit');
    end if;
    v_row.duration_unit := v_unit::public.duration_unit;
  end if;

  update public.profiles
     set full_name = v_row.full_name,
         avatar_url = v_row.avatar_url,
         duration_unit = v_row.duration_unit
   where id = v_uid
  returning * into v_row;
  return v_row;
end;
$$;

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
  -- User metadata is user-controlled: keep Google photos only (B-10).
  if not private.is_google_avatar_url(v_avatar) then
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

-- Wording only ("Sign out / sign in" -> "Log out / log in"), applied to the live definitions so
-- nothing else in these functions changes.
do $$
declare
  v_fn regprocedure;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array[
    'private.require_uid()'::regprocedure,
    'public.update_notification_prefs(jsonb)'::regprocedure,
    'public.complete_profile(text, text)'::regprocedure,
    'public.finish_onboarding_without_company()'::regprocedure,
    'private.lock_my_invitation(text, uuid)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_fn);
    v_new := replace(replace(replace(v_def,
      'Sign out and sign in again.', 'Log out and log in again.'),
      'Please sign in to continue.', 'Please log in to continue.'),
      'Sign in with that email to accept it.', 'Log in with that email to accept it.');
    if v_new = v_def then
      raise exception 'avatar_url_allowlist: no wording change in %', v_fn;
    end if;
    execute v_new;
  end loop;
end;
$$;
