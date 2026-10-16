-- Notifications (spec §14): in-app rows + email outbox drained by a server job.
-- Rows are inserted only through private.notify(), which applies the user's
-- per-type preferences.

-- Catalog of notification types with defaults (used by the settings UI too).
create or replace function public.notification_catalog()
returns table (type text, label text, description text, in_app_default boolean, email_default boolean)
language sql
immutable
set search_path = ''
as $$
  values
    ('invitation_received', 'Invitation received', 'Someone invited you to a project.', true, true),
    ('invitation_accepted', 'Invitation accepted', 'Someone accepted an invitation you sent.', true, true),
    ('invitation_declined', 'Invitation declined', 'Someone declined an invitation you sent.', true, false),
    ('member_joined', 'Member joined with a code', 'Someone joined using an invite code you created.', true, false),
    ('added_to_project', 'Added to a project', 'A PM added you to a project.', true, false),
    ('removed_from_project', 'Removed from a project', 'You no longer have access to a project.', true, true),
    ('removed_from_company', 'Removed from the company', 'You were removed from your company.', true, true),
    ('project_budget_exceeded', 'Project over budget', 'Allocated cost went over a project''s budget.', true, true),
    ('project_delayed', 'Project delayed', 'A project passed its end date without being completed.', true, true),
    ('project_status_changed', 'Project status changed', 'A project you work on changed status.', true, false)
$$;

create or replace function private.notify(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_payload jsonb default '{}'::jsonb,
  p_project_id uuid default null,
  p_company_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs jsonb;
  v_email_addr text;
  v_in_app boolean;
  v_email boolean;
  v_email_default boolean;
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;
  select pr.notification_prefs, pr.email into v_prefs, v_email_addr
    from public.profiles pr where pr.id = p_user_id;
  if not found then
    return null;
  end if;
  select c.email_default into v_email_default from public.notification_catalog() c where c.type = p_type;
  v_in_app := coalesce((v_prefs -> p_type ->> 'in_app')::boolean, true);
  v_email := coalesce((v_prefs -> p_type ->> 'email')::boolean, coalesce(v_email_default, false))
             and v_email_addr is not null;
  if not v_in_app and not v_email then
    return null;
  end if;
  insert into public.notifications (
    user_id, project_id, company_id, type, title, body, link, payload, in_app, read_at, email_status
  ) values (
    p_user_id, p_project_id, p_company_id, p_type, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb),
    v_in_app, case when v_in_app then null else now() end,
    case when v_email then 'pending' else 'skipped' end
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_count integer;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Merge per-type preferences: {"<type>": {"in_app": bool, "email": bool}}.
-- Returns the full, updated preference object.
create or replace function public.update_notification_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_key text;
  v_val jsonb;
  v_sub text;
  v_prefs jsonb;
begin
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    perform private.raise_error('VALIDATION', 'Send preferences as an object keyed by notification type.', 'prefs');
  end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_prefs) e loop
    if not exists (select 1 from public.notification_catalog() c where c.type = v_key) then
      perform private.raise_error('VALIDATION', format('"%s" is not a known notification type.', v_key), v_key);
    end if;
    if jsonb_typeof(v_val) <> 'object' then
      perform private.raise_error('VALIDATION', format('Preferences for "%s" must be an object like {"in_app": true, "email": false}.', v_key), v_key);
    end if;
    for v_sub in select jsonb_object_keys(v_val) loop
      if v_sub not in ('in_app', 'email') or jsonb_typeof(v_val -> v_sub) <> 'boolean' then
        perform private.raise_error('VALIDATION', format('Use true/false for "in_app" and "email" in "%s".', v_key), v_key);
      end if;
    end loop;
  end loop;

  select pr.notification_prefs into v_prefs from public.profiles pr where pr.id = v_uid for update;
  if not found then
    perform private.raise_error('NOT_FOUND', 'Your profile was not found. Sign out and sign in again.');
  end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_prefs) e loop
    v_prefs := jsonb_set(v_prefs, array[v_key], coalesce(v_prefs -> v_key, '{}'::jsonb) || v_val, true);
  end loop;
  update public.profiles set notification_prefs = v_prefs where id = v_uid;
  return v_prefs;
end;
$$;

-- ---------------------------------------------------------------------------
-- Email outbox (service_role only). The job claims a batch, sends through
-- Brevo, then reports each result with complete_email().
-- ---------------------------------------------------------------------------
create or replace function public.claim_email_batch(p_limit integer default 20)
returns table (
  id uuid,
  type text,
  title text,
  body text,
  link text,
  payload jsonb,
  recipient_email text,
  recipient_name text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select n.id
      from public.notifications n
     where n.email_status = 'pending'
        or (n.email_status = 'sending' and n.updated_at < now() - interval '15 minutes')
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ), claimed as (
    update public.notifications n
       set email_status = 'sending',
           email_attempts = n.email_attempts + 1
      from picked
     where n.id = picked.id
    returning n.id, n.user_id, n.type, n.title, n.body, n.link, n.payload, n.email_attempts
  )
  select c.id, c.type, c.title, c.body, c.link, c.payload,
         pr.email, coalesce(pr.full_name, pr.email), c.email_attempts
    from claimed c
    join public.profiles pr on pr.id = c.user_id;
end;
$$;

-- p_status: 'sent' | 'failed' | 'skipped'. Failures are retried (back to
-- 'pending') until 5 attempts, then stay 'failed'.
create or replace function public.complete_email(p_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    perform private.raise_error('VALIDATION', 'Status must be sent, failed or skipped.', 'status');
  end if;
  update public.notifications n
     set email_status = case
           when p_status = 'failed' and n.email_attempts < 5 then 'pending'
           else p_status end,
         emailed_at = case when p_status = 'sent' then now() else n.emailed_at end,
         email_error = case when p_status = 'sent' then null else left(p_error, 1000) end
   where n.id = p_id
     and n.email_status = 'sending';
end;
$$;

-- Realtime: the bell subscribes to INSERTs on its own rows (RLS applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.notification_catalog() to authenticated, service_role;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;
grant execute on function public.update_notification_prefs(jsonb) to authenticated, service_role;
revoke execute on function public.claim_email_batch(integer) from authenticated;
revoke execute on function public.complete_email(uuid, text, text) from authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;
grant execute on function public.complete_email(uuid, text, text) to service_role;
