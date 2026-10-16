-- CivPMS foundation: private schema, enums, shared helper functions.
-- Client-callable objects live in `public`; internal helpers live in `private`
-- (not exposed by the Data API).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Schemas and default privileges
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- RLS policies run as the calling role and call a few private.* helpers, so
-- `authenticated` needs USAGE on the schema (EXECUTE is granted per helper).
grant usage on schema private to authenticated;

-- New functions are not executable by PUBLIC/anon unless granted explicitly.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.company_role as enum ('owner_pm', 'pm', 'inspector');
create type public.project_role as enum ('pm', 'inspector');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type public.activity_status as enum ('not_started', 'ongoing', 'delayed', 'on_hold', 'completed');
create type public.weighting_basis as enum ('cost', 'hours');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'expired', 'revoked');
create type public.calendar_date_kind as enum ('holiday', 'override_nonworking', 'override_working');
create type public.duration_unit as enum ('hours', 'days');
create type public.project_color as enum ('blue', 'green', 'pink', 'purple', 'teal', 'graphite');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

-- Raise a stable, mappable application error (see docs/DATABASE.md).
create or replace function private.raise_error(p_code text, p_detail text, p_hint text default '')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_detail, ''),
    hint = coalesce(p_hint, '');
end;
$$;

-- Current user id or UNAUTHENTICATED.
create or replace function private.require_uid()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.raise_error('UNAUTHENTICATED', 'Please sign in to continue.');
  end if;
  return v_uid;
end;
$$;

-- Business "today" (Asia/Manila).
create or replace function private.manila_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- Case/whitespace-insensitive key used for unique names.
create or replace function private.name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')));
$$;

-- Collapse internal whitespace and trim (the stored form of names).
create or replace function private.clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '');
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Formatting helpers for human-readable log summaries and notifications
-- ---------------------------------------------------------------------------
create or replace function private.fmt_money(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—'
              else '₱' || btrim(to_char(p_value, 'FM999,999,999,999,990.00')) end;
$$;

create or replace function private.fmt_date(p_value date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—' else to_char(p_value, 'FMDD Mon YYYY') end;
$$;

create or replace function private.fmt_number(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—'
              else regexp_replace(regexp_replace(p_value::text, '(\.\d*?)0+$', '\1'), '\.$', '') end;
$$;

create or replace function private.fmt_hours(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—' else private.fmt_number(p_value) || ' h' end;
$$;

create or replace function private.fmt_text(p_value text, p_max integer default 60)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or btrim(p_value) = '' then '—'
              when char_length(p_value) > p_max then left(p_value, p_max - 1) || '…'
              else p_value end;
$$;

-- ISO weekdays (1 = Mon … 7 = Sun) as "Mon, Tue, Wed".
create or replace function private.fmt_days(p_days smallint[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select string_agg((array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[d], ', ' order by d)
       from (select distinct unnest(p_days) as d) s
      where d between 1 and 7),
    'none');
$$;

create or replace function private.status_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_value
    when 'not_started' then 'Not Started'
    when 'ongoing' then 'Ongoing'
    when 'delayed' then 'Delayed'
    when 'on_hold' then 'On-Hold'
    when 'completed' then 'Completed'
    when 'planning' then 'Planning'
    when 'active' then 'Active'
    when 'cancelled' then 'Cancelled'
    when 'owner_pm' then 'Owner PM'
    when 'pm' then 'PM'
    when 'inspector' then 'Inspector'
    when 'cost' then 'Cost'
    when 'hours' then 'Hours'
    else coalesce(initcap(replace(p_value, '_', ' ')), '—')
  end;
$$;

create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
  end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
