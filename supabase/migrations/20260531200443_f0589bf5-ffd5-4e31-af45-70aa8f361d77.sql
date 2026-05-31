-- Q4 Week 9 recovery migration.
INSERT INTO public.annual_pacing_master (
  school_year, quarter, week_num, subject, day, type, lesson_num, in_class, at_home
)
VALUES
  ('2025-2026', 'Q4', 9, 'Math', 'Monday',    'Lesson',        '120', 'Lesson 120',                    NULL),
  ('2025-2026', 'Q4', 9, 'Math', 'Tuesday',   'Investigation', '12',  'Investigation 12 / Study Guide', NULL),
  ('2025-2026', 'Q4', 9, 'Math', 'Wednesday', 'Test',          '23',  'Math Test — Lesson 23',         NULL),
  ('2025-2026', 'Q4', 9, 'Math', 'Thursday',  'Lesson',        NULL,  'Review',                        NULL),
  ('2025-2026', 'Q4', 9, 'Math', 'Friday',    'Test',          NULL,  'EOY Test',                      NULL),
  ('2025-2026', 'Q4', 9, 'Reading', 'Monday',    'Lesson', '5',  'NOVEL 5-7',   NULL),
  ('2025-2026', 'Q4', 9, 'Reading', 'Tuesday',   'Lesson', '8',  'NOVEL 8-10',  NULL),
  ('2025-2026', 'Q4', 9, 'Reading', 'Wednesday', 'Lesson', '11', 'NOVEL 11-12', NULL),
  ('2025-2026', 'Q4', 9, 'Reading', 'Thursday',  'Lesson', '12', 'NOVEL 12-15', NULL),
  ('2025-2026', 'Q4', 9, 'Reading', 'Friday',    'Lesson', '15', 'NOVEL 15-18', NULL),
  ('2025-2026', 'Q4', 9, 'Spelling', 'Monday',    'No Class', NULL, 'NOVEL', NULL),
  ('2025-2026', 'Q4', 9, 'Spelling', 'Tuesday',   'No Class', NULL, 'NOVEL', NULL),
  ('2025-2026', 'Q4', 9, 'Spelling', 'Wednesday', 'No Class', NULL, 'NOVEL', NULL),
  ('2025-2026', 'Q4', 9, 'Spelling', 'Thursday',  'No Class', NULL, 'NOVEL', NULL),
  ('2025-2026', 'Q4', 9, 'Spelling', 'Friday',    'No Class', NULL, 'NOVEL', NULL),
  ('2025-2026', 'Q4', 9, 'Language Arts', 'Monday',    'Lesson', NULL, 'How To Writing',         NULL),
  ('2025-2026', 'Q4', 9, 'Language Arts', 'Tuesday',   'Lesson', NULL, 'How To Writing',         NULL),
  ('2025-2026', 'Q4', 9, 'Language Arts', 'Wednesday', 'Lesson', NULL, 'Narrative w/ Dialogue',  NULL),
  ('2025-2026', 'Q4', 9, 'Language Arts', 'Thursday',  'Lesson', NULL, 'Narrative w/ Dialogue',  NULL),
  ('2025-2026', 'Q4', 9, 'Language Arts', 'Friday',    'Lesson', NULL, 'Narrative w/ Dialogue',  NULL),
  ('2025-2026', 'Q4', 9, 'History', 'Monday',    'Lesson', '9',  'CH 9',      NULL),
  ('2025-2026', 'Q4', 9, 'History', 'Tuesday',   'Lesson', '9',  'CH 9',      NULL),
  ('2025-2026', 'Q4', 9, 'History', 'Wednesday', 'Lesson', NULL, 'Review',    NULL),
  ('2025-2026', 'Q4', 9, 'History', 'Thursday',  'Test',   NULL, 'Unit Test', NULL),
  ('2025-2026', 'Q4', 9, 'History', 'Friday',    'Lesson', NULL, 'Activity',  NULL),
  ('2025-2026', 'Q4', 9, 'Science', 'Monday',    'No Class', NULL, 'No Class', NULL),
  ('2025-2026', 'Q4', 9, 'Science', 'Tuesday',   'No Class', NULL, 'No Class', NULL),
  ('2025-2026', 'Q4', 9, 'Science', 'Wednesday', 'No Class', NULL, 'No Class', NULL),
  ('2025-2026', 'Q4', 9, 'Science', 'Thursday',  'No Class', NULL, 'No Class', NULL),
  ('2025-2026', 'Q4', 9, 'Science', 'Friday',    'No Class', NULL, 'No Class', NULL)
ON CONFLICT (school_year, quarter, week_num, subject, day) DO UPDATE
SET
  type = EXCLUDED.type,
  lesson_num = EXCLUDED.lesson_num,
  in_class = EXCLUDED.in_class,
  at_home = EXCLUDED.at_home,
  updated_at = now();

UPDATE public.weeks SET is_active = false WHERE is_active = true;

INSERT INTO public.weeks (quarter, week_num, date_range, is_active)
VALUES ('Q4', 9, 'Jun 1–Jun 5, 2026', true)
ON CONFLICT (quarter, week_num) DO UPDATE
SET
  date_range = EXCLUDED.date_range,
  is_active = EXCLUDED.is_active,
  updated_at = now();

