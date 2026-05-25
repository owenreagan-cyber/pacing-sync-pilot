-- Q4 Week 8 (2026-05-25 to 2026-05-29)
-- Ingest pacing entries into annual_pacing_master (pacing entries source of truth)
-- and mark no-school days in school_calendar.

INSERT INTO public.annual_pacing_master (
  school_year, quarter, week_num, subject, day, type, lesson_num, in_class, at_home
)
VALUES
  -- Monday (No School)
  ('2025-2026', 'Q4', 8, 'Math', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),
  ('2025-2026', 'Q4', 8, 'Reading', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),
  ('2025-2026', 'Q4', 8, 'Spelling', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),
  ('2025-2026', 'Q4', 8, 'Language Arts', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),
  ('2025-2026', 'Q4', 8, 'History', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),
  ('2025-2026', 'Q4', 8, 'Science', 'Monday', 'No Class', NULL, 'NO SCHOOL', NULL),

  -- Tuesday
  ('2025-2026', 'Q4', 8, 'Math', 'Tuesday', 'Lesson', '117', 'Lesson 117', NULL),
  ('2025-2026', 'Q4', 8, 'Reading', 'Tuesday', 'Lesson', '138', 'Reading Lesson 138', NULL),
  ('2025-2026', 'Q4', 8, 'Spelling', 'Tuesday', 'Lesson', NULL, 'Novel 1-2', NULL),
  ('2025-2026', 'Q4', 8, 'Language Arts', 'Tuesday', 'Lesson', NULL, 'Writing: Successful 4th', NULL),
  ('2025-2026', 'Q4', 8, 'History', 'Tuesday', 'Lesson', '8', 'Early Pres. CH 8', NULL),
  ('2025-2026', 'Q4', 8, 'Science', 'Tuesday', '-', NULL, '-', NULL),

  -- Wednesday
  ('2025-2026', 'Q4', 8, 'Math', 'Wednesday', 'Lesson', '118', 'Lesson 118', NULL),
  ('2025-2026', 'Q4', 8, 'Reading', 'Wednesday', 'Lesson', '139', 'Reading Lesson 139', NULL),
  ('2025-2026', 'Q4', 8, 'Spelling', 'Wednesday', 'Lesson', NULL, 'Novel 1-2', NULL),
  ('2025-2026', 'Q4', 8, 'Language Arts', 'Wednesday', 'Lesson', NULL, 'Writing: Successful 4th', NULL),
  ('2025-2026', 'Q4', 8, 'History', 'Wednesday', 'Lesson', '8', 'Early Pres. CH 8', NULL),
  ('2025-2026', 'Q4', 8, 'Science', 'Wednesday', '-', NULL, '-', NULL),

  -- Thursday
  ('2025-2026', 'Q4', 8, 'Math', 'Thursday', 'Lesson', '119', 'Lesson 119', NULL),
  ('2025-2026', 'Q4', 8, 'Reading', 'Thursday', 'Test', '14', 'Reading Test 14', NULL),
  ('2025-2026', 'Q4', 8, 'Spelling', 'Thursday', 'Lesson', NULL, 'Novel 3-4', NULL),
  ('2025-2026', 'Q4', 8, 'Language Arts', 'Thursday', 'Lesson', NULL, 'Writing: Successful 4th', NULL),
  ('2025-2026', 'Q4', 8, 'History', 'Thursday', 'Lesson', '8', 'CH 8 Activity', NULL),
  ('2025-2026', 'Q4', 8, 'Science', 'Thursday', '-', NULL, '-', NULL),

  -- Friday (Field Day)
  ('2025-2026', 'Q4', 8, 'Math', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL),
  ('2025-2026', 'Q4', 8, 'Reading', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL),
  ('2025-2026', 'Q4', 8, 'Spelling', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL),
  ('2025-2026', 'Q4', 8, 'Language Arts', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL),
  ('2025-2026', 'Q4', 8, 'History', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL),
  ('2025-2026', 'Q4', 8, 'Science', 'Friday', 'No Class', NULL, 'FIELD DAY', NULL)
ON CONFLICT (school_year, quarter, week_num, subject, day) DO UPDATE
SET
  type = EXCLUDED.type,
  lesson_num = EXCLUDED.lesson_num,
  in_class = EXCLUDED.in_class,
  at_home = EXCLUDED.at_home,
  updated_at = now();

-- Monday (Memorial Day) and Friday (Field Day) marked as non-school days.
-- This schema represents is_school_day = false via event_type='no_school'
-- and cancels_instruction=true.
INSERT INTO public.school_calendar (
  school_year, date, event_type, label, affects_all, cancels_instruction
)
VALUES
  ('2025-2026', '2026-05-25', 'no_school', 'Memorial Day', true, true),
  ('2025-2026', '2026-05-29', 'no_school', 'Field Day', true, true)
ON CONFLICT (school_year, date) DO UPDATE
SET
  event_type = EXCLUDED.event_type,
  label = EXCLUDED.label,
  affects_all = EXCLUDED.affects_all,
  cancels_instruction = EXCLUDED.cancels_instruction;
