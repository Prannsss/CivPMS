-- CivPMS demo data (Phase 0–1). See supabase/seed/README.md.
--
-- * Idempotent: safe to run again. Existing users, companies, projects, members, codes and WBS
--   trees are reused, never duplicated. A re-run also resets the demo password.
-- * The password is NOT in this file. It is read from the session setting `civpms.demo_password`,
--   which you set in the same session/run, BEFORE this script:
--       select set_config('civpms.demo_password', '<DEMO_PASSWORD from .env.local>', false);
-- * Accounts are created directly in auth.users + auth.identities (confirmed email/password).
--   Everything else is built THROUGH THE APP'S RPCs while impersonating each user
--   (`set local role authenticated` + request.jwt.claims), so RLS checks, activity logs,
--   notifications, Baseline v1 and budget alerts are exactly what the app would produce.
-- * All addresses use @civpms.test (a reserved, non-routable TLD). The app never emails *.test.
-- * Remove everything with supabase/seed/demo-cleanup.sql before going to production.
--
-- Runs as `postgres` (Supabase SQL editor, psql, or the MCP execute_sql tool), in one transaction.

begin;

do $seed$
declare
  c_pw constant text := current_setting('civpms.demo_password', true);

  -- Accounts: key → [email, full name]. `newbie` stays un-onboarded (no name, no company).
  c_accounts constant jsonb := '{
    "owner":     {"email": "owner@civpms.test",     "name": "Juan Dela Cruz"},
    "pm":        {"email": "pm@civpms.test",        "name": "Maria Santos"},
    "inspector": {"email": "inspector@civpms.test", "name": "Paolo Reyes"},
    "rival":     {"email": "rival@civpms.test",     "name": "Ana Villanueva"},
    "newbie":    {"email": "newbie@civpms.test",    "name": null}
  }';

  c_company constant text := 'Dela Cruz Builders';
  c_rival_company constant text := 'Bayanihan Construction';
  c_invitee constant text := 'invitee@civpms.test';

  -- Projects: created by `by` (owner or rival). Dates are ISO; budgets in pesos.
  c_projects constant jsonb := '[
    {"key": "cebu", "by": "owner", "name": "Cebu Coastal Road Widening",
     "site_name": "Talisay–Minglanilla segment",
     "site_address": "Cebu South Coastal Road, Talisay City, Cebu",
     "description": "Widening of 4.2 km of the Cebu South Coastal Road from four to six lanes, with RC drainage, seawall slope protection and new pavement markings.",
     "start": "2026-10-26", "end": "2027-07-30", "budget": 190000000.00, "color": "blue"},
    {"key": "iloilo", "by": "owner", "name": "Iloilo Riverside Mixed-Use Tower",
     "site_name": "Lot 7, Iloilo River Esplanade",
     "site_address": "Muelle Loney Street, Iloilo City Proper, Iloilo",
     "description": "22-storey mixed-use tower with a five-level retail and parking podium, two basement levels and riverfront landscaping.",
     "start": "2027-01-11", "end": "2028-12-15", "budget": 450000000.00, "color": "purple"},
    {"key": "davao", "by": "owner", "name": "Davao Drainage Rehabilitation, Phase 2",
     "site_name": "Bajada – J.P. Laurel Avenue catchment",
     "site_address": "J.P. Laurel Avenue, Bajada, Davao City, Davao del Sur",
     "description": "Phase 2 of the city drainage master plan: canal desilting, two RC box culvert crossings, 1,220 mm pipe laterals and road restoration to relieve flooding along J.P. Laurel Avenue.",
     "start": "2026-03-02", "end": "2026-09-30", "budget": 48500000.00, "color": "teal"},
    {"key": "laguna", "by": "owner", "name": "Laguna Warehouse Expansion",
     "site_name": "Warehouse 3 extension",
     "site_address": "Barangay Batino, Calamba City, Laguna",
     "description": "6,800 m² pre-engineered steel warehouse extension with loading docks, fire protection and a rooftop solar array.",
     "start": "2027-02-01", "end": "2027-11-26", "budget": 72000000.00, "color": "green"},
    {"key": "pampanga", "by": "rival", "name": "Pampanga Farm-to-Market Road, Package 1",
     "site_name": "Porac–Floridablanca FMR, Sta. 0+000 to 3+100",
     "site_address": "Barangay Pio, Porac, Pampanga",
     "description": "3.1 km concrete farm-to-market road with RC pipe culverts and stone masonry slope protection.",
     "start": "2026-11-09", "end": "2027-04-30", "budget": 24500000.00, "color": "graphite"}
  ]';

  -- WBS per project, in WBS order. c = code (the parent is the code minus its last segment),
  -- n = name, s = start date, h = duration in working hours, k = estimated cost, d = description.
  -- Only leaves carry schedule and cost (D21); end dates are computed below from the project
  -- calendar exactly like computeEndDate() in src/lib/domain/calendar.ts (D20).
  c_wbs constant jsonb := '{
    "cebu": [
      {"c": "1", "n": "Mobilization and Site Preparation"},
      {"c": "1.1", "n": "Mobilization"},
      {"c": "1.1.1", "n": "Mobilize equipment and field office", "s": "2026-10-26", "h": 80, "k": 3215400.00,
       "d": "Equipment, field office and materials testing laboratory."},
      {"c": "1.1.2", "n": "Traffic management plan and road signage", "s": "2026-10-26", "h": 40, "k": 862750.00},
      {"c": "1.2", "n": "Clearing and Relocation"},
      {"c": "1.2.1", "n": "Clearing and grubbing", "s": "2026-11-03", "h": 120, "k": 2418600.00},
      {"c": "1.2.2", "n": "Relocation of utility poles and waterlines", "s": "2026-11-10", "h": 160, "k": 6748250.50,
       "d": "Coordinated with the electric cooperative and the water district."},
      {"c": "2", "n": "Earthworks and Drainage"},
      {"c": "2.1", "n": "Earthworks"},
      {"c": "2.1.1", "n": "Roadway excavation", "s": "2026-11-23", "h": 240, "k": 9836000.00},
      {"c": "2.1.2", "n": "Embankment and subgrade preparation", "s": "2027-01-04", "h": 320, "k": 14527300.00},
      {"c": "2.2", "n": "Drainage"},
      {"c": "2.2.1", "n": "RC pipe culverts, 910 mm", "s": "2026-12-01", "h": 280, "k": 11184900.00},
      {"c": "2.2.2", "n": "Lined canal and catch basins", "s": "2027-01-18", "h": 240, "k": 8906450.00},
      {"c": "3", "n": "Pavement Works"},
      {"c": "3.1", "n": "Base Course"},
      {"c": "3.1.1", "n": "Aggregate subbase course", "s": "2027-02-22", "h": 200, "k": 12640000.00},
      {"c": "3.1.2", "n": "Aggregate base course", "s": "2027-03-15", "h": 200, "k": 13395800.00},
      {"c": "3.2", "n": "Concrete Pavement"},
      {"c": "3.2.1", "n": "PCCP 280 mm, northbound lanes", "s": "2027-04-12", "h": 280, "k": 18762500.00},
      {"c": "3.2.2", "n": "PCCP 280 mm, southbound lanes", "s": "2027-05-17", "h": 280, "k": 18240000.00},
      {"c": "4", "n": "Slope Protection, Safety and Turnover"},
      {"c": "4.1", "n": "Slope Protection"},
      {"c": "4.1.1", "n": "Grouted riprap along the seawall", "s": "2026-12-07", "h": 400, "k": 7615200.00},
      {"c": "4.2", "n": "Road Safety and Turnover"},
      {"c": "4.2.1", "n": "Thermoplastic pavement markings", "s": "2027-07-05", "h": 80, "k": 2148600.00},
      {"c": "4.2.2", "n": "Guardrails and road signs", "s": "2027-07-05", "h": 96, "k": 3096400.00},
      {"c": "4.2.3", "n": "As-built plans and turnover documents", "s": "2027-07-21", "h": 36, "k": 452000.00}
    ],
    "iloilo": [
      {"c": "1", "n": "Pre-construction"},
      {"c": "1.1", "n": "Permits and Design"},
      {"c": "1.1.1", "n": "Building permit and ECC processing", "s": "2027-01-11", "h": 160, "k": 2850000.00},
      {"c": "1.1.2", "n": "Detailed structural and MEPF design", "s": "2027-01-11", "h": 480, "k": 18600000.00},
      {"c": "1.2", "n": "Groundbreaking ceremony", "s": "2027-03-01", "h": 0, "k": 180000.00,
       "d": "Milestone."},
      {"c": "2", "n": "Substructure"},
      {"c": "2.1", "n": "Foundations"},
      {"c": "2.1.1", "n": "Bored piles, 1.2 m diameter (64 nos.)", "s": "2027-03-08", "h": 640, "k": 86400000.00},
      {"c": "2.1.2", "n": "Pile caps and grade beams", "s": "2027-06-14", "h": 320, "k": 41250000.00},
      {"c": "2.2", "n": "Basement"},
      {"c": "2.2.1", "n": "Basement excavation and shoring", "s": "2027-03-08", "h": 400, "k": 32800000.00},
      {"c": "2.2.2", "n": "Basement slab and retaining walls", "s": "2027-08-02", "h": 360, "k": 38900000.00},
      {"c": "3", "n": "Superstructure"},
      {"c": "3.1", "n": "Structural Frame"},
      {"c": "3.1.1", "n": "Podium, levels 1–5", "s": "2027-10-04", "h": 800, "k": 96500000.00},
      {"c": "3.1.2", "n": "Tower, levels 6–22", "s": "2028-02-07", "h": 1200, "k": 110020000.00}
    ],
    "davao": [
      {"c": "1", "n": "Site Works"},
      {"c": "1.1", "n": "Survey and Clearing"},
      {"c": "1.1.1", "n": "Topographic survey and staking", "s": "2026-03-02", "h": 64, "k": 780000.00},
      {"c": "1.1.2", "n": "Desilting of existing canals, 2.8 km", "s": "2026-03-09", "h": 240, "k": 4950000.00},
      {"c": "1.2", "n": "Traffic management and safety", "s": "2026-03-02", "h": 40, "k": 620000.00},
      {"c": "2", "n": "Drainage Structures"},
      {"c": "2.1", "n": "Box Culverts"},
      {"c": "2.1.1", "n": "RC box culvert, Bajada crossing", "s": "2026-04-06", "h": 360, "k": 14800000.00},
      {"c": "2.1.2", "n": "RC box culvert, J.P. Laurel Avenue crossing", "s": "2026-05-04", "h": 360, "k": 15350000.00},
      {"c": "2.2", "n": "Pipe Drainage"},
      {"c": "2.2.1", "n": "RCPC laterals, 1,220 mm", "s": "2026-06-01", "h": 280, "k": 8640000.00},
      {"c": "2.2.2", "n": "Manholes and inlets (42 nos.)", "s": "2026-07-06", "h": 200, "k": 4725500.00},
      {"c": "3", "n": "Road Restoration"},
      {"c": "3.1", "n": "PCCP restoration over trenches", "s": "2026-08-03", "h": 160, "k": 2980000.00},
      {"c": "3.2", "n": "Sidewalk and curb restoration", "s": "2026-08-24", "h": 120, "k": 1145000.00}
    ],
    "pampanga": [
      {"c": "1", "n": "Road Works"},
      {"c": "1.1", "n": "Subgrade preparation", "s": "2026-11-09", "h": 160, "k": 3200000.00},
      {"c": "1.2", "n": "PCCP 230 mm, 3.1 km", "s": "2026-12-07", "h": 480, "k": 14250000.00},
      {"c": "2", "n": "Drainage and Slope Protection"},
      {"c": "2.1", "n": "RC pipe culverts", "s": "2026-11-16", "h": 120, "k": 2150000.00},
      {"c": "2.2", "n": "Stone masonry slope protection", "s": "2027-01-18", "h": 200, "k": 1980000.00}
    ]
  }';

  v_users jsonb := '{}';      -- key → {id, email}
  v_projects jsonb := '{}';   -- project key → id
  v_key text;
  v_email text;
  v_uid uuid;
  v_company uuid;
  v_rival_company uuid;
  v_spec jsonb;
  v_actor text;
  v_pid uuid;
  v_project public.projects;
  v_code text;
  v_inv uuid;
  v_res jsonb;
  v_status public.project_status;
  v_cal public.calendars;
  v_ids jsonb;
  v_parent uuid;
  v_days integer;
  v_end date;
  v_act public.activities;
  v_count integer;
  r record;