DO $$
DECLARE
  v_week_id uuid;
BEGIN
  SELECT id INTO v_week_id FROM public.weeks WHERE quarter = 'Q4' AND week_num = 9;
  IF v_week_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.pacing_rows
    (week_id, subject, day, type, lesson_num, in_class, at_home, create_assign, is_synthetic, deploy_status)
  VALUES
    (v_week_id, 'Math', 'Monday',    'Lesson',        '120', 'Lesson 120',                     NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Tuesday',   'Investigation', '12',  'Investigation 12 / Study Guide', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Wednesday', 'Test',          '23',  'Math Test — Lesson 23',          NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Thursday',  'Lesson',        NULL,  'Review',                         NULL, true,  false, 'PENDING'),
    (v_week_id, 'Math', 'Friday',    'Test',          NULL,  'EOY Test',                       NULL, true,  false, 'PENDING'),
    (v_week_id, 'Reading', 'Monday',    'Lesson', '5',  'NOVEL 5-7',   NULL, true,  false, 'PENDING'),
    (v_week_id, 'Reading', 'Tuesday',   'Lesson', '8',  'NOVEL 8-10',  NULL, true,  false, 'PENDING'),
    (v_week_id, 'Reading', 'Wednesday', 'Lesson', '11', 'NOVEL 11-12', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Reading', 'Thursday',  'Lesson', '12', 'NOVEL 12-15', NULL, true,  false, 'PENDING'),
    (v_week_id, 'Reading', 'Friday',    'Lesson', '15', 'NOVEL 15-18', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Monday',    'No Class', NULL, 'NOVEL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Tuesday',   'No Class', NULL, 'NOVEL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Wednesday', 'No Class', NULL, 'NOVEL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Thursday',  'No Class', NULL, 'NOVEL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Spelling', 'Friday',    'No Class', NULL, 'NOVEL', NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Monday',    'Lesson', NULL, 'How To Writing',        NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Tuesday',   'Lesson', NULL, 'How To Writing',        NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Wednesday', 'Lesson', NULL, 'Narrative w/ Dialogue', NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Thursday',  'Lesson', NULL, 'Narrative w/ Dialogue', NULL, false, false, 'PENDING'),
    (v_week_id, 'Language Arts', 'Friday',    'Lesson', NULL, 'Narrative w/ Dialogue', NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Monday',    'Lesson', '9',  'CH 9',      NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Tuesday',   'Lesson', '9',  'CH 9',      NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Wednesday', 'Lesson', NULL, 'Review',    NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Thursday',  'Test',   NULL, 'Unit Test', NULL, false, false, 'PENDING'),
    (v_week_id, 'History', 'Friday',    'Lesson', NULL, 'Activity',  NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Monday',    'No Class', NULL, 'No Class', NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Tuesday',   'No Class', NULL, 'No Class', NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Wednesday', 'No Class', NULL, 'No Class', NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Thursday',  'No Class', NULL, 'No Class', NULL, false, false, 'PENDING'),
    (v_week_id, 'Science', 'Friday',    'No Class', NULL, 'No Class', NULL, false, false, 'PENDING')
  ON CONFLICT (week_id, subject, day) DO UPDATE
  SET
    type = EXCLUDED.type,
    lesson_num = EXCLUDED.lesson_num,
    in_class = EXCLUDED.in_class,
    at_home = EXCLUDED.at_home,
    create_assign = EXCLUDED.create_assign,
    deploy_status = EXCLUDED.deploy_status,
    updated_at = now();

  UPDATE public.pacing_rows
  SET deploy_status = 'PENDING', content_hash = NULL, updated_at = now()
  WHERE week_id = v_week_id AND COALESCE(type, '') <> 'No Class';

  UPDATE public.weeks SET page_hashes = '{}'::jsonb, updated_at = now() WHERE id = v_week_id;

  DELETE FROM public.announcements
  WHERE week_id = v_week_id AND type = 'reminder' AND title LIKE 'Q4W9 %';

  INSERT INTO public.announcements
    (week_id, subject, type, title, content, course_id, status, scheduled_post)
  SELECT
    v_week_id, s.subject, 'reminder',
    'Q4W9 ' || s.subject || ' — ' || r.label,
    'Q4W9 ' || s.subject || ' ' || r.label || ' announcement.',
    s.course_id, 'DRAFT', r.scheduled_at
  FROM (VALUES
      ('Math', 21957), ('Reading', 21919), ('Spelling', 21919),
      ('Language Arts', 21944), ('History', 21934), ('Science', 21970)
  ) AS s(subject, course_id)
  CROSS JOIN (VALUES
      ('Week Ahead Reminder', '2026-05-29T20:00:00Z'::timestamptz),
      ('Midweek Reminder',    '2026-06-03T20:00:00Z'::timestamptz),
      ('Weekend Reminder',    '2026-06-05T20:00:00Z'::timestamptz)
  ) AS r(label, scheduled_at);
END $$;