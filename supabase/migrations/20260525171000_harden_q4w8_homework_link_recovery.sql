-- Harden Q4W8 Reading/Math homework link recovery for agenda pages.
-- 1) Backfill missing canvas_url when assignment IDs already exist.
-- 2) Keep unresolved rows pending for assignment re-deploy.
-- 3) Clear page hashes so Math/Reading agenda pages are forced to republish.

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

  -- Backfill links immediately when assignment IDs already exist.
  UPDATE public.pacing_rows
  SET
    canvas_url = CASE subject
      WHEN 'Math' THEN 'https://thalesacademy.instructure.com/courses/21957/assignments/' || canvas_assignment_id
      WHEN 'Reading' THEN 'https://thalesacademy.instructure.com/courses/21919/assignments/' || canvas_assignment_id
      ELSE canvas_url
    END,
    updated_at = now()
  WHERE week_id = v_week_id
    AND subject IN ('Math', 'Reading')
    AND day IN ('Tuesday', 'Wednesday', 'Thursday')
    AND COALESCE(type, '') <> 'No Class'
    AND canvas_assignment_id IS NOT NULL
    AND COALESCE(canvas_url, '') = '';

  -- Any remaining unresolved rows should be reprocessed by Step 2.
  UPDATE public.pacing_rows
  SET
    deploy_status = 'PENDING',
    content_hash = NULL,
    updated_at = now()
  WHERE week_id = v_week_id
    AND subject IN ('Math', 'Reading')
    AND day IN ('Tuesday', 'Wednesday', 'Thursday')
    AND COALESCE(type, '') <> 'No Class'
    AND (canvas_assignment_id IS NULL OR COALESCE(canvas_url, '') = '');

  -- Force Step 3 to republish Math/Reading agenda pages after link recovery.
  UPDATE public.weeks
  SET
    page_hashes = COALESCE(page_hashes, '{}'::jsonb) - 'Math' - 'Reading' - 'Reading & Spelling',
    updated_at = now()
  WHERE id = v_week_id;
END $$;
