-- Force live refresh for Q4W8 Math + Reading homework assignment links.
-- This ensures Step 2 re-runs assignment deploy and repopulates pacing_rows.canvas_url,
-- which Step 3 uses to render clickable homework links on agenda pages.

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
    deploy_status = 'PENDING',
    content_hash = NULL,
    updated_at = now()
  WHERE week_id = v_week_id
    AND subject IN ('Math', 'Reading')
    AND day IN ('Tuesday', 'Wednesday', 'Thursday')
    AND COALESCE(type, '') <> 'No Class';
END $$;
