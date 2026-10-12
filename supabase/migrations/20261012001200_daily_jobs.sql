-- Daily maintenance (00:05 Asia/Manila = 16:05 UTC); scheduled with pg_cron in
-- the next migration (schedule_daily_checks).
--   1. Projects that became Delayed (spec §5.3/§5.4): notify Owner PM + project PMs
--      once (delayed_notified_at; cleared when the end date moves to the future
--      or the project closes).
--   2. Pending invitations past expires_at → expired.
--   3. Purge soft-deleted activities/projects older than 30 days (spec §17.2,
--      A22). The ONLY place rows are hard-deleted; activity_logs keep their
--      snapshots because their foreign keys are ON DELETE SET NULL.
--   4. Trim invite-code attempts older than 2 days (the rate window is 1 hour).

create or replace function private.run_daily_checks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.manila_today();
  v_project record;
  v_delayed integer := 0;
  v_reset integer;
  v_expired integer;
  v_purged_activities integer;
  v_purged_projects integer := 0;
  v_attempts integer;
begin
  perform set_config('pms.via', 'system', true);

  -- 1. newly delayed projects
  for v_project in
    select p.id, p.company_id, p.name, p.end_date
      from public.projects p
     where p.deleted_at is null
       and p.status not in ('completed', 'cancelled')
       and p.end_date < v_today
       and p.delayed_notified_at is null
     order by p.end_date
       for no key update skip locked
  loop
    update public.projects set delayed_notified_at = now() where id = v_project.id;
    perform private.write_log(v_project.company_id, v_project.id, 'project', v_project.id, 'delayed',
      format('Project is now Delayed: its end date (%s) passed before it was completed', private.fmt_date(v_project.end_date)),
      'end_date', to_jsonb(v_project.end_date), null,
      p_is_escalation => true);
    perform private.notify(m.user_id, 'project_delayed',
        format('%s is delayed', v_project.name),
        format('"%s" passed its end date (%s) and is not completed yet. Review the schedule or update the end date.',
               v_project.name, private.fmt_date(v_project.end_date)),
        format('/projects/%s', v_project.id),
        jsonb_build_object('project_id', v_project.id, 'project_name', v_project.name, 'end_date', v_project.end_date),
        v_project.id, v_project.company_id)
      from private.project_manager_ids(v_project.id) as m(user_id);
    v_delayed := v_delayed + 1;
  end loop;

  -- safety net: clear markers of projects that are no longer delayed
  with cleared as (
    update public.projects p
       set delayed_notified_at = null
     where p.delayed_notified_at is not null
       and (p.status in ('completed', 'cancelled') or p.end_date >= v_today)
    returning 1
  )
  select count(*) into v_reset from cleared;

  -- 2. expire invitations
  with expired as (
    update public.invitations i
       set status = 'expired'
     where i.status = 'pending' and i.expires_at <= now()
    returning 1
  )
  select count(*) into v_expired from expired;

  -- 3a. purge activities deleted more than 30 days ago (children cascade)
  with gone as (
    delete from public.activities a
     where a.deleted_at is not null and a.deleted_at < now() - interval '30 days'
    returning 1
  )
  select count(*) into v_purged_activities from gone;

  -- 3b. purge projects deleted more than 30 days ago (everything under them cascades)
  for v_project in
    select p.id, p.company_id, p.name, p.deleted_at
      from public.projects p
     where p.deleted_at is not null and p.deleted_at < now() - interval '30 days'
  loop
    -- company-scoped entry (project_id NULL) so the Owner PM keeps a trace
    perform private.write_log(v_project.company_id, null, 'project', v_project.id, 'purge',
      format('Permanently deleted project "%s" (in the trash since %s)', v_project.name,
             private.fmt_date((v_project.deleted_at at time zone 'Asia/Manila')::date)),
      'deleted_at', to_jsonb(v_project.deleted_at), null);
    with gone as (
      delete from public.projects where id = v_project.id returning 1
    )
    select v_purged_projects + count(*)::integer into v_purged_projects from gone;
  end loop;

  -- 4. rate-limit bookkeeping
  with gone as (
    delete from public.invite_code_attempts a where a.attempted_at < now() - interval '2 days' returning 1
  )
  select count(*) into v_attempts from gone;

  perform set_config('pms.via', '', true);
  return jsonb_build_object(
    'ran_at', now(),
    'projects_delayed', v_delayed,
    'delayed_markers_cleared', v_reset,
    'invitations_expired', v_expired,
    'activities_purged', v_purged_activities,
    'projects_purged', v_purged_projects,
    'code_attempts_trimmed', v_attempts);
end;
$$;

-- Manual / fallback trigger for the same job (service_role only, e.g. from a
-- protected Vercel cron endpoint if pg_cron is ever unavailable).
create or replace function public.run_daily_checks()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.run_daily_checks();
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function public.run_daily_checks() from public, anon, authenticated;
grant execute on function public.run_daily_checks() to service_role;
