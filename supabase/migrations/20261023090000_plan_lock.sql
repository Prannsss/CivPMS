-- Plan lock in the database (spec §5.2): the WBS and working calendar of a Completed or
-- Cancelled project are read-only until it is reopened (Completed → Active; Cancelled is final).
-- Until now only the app's Server Actions refused these edits (`planLockFor` in
-- src/server/queries/wbs.ts); the RPCs still accepted them when called directly with a PM's token.
--
-- * private.assert_plan_open(project) raises FORBIDDEN for completed/cancelled projects, with the
--   same plain-language text the app shows.
-- * private.lock_wbs() is taken by create/move/delete/restore_activity, apply_schedule and
--   save_calendar AFTER their permission checks; it now also asserts the plan is open (read after
--   the advisory lock, so it sees a status change that committed while it waited).
-- * private.get_managed_activity() (update/move/delete_activity) does the same after its
--   permission check, so people without access still get NOT_FOUND / FORBIDDEN first.
-- Status changes, archive, project delete/restore and the daily jobs don't use these helpers and
-- are unaffected. Test: supabase/tests/11_plan_lock.sql.

create or replace function private.assert_plan_open(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.project_status;
begin
  select p.status into v_status from public.projects p where p.id = p_project_id;
  if v_status = 'completed' then
    perform private.raise_error('FORBIDDEN',
      'This project is completed, so its plan is locked. Reopen it from Project settings to make changes.');
  elsif v_status = 'cancelled' then
    perform private.raise_error('FORBIDDEN', 'This project is cancelled, so its plan can''t be changed.');
  end if;
end;
$$;

revoke execute on function private.assert_plan_open(uuid) from public, anon, authenticated;

-- Serialise structural WBS changes per project (transaction-scoped), then refuse closed projects.
create or replace function private.lock_wbs(p_project_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('civpms.wbs:' || p_project_id::text, 0));
  perform private.assert_plan_open(p_project_id);
end;
$$;

create or replace function private.get_managed_activity(p_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.activities;
begin
  perform private.require_uid();
  select * into v_row from public.activities where id = p_activity_id and deleted_at is null;
  if not found or not private.can_view_project(v_row.project_id) then
    perform private.raise_error('NOT_FOUND', 'This activity does not exist or was deleted. Reload the page.', 'activity_id');
  end if;
  perform private.assert_can_manage_project(v_row.project_id);
  perform private.assert_plan_open(v_row.project_id);
  return v_row;
end;
$$;
