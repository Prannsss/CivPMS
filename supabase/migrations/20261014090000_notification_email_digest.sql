-- Daily email digest (spec §14, profile → notification preferences).
--
-- A person can choose to receive their notification emails as one summary a
-- day instead of one email per event:
--   profiles.notification_prefs.email_digest = 'off' (default) | 'daily'
--
-- * update_notification_prefs() accepts the new top-level key "email_digest".
-- * private.notify() holds emails as email_status = 'digest' while the digest is
--   on (in-app notifications are unaffected).
-- * private.send_email_digests() turns each person's held rows into ONE outbox
--   row (type 'email_digest', email only) and marks the held rows 'digested'.
--   pg_cron runs it every day at 22:55 UTC = 06:55 Asia/Manila.

-- ---------------------------------------------------------------------------
-- New outbox states
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_email_status_check;
alter table public.notifications add constraint notifications_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'skipped', 'failed', 'digest', 'digested'));

create index if not exists notifications_digest_idx
  on public.notifications (user_id, created_at) where email_status = 'digest';

comment on column public.profiles.notification_prefs is
  'Per event type {"<type>": {"in_app": bool, "email": bool}}; missing entries use defaults. '
  'Top-level "email_digest": "off" | "daily" batches emails into one daily summary.';

-- ---------------------------------------------------------------------------
-- private.notify: same as before, plus the digest hold
-- ---------------------------------------------------------------------------
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
    case
      when not v_email then 'skipped'
      when coalesce(v_prefs ->> 'email_digest', 'off') = 'daily' then 'digest'
      else 'pending'
    end
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_notification_prefs: per-type objects plus "email_digest"
-- ---------------------------------------------------------------------------
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
    if v_key = 'email_digest' then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('off', 'daily') then
        perform private.raise_error('VALIDATION', 'Choose "off" or "daily" for the email digest.', 'email_digest');
      end if;
      continue;
    end if;
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
    if v_key = 'email_digest' then
      v_prefs := jsonb_set(v_prefs, array[v_key], v_val, true);
    else
      v_prefs := jsonb_set(v_prefs, array[v_key], coalesce(v_prefs -> v_key, '{}'::jsonb) || v_val, true);
    end if;
  end loop;
  update public.profiles set notification_prefs = v_prefs where id = v_uid;

  -- Turning the digest off releases anything still held, so nothing is lost.
  if p_prefs ? 'email_digest' and (p_prefs ->> 'email_digest') = 'off' then
    update public.notifications n
       set email_status = 'pending'
     where n.user_id = v_uid and n.email_status = 'digest';
  end if;
  return v_prefs;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily digest job
-- ---------------------------------------------------------------------------
-- Returns the number of digest emails queued. Held rows created after the job
-- started stay held for the next run.
create or replace function private.send_email_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now();
  v_user record;
  v_lines text;
  v_count integer := 0;
  v_more integer;
  v_marked integer;
begin
  for v_user in
    select n.user_id, count(*)::integer as total
      from public.notifications n
     where n.email_status = 'digest' and n.created_at <= v_cutoff
     group by n.user_id
  loop
    select string_agg('• ' || t.title, E'\n\n' order by t.created_at)
      into v_lines
      from (
        select n.title, n.created_at
          from public.notifications n
         where n.user_id = v_user.user_id and n.email_status = 'digest' and n.created_at <= v_cutoff
         order by n.created_at
         limit 20
      ) t;
    v_more := v_user.total - 20;

    with marked as (
      update public.notifications n
         set email_status = 'digested'
       where n.user_id = v_user.user_id and n.email_status = 'digest' and n.created_at <= v_cutoff
      returning 1
    )
    select count(*) into v_marked from marked;

    insert into public.notifications (
      user_id, type, title, body, link, payload, in_app, read_at, email_status
    ) values (
      v_user.user_id,
      'email_digest',
      format('Your CivPMS daily summary: %s update%s', v_user.total, case when v_user.total = 1 then '' else 's' end),
      'Here is what happened since your last summary.' || E'\n\n' || coalesce(v_lines, '')
        || case when v_more > 0 then E'\n\n' || format('…and %s more. Open your notifications to see everything.', v_more) else '' end,
      '/notifications',
      jsonb_build_object('count', v_user.total, 'cutoff', v_cutoff),
      false,
      now(),
      'pending'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function private.send_email_digests() from public, anon, authenticated;

select cron.schedule('civpms-email-digest', '55 22 * * *', 'select private.send_email_digests()');
