-- Supabase Cron (pg_cron): run private.run_daily_checks() every day at
-- 16:05 UTC = 00:05 Asia/Manila. cron.schedule() upserts by job name, so this
-- is safe to re-run. Fallback if pg_cron is ever unavailable: a protected
-- Vercel cron endpoint calling the service_role RPC public.run_daily_checks().

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule('civpms-daily-checks', '5 16 * * *', 'select private.run_daily_checks()');