begin
  if c_pw is null or char_length(c_pw) < 10 then
    raise exception 'Set the demo password first (10+ characters): select set_config(''civpms.demo_password'', ''<DEMO_PASSWORD from .env.local>'', false);';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Run this script as postgres (Supabase SQL editor or psql), not as %.', current_user;
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Confirmed email/password accounts (auth.users + auth.identities)
  -- -------------------------------------------------------------------------
  for v_key, v_spec in select e.key, e.value from jsonb_each(c_accounts) e loop
    v_email := v_spec ->> 'email';
    select u.id into v_uid from auth.users u where lower(u.email) = v_email and u.is_sso_user = false;
    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
      values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
        extensions.crypt(c_pw, extensions.gen_salt('bf', 10)), now(),
        '', '', '', '', '', '', '', '',
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
        now(), now(), false, false);
      raise notice 'created account %', v_email;
    else
      update auth.users
         set encrypted_password = extensions.crypt(c_pw, extensions.gen_salt('bf', 10)),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
      raise notice 'reset password of %', v_email;
    end if;
    if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'email') then
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_uid::text, v_uid,
              jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
              'email', null, now(), now());
    end if;
    v_users := v_users || jsonb_build_object(v_key, jsonb_build_object('id', v_uid, 'email', v_email));
    v_uid := null;
  end loop;

  -- -------------------------------------------------------------------------
  -- 2. Onboarding: names + roles, companies (as each user)
  -- -------------------------------------------------------------------------
  foreach v_key in array array['owner', 'pm', 'inspector', 'rival'] loop
    v_uid := (v_users -> v_key ->> 'id')::uuid;
    if exists (select 1 from public.profiles p where p.id = v_uid and (p.full_name is null or p.role_pref is null)) then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'email', v_users -> v_key ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.complete_profile(c_accounts -> v_key ->> 'name',
                                      case when v_key = 'inspector' then 'inspector' else 'pm' end);
      reset role;
    end if;
  end loop;

  foreach v_key in array array['owner', 'rival'] loop
    v_uid := (v_users -> v_key ->> 'id')::uuid;
    if not exists (select 1 from public.company_members cm where cm.user_id = v_uid) then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'email', v_users -> v_key ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.create_company(case when v_key = 'owner' then c_company else c_rival_company end);
      reset role;
      raise notice 'created company for %', v_users -> v_key ->> 'email';
    end if;
  end loop;

  select cm.company_id into v_company from public.company_members cm
   where cm.user_id = (v_users -> 'owner' ->> 'id')::uuid and cm.role = 'owner_pm';
  select cm.company_id into v_rival_company from public.company_members cm
   where cm.user_id = (v_users -> 'rival' ->> 'id')::uuid and cm.role = 'owner_pm';
  if v_company is null or v_rival_company is null then
    raise exception 'owner@ and rival@ must each be the Owner PM of their own company (found % / %).', v_company, v_rival_company;
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Projects (planning on creation)
  -- -------------------------------------------------------------------------
  for v_spec in select e.value from jsonb_array_elements(c_projects) e loop
    v_actor := v_spec ->> 'by';
    select p.id into v_pid from public.projects p
     where p.company_id = case when v_actor = 'owner' then v_company else v_rival_company end
       and p.name_key = private.name_key(v_spec ->> 'name')
       and p.deleted_at is null;
    if v_pid is null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_users -> v_actor ->> 'id', 'email', v_users -> v_actor ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_project := public.create_project(
        v_spec ->> 'name', (v_spec ->> 'start')::date, (v_spec ->> 'end')::date, (v_spec ->> 'budget')::numeric,
        v_spec ->> 'site_name', v_spec ->> 'site_address', v_spec ->> 'description',
        (v_spec ->> 'color')::public.project_color);
      reset role;
      v_pid := v_project.id;
      raise notice 'created project %', v_spec ->> 'name';
    end if;
    v_projects := v_projects || jsonb_build_object(v_spec ->> 'key', v_pid);
    v_pid := null;
  end loop;

  -- -------------------------------------------------------------------------
  -- 4. Team: company-wide invite code, Maria via email invitation, Paolo via the code
  -- -------------------------------------------------------------------------
  select ic.code into v_code from public.invite_codes ic
   where ic.company_id = v_company and ic.project_id is null
     and ic.created_by = (v_users -> 'owner' ->> 'id')::uuid
     and ic.revoked_at is null
     and (ic.expires_at is null or ic.expires_at > now())
     and (ic.max_uses is null or ic.use_count < ic.max_uses)
   order by ic.created_at
   limit 1;
  if v_code is null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_users -> 'owner' ->> 'id', 'email', v_users -> 'owner' ->> 'email', 'role', 'authenticated')::text, true);
    set local role authenticated;
    select ic.code into v_code from public.create_invite_code(null, null, null) ic;
    reset role;
    raise notice 'created company-wide invite code';
  end if;

  -- Maria Santos: Juan invites pm@ to Cebu as PM, Maria accepts (joins the company as PM).
  v_uid := (v_users -> 'pm' ->> 'id')::uuid;
  if not exists (select 1 from public.company_members cm where cm.user_id = v_uid) then
    select i.id into v_inv from public.invitations i
     where i.project_id = (v_projects ->> 'cebu')::uuid and i.email = v_users -> 'pm' ->> 'email'
       and i.status = 'pending' and i.expires_at > now();
    if v_inv is null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_users -> 'owner' ->> 'id', 'email', v_users -> 'owner' ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_res := public.invite_to_project((v_projects ->> 'cebu')::uuid, v_users -> 'pm' ->> 'email', 'pm');
      reset role;
      v_inv := (v_res ->> 'invitation_id')::uuid;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'email', v_users -> 'pm' ->> 'email', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.accept_invitation(null, v_inv);
    reset role;
    raise notice 'Maria accepted the Cebu invitation';
  end if;

  -- Paolo Reyes: redeems the company-wide inspector code.
  v_uid := (v_users -> 'inspector' ->> 'id')::uuid;
  if not exists (select 1 from public.company_members cm where cm.user_id = v_uid) then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'email', v_users -> 'inspector' ->> 'email', 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_res := public.redeem_invite_code(v_code);
    reset role;
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      raise exception 'Paolo could not redeem the invite code: %', v_res ->> 'error_code';
    end if;
    raise notice 'Paolo joined with the company-wide code';
  end if;

  -- Project memberships: Maria (PM) on Cebu + Davao, Paolo (inspector) on Cebu.
  for r in
    select * from (values ('pm', 'cebu', 'pm'), ('inspector', 'cebu', 'inspector'), ('pm', 'davao', 'pm'))
      as t(who, proj, prole)
  loop
    v_uid := (v_users -> r.who ->> 'id')::uuid;
    v_pid := (v_projects ->> r.proj)::uuid;
    if not exists (select 1 from public.project_members pm where pm.project_id = v_pid and pm.user_id = v_uid) then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_users -> 'owner' ->> 'id', 'email', v_users -> 'owner' ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.add_project_member(v_pid, v_uid, r.prole::public.project_role);
      reset role;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 5. WBS (only for projects that have no activities yet)
  -- -------------------------------------------------------------------------
  for v_spec in select e.value from jsonb_array_elements(c_projects) e loop
    v_key := v_spec ->> 'key';
    v_actor := v_spec ->> 'by';
    v_pid := (v_projects ->> v_key)::uuid;
    continue when c_wbs -> v_key is null;
    continue when exists (select 1 from public.activities a where a.project_id = v_pid and a.deleted_at is null);

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_users -> v_actor ->> 'id', 'email', v_users -> v_actor ->> 'email', 'role', 'authenticated')::text, true);
    set local role authenticated;
    select * into strict v_cal from public.calendars c where c.project_id = v_pid;
    v_ids := '{}';
    v_count := 0;
    for r in
      select e.v ->> 'c' as code, e.v ->> 'n' as name, (e.v ->> 's')::date as start_date,
             (e.v ->> 'h')::numeric as hours, (e.v ->> 'k')::numeric as cost, e.v ->> 'd' as description
        from jsonb_array_elements(c_wbs -> v_key) with ordinality as e(v, i)
       order by e.i
    loop
      v_parent := case when position('.' in r.code) > 0
                       then (v_ids ->> regexp_replace(r.code, '\.[0-9]+$', ''))::uuid end;
      -- D20: 0 h = milestone (end = start); otherwise ceil(h / hours_per_day) working days from
      -- the first working day >= start. Working day: an override wins, then holidays (when
      -- non-working), then the weekday rule.
      v_end := null;
      if r.start_date is not null and r.hours is not null then
        if r.hours = 0 then
          v_end := r.start_date;
        else
          v_days := greatest(1, ceil(r.hours / v_cal.hours_per_day - 0.000000001))::integer;
          select w.d into v_end
            from (select g::date as d, row_number() over (order by g) as n
                    from generate_series(r.start_date::timestamp, r.start_date::timestamp + interval '3660 days',
                                         interval '1 day') as g
                   where coalesce(
                           (select cd.kind = 'override_working' from public.calendar_dates cd
                             where cd.project_id = v_pid and cd.date = g::date and cd.kind <> 'holiday'
                             limit 1),
                           case when v_cal.holidays_nonworking
                                     and exists (select 1 from public.calendar_dates cd
                                                  where cd.project_id = v_pid and cd.date = g::date
                                                    and cd.kind = 'holiday')
                                then false
                                else extract(isodow from g)::smallint = any (v_cal.work_days) end)) w
           where w.n = v_days;
          if v_end is null then
            raise exception 'No working day found for % % (check the project calendar).', v_key, r.code;
          end if;
        end if;
      end if;

      v_act := public.create_activity(v_pid, v_parent, r.name, null, jsonb_strip_nulls(jsonb_build_object(
        'description', r.description, 'start_date', r.start_date, 'duration_hours', r.hours,
        'end_date', v_end, 'est_cost', r.cost)));
      if v_act.wbs_code <> r.code then
        raise exception 'WBS code mismatch in %: expected %, got %', v_key, r.code, v_act.wbs_code;
      end if;
      v_ids := v_ids || jsonb_build_object(r.code, v_act.id);
      v_count := v_count + 1;
    end loop;
    reset role;
    raise notice 'created % activities in %', v_count, v_spec ->> 'name';
  end loop;

  -- -------------------------------------------------------------------------
  -- 6. Statuses: Cebu and Davao go Active (captures Baseline v1, notifies the team)
  -- -------------------------------------------------------------------------
  foreach v_key in array array['cebu', 'davao'] loop
    v_pid := (v_projects ->> v_key)::uuid;
    select p.status into v_status from public.projects p where p.id = v_pid;
    if v_status = 'planning' then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_users -> 'owner' ->> 'id', 'email', v_users -> 'owner' ->> 'email', 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.set_project_status(v_pid, 'active');
      reset role;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 7. One pending email invitation (no account yet): invitee@ → Cebu as inspector
  -- -------------------------------------------------------------------------
  if not exists (select 1 from public.invitations i
                  where i.project_id = (v_projects ->> 'cebu')::uuid and i.email = c_invitee
                    and i.status = 'pending' and i.expires_at > now())
     and not exists (select 1 from public.profiles p join public.company_members cm on cm.user_id = p.id
                      where p.email = c_invitee) then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_users -> 'owner' ->> 'id', 'email', v_users -> 'owner' ->> 'email', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.invite_to_project((v_projects ->> 'cebu')::uuid, c_invitee, 'inspector');
    reset role;
    raise notice 'invited % to Cebu', c_invitee;
  end if;

  perform set_config('request.jwt.claims', '', true);
end
$seed$;

commit;

-- Summary (as postgres: sees every demo project; my_* columns are empty here).
select o.name as project,
       c.name as company,
       o.status,
       o.budget,
       o.allocated,
       o.budget_state,
       o.is_delayed,
       o.activity_count,
       o.leaf_count,
       (select count(*) from public.project_members pm where pm.project_id = o.id) as members
  from public.project_overview o
  join public.companies c on c.id = o.company_id
  join public.profiles op on op.id = c.owner_id
 where op.email like '%@civpms.test'
 order by c.name, o.name;
