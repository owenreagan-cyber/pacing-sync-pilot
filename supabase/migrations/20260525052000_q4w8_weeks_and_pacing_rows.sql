-- Q4 Week 8 (2026-05-25 to 2026-05-29)
-- Insert into the weeks and pacing_rows tables so the DeploymentWizard
-- can find and display Q4W8 data. The prior migration
-- (20260525050000_import_q4w8_pacing_and_calendar.sql) only wrote to
-- annual_pacing_master and school_calendar, which are not read by the wizard.

-- 1. Deactivate any currently-active week so the unique partial index
--    (weeks_only_one_active) is satisfied before we set Q4W8 active.
UPDATE public.weeks SET is_active = false WHERE is_active = true;

-- 2. Upsert the Q4W8 week record and mark it active.
INSERT INTO public.weeks (quarter, week_num, date_range, is_active)
VALUES ('Q4', 8, 'May 25–29, 2026', true)
ON CONFLICT (quarter, week_num) DO UPDATE
SET date_range = EXCLUDED.date_range,
    is_active  = EXCLUDED.is_active;

-- 3. Insert pacing_rows for Q4W8 linked to the week above.
--    Monday (NO SCHOOL) and Friday (FIELD DAY) have create_assign = false
--    and type = 'No Class'. All History/Science rows use create_assign = false
--    per the historyScienceNoAssign auto-logic rule.
DO $$
DECLARE
  v_week_id uuid;
BEGIN
  SELECT id INTO v_week_id FROM public.weeks WHERE quarter = 'Q4' AND week_num = 8;

  INSERT INTO public.pacing_rows
    (week_id, subject, day, type, lesson_num, in_class, at_home, create_assign, is_synthetic, deploy_status)
  VALUES
    -- ===== MATH =====
    (v_week_id, 'Math', 'Monday',    'No Class', NULL,  'NO SCHOOL',  NULL, false, false, 'PENDING'),
    (v_week_id, 'Math', 'Tuesday',   'Lesson',   '117', 'Lesson 117', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Wednesday', 'Lesson',   '118', 'Lesson 118', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Thursday',  'Lesson',   '119', 'Lesson 119', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Friday',    'No Class', NULL,  'FIELD DAY',  NULL, false, false, 'PENDING'),

    -- ===== READING =====
    (v_week_id, 'Reading', 'Monday',    'No Class', NULL, 'NO SCHOOL',      NULL, false, false, 'PENDING'),
    (v_week_id, 'Reading', 'Tuesday',   'Lesson',   '138', 'Reading Lesson 138', NULL, true, false, 'PENDING'),
    (v_week_id, 'Reading', 'Wednesday', 'Lesson',   '139', 'Reading Lesson 139', NULL, true, false, 'PENDING'),
    (v_week_id, 'Reading', 'Thursday',  'Test',     '14',  'Reading Test 14',    NULL, true, false, 'PENDING'),
    (v_week_id, 'Reading', 'Friday',    'No Class', NULL,  'FIELD DAY',          NULL, false, false, 'PENDING'),

    -- ===== SPELLING =====
    (v_week_id, 'Spelling', 'Monday',    'No Class', NULL, 'NO SCHOOL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Tuesday',   'Lesson',   NULL, 'Novel 1-2', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Spelling', 'Wednesday', 'Lesson',   NULL, 'Novel 1-2', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Spelling', 'Thursday',  'Lesson',   NULL, 'Novel 3-4', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Spelling', 'Friday',    'No Class', NULL, 'FIELD DAY', NULL, false, false, 'PENDING'),

    -- ===== LANGUAGE ARTS =====
    (v_week_id, 'Language Arts', 'Monday',    'No Class', NULL, 'NO SCHOOL',              NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Tuesday',   'Lesson',   NULL, 'Writing: Successful 4th', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Wednesday', 'Lesson',   NULL, 'Writing: Successful 4th', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Thursday',  'Lesson',   NULL, 'Writing: Successful 4th', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Friday',    'No Class', NULL, 'FIELD DAY',               NULL, false, false, 'PENDING'),

    -- ===== HISTORY (historyScienceNoAssign → create_assign = false) =====
    (v_week_id, 'History', 'Monday',    'No Class', NULL, 'NO SCHOOL',       NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Tuesday',   'Lesson',   '8',  'Early Pres. CH 8', NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Wednesday', 'Lesson',   '8',  'Early Pres. CH 8', NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Thursday',  'Lesson',   '8',  'CH 8 Activity',    NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Friday',    'No Class', NULL,  'FIELD DAY',       NULL, false, false, 'PENDING'),

    -- ===== SCIENCE (No Class all week) =====
    (v_week_id, 'Science', 'Monday',    'No Class', NULL, 'NO SCHOOL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Tuesday',   'No Class', NULL, '-',         NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Wednesday', 'No Class', NULL, '-',         NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Thursday',  'No Class', NULL, '-',         NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Friday',    'No Class', NULL, 'FIELD DAY', NULL, false, false, 'PENDING')

  ON CONFLICT (week_id, subject, day) DO UPDATE
  SET type          = EXCLUDED.type,
      lesson_num    = EXCLUDED.lesson_num,
      in_class      = EXCLUDED.in_class,
      at_home       = EXCLUDED.at_home,
      create_assign = EXCLUDED.create_assign,
      deploy_status = EXCLUDED.deploy_status,
      updated_at    = now();
END$$;
