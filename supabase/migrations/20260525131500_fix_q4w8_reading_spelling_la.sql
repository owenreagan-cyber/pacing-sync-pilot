-- Q4 Week 8 corrective updates:
-- - Spelling has transitioned to novel study content (no spelling assignments)
-- - Language Arts should use the full unit title
-- - Week subtitle should use the full date range format expected on Canvas pages

UPDATE public.weeks
SET date_range = 'May 25–May 29, 2026'
WHERE quarter = 'Q4' AND week_num = 8;

UPDATE public.annual_pacing_master
SET
  type = 'Lesson',
  lesson_num = NULL,
  in_class = 'Novel Study: Because of Winn Dixie: Chapters 1-2',
  at_home = NULL
WHERE school_year = '2025-2026'
  AND quarter = 'Q4'
  AND week_num = 8
  AND subject = 'Spelling'
  AND day IN ('Tuesday', 'Wednesday', 'Thursday');

UPDATE public.annual_pacing_master
SET
  type = 'Lesson',
  lesson_num = NULL,
  in_class = 'How to be a Successful 4th Grader',
  at_home = NULL
WHERE school_year = '2025-2026'
  AND quarter = 'Q4'
  AND week_num = 8
  AND subject = 'Language Arts'
  AND day IN ('Tuesday', 'Wednesday', 'Thursday');

DO $$
DECLARE
  v_week_id uuid;
BEGIN
  SELECT id INTO v_week_id
  FROM public.weeks
  WHERE quarter = 'Q4' AND week_num = 8;

  IF v_week_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.pacing_rows
  SET
    type = 'Lesson',
    lesson_num = NULL,
    in_class = 'Novel Study: Because of Winn Dixie: Chapters 1-2',
    at_home = NULL,
    create_assign = false,
    deploy_status = 'PENDING',
    updated_at = now()
  WHERE week_id = v_week_id
    AND subject = 'Spelling'
    AND day IN ('Tuesday', 'Wednesday', 'Thursday');

  UPDATE public.pacing_rows
  SET
    type = 'Lesson',
    lesson_num = NULL,
    in_class = 'How to be a Successful 4th Grader',
    at_home = NULL,
    create_assign = false,
    deploy_status = 'PENDING',
    updated_at = now()
  WHERE week_id = v_week_id
    AND subject = 'Language Arts'
    AND day IN ('Tuesday', 'Wednesday', 'Thursday');
END $$;
