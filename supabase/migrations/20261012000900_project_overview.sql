-- project_overview: one row per visible, non-deleted project with the totals
-- the home cards and project header need (D23: mirrors the TS rollups).
-- security_invoker = true, so the caller's RLS on projects/activities applies.
--
--   allocated         Σ est_cost of non-deleted leaves (leaf = no non-deleted children)
--   remaining         budget − allocated (negative when over budget)
--   leaf_count        non-deleted leaves
--   activity_count    non-deleted activities at every level
--   completed_count   non-deleted activities at every level with status completed
--   percent_complete  Σ(weight × percent) / Σ weight over leaves, 2 decimals, 0 without leaves.
--                     weight = primary basis (project.weighting) if > 0, else the other
--                     basis if > 0, else 1 (spec §6.5)
--   budget_state      'exceeded' (allocated > budget) | 'near' (allocated ≥ budget × threshold) | 'ok'
--   is_delayed        Manila today > end_date and status not completed/cancelled (spec §5.3)
--   unscheduled_count leaves missing start_date, duration_hours or est_cost
--   my_project_role / my_company_role  the caller's roles (NULL when none)

create or replace view public.project_overview
with (security_invoker = true)
as
select
  p.id,
  p.company_id,
  p.name,
  p.site_name,
  p.site_address,
  p.description,
  p.start_date,
  p.end_date,
  p.budget,
  p.status,
  p.status_reason,
  p.is_archived,
  p.weighting,
  p.near_budget_threshold,
  p.color,
  p.version,
  p.created_by,
  p.closed_at,
  p.created_at,
  p.updated_at,
  s.allocated,
  (p.budget - s.allocated)::numeric(16,2) as remaining,
  s.leaf_count,
  s.activity_count,
  s.completed_count,
  s.percent_complete,
  case
    when s.allocated > p.budget then 'exceeded'
    when s.allocated >= p.budget * p.near_budget_threshold then 'near'
    else 'ok'
  end as budget_state,
  ((now() at time zone 'Asia/Manila')::date > p.end_date
    and p.status not in ('completed', 'cancelled')) as is_delayed,
  (select pm.role
     from public.project_members pm
    where pm.project_id = p.id and pm.user_id = (select auth.uid())) as my_project_role,
  (select cm.role
     from public.company_members cm
    where cm.company_id = p.company_id and cm.user_id = (select auth.uid())) as my_company_role,
  s.unscheduled_count
from public.projects p
cross join lateral (
  select
    coalesce(sum(l.est_cost) filter (where l.is_leaf), 0)::numeric(16,2) as allocated,
    (count(*) filter (where l.is_leaf))::integer as leaf_count,
    count(*)::integer as activity_count,
    (count(*) filter (where l.status = 'completed'))::integer as completed_count,
    coalesce(round(
      sum(l.weight * l.percent) filter (where l.is_leaf)
        / nullif(sum(l.weight) filter (where l.is_leaf), 0), 2), 0)::numeric(5,2) as percent_complete,
    (count(*) filter (where l.is_leaf
                        and (l.start_date is null or l.duration_hours is null or l.est_cost is null)))::integer
      as unscheduled_count
  from (
    select
      a.est_cost,
      a.duration_hours,
      a.start_date,
      a.status,
      a.percent,
      not exists (
        select 1 from public.activities c
         where c.parent_id = a.id and c.deleted_at is null
      ) as is_leaf,
      case
        when p.weighting = 'cost' then
          case when coalesce(a.est_cost, 0) > 0 then a.est_cost
               when coalesce(a.duration_hours, 0) > 0 then a.duration_hours
               else 1 end
        else
          case when coalesce(a.duration_hours, 0) > 0 then a.duration_hours
               when coalesce(a.est_cost, 0) > 0 then a.est_cost
               else 1 end
      end as weight
    from public.activities a
    where a.project_id = p.id and a.deleted_at is null
  ) l
) s
where p.deleted_at is null;

comment on view public.project_overview is
  'One row per visible non-deleted project with budget/progress totals (security_invoker; RLS of the caller applies).';

revoke all on public.project_overview from public, anon;
grant select on public.project_overview to authenticated, service_role;
