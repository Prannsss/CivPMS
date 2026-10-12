-- Philippine regular holidays and special (non-working) days, 2026–2027.
-- New projects copy these into calendar_dates (kind = holiday); PMs edit their
-- project's list as proclamations change (spec §7, A12).
--
-- 2026: Proclamation No. 1006, s. 2025 (signed 3 Sep 2025), plus
--       Eid'l Fitr  — Proclamation No. 1189, s. 2026 (20 Mar 2026, regular holiday)
--       Eid'l Adha  — Proclamation No. 1264, s. 2026 (27 May 2026, regular holiday)
--       25 Feb 2026 (EDSA People Power anniversary) is a special WORKING day → not listed.
-- 2027: Proclamation No. 1427, s. 2026 (signed 8 Sep 2026).
--       25 Feb 2027 is a special working day → not listed.
--       Eid'l Fitr / Eid'l Adha 2027 are proclaimed separately once the Islamic
--       calendar dates are set; they are NOT included yet — add them when declared.
-- Movable dates cross-checked: Easter 2026 = 5 Apr, Easter 2027 = 28 Mar;
-- National Heroes Day = last Monday of August (31 Aug 2026, 30 Aug 2027).

insert into public.ph_holidays (date, name, type, source) values
  -- 2026 regular holidays
  ('2026-01-01', 'New Year''s Day',                         'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-03-20', 'Eid''l Fitr',                             'regular',             'Proclamation No. 1189, s. 2026'),
  ('2026-04-02', 'Maundy Thursday',                         'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-04-03', 'Good Friday',                             'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-04-09', 'Araw ng Kagitingan',                      'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-05-01', 'Labor Day',                               'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-05-27', 'Eid''l Adha',                             'regular',             'Proclamation No. 1264, s. 2026'),
  ('2026-06-12', 'Independence Day',                        'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-08-31', 'National Heroes Day',                     'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-11-30', 'Bonifacio Day',                           'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-12-25', 'Christmas Day',                           'regular',             'Proclamation No. 1006, s. 2025'),
  ('2026-12-30', 'Rizal Day',                               'regular',             'Proclamation No. 1006, s. 2025'),
  -- 2026 special (non-working) days
  ('2026-02-17', 'Chinese New Year',                        'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-04-04', 'Black Saturday',                          'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-08-21', 'Ninoy Aquino Day',                        'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-11-01', 'All Saints'' Day',                        'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-11-02', 'All Souls'' Day',                         'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-08', 'Feast of the Immaculate Conception of Mary', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-24', 'Christmas Eve',                           'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-31', 'Last Day of the Year',                    'special_non_working', 'Proclamation No. 1006, s. 2025'),
  -- 2027 regular holidays
  ('2027-01-01', 'New Year''s Day',                         'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-03-25', 'Maundy Thursday',                         'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-03-26', 'Good Friday',                             'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-04-09', 'Araw ng Kagitingan',                      'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-05-01', 'Labor Day',                               'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-06-12', 'Independence Day',                        'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-08-30', 'National Heroes Day',                     'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-11-30', 'Bonifacio Day',                           'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-12-25', 'Christmas Day',                           'regular',             'Proclamation No. 1427, s. 2026'),
  ('2027-12-30', 'Rizal Day',                               'regular',             'Proclamation No. 1427, s. 2026'),
  -- 2027 special (non-working) days
  ('2027-02-06', 'Chinese New Year',                        'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-03-27', 'Black Saturday',                          'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-08-21', 'Ninoy Aquino Day',                        'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-11-01', 'All Saints'' Day',                        'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-11-02', 'All Souls'' Day',                         'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-12-08', 'Feast of the Immaculate Conception of Mary', 'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-12-24', 'Christmas Eve',                           'special_non_working', 'Proclamation No. 1427, s. 2026'),
  ('2027-12-31', 'Last Day of the Year',                    'special_non_working', 'Proclamation No. 1427, s. 2026')
on conflict (date, name) do update
  set type = excluded.type,
      source = excluded.source;
