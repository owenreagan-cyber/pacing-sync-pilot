-- Advanced file management: batch classify, duplicate detection, folder cleanup

-- 1. Extend canvas_orphan_files with hash/duplicate/batch tracking columns
ALTER TABLE public.canvas_orphan_files
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_file_id text,
  ADD COLUMN IF NOT EXISTS batch_job_id uuid;

CREATE INDEX IF NOT EXISTS idx_canvas_orphan_files_hash
  ON public.canvas_orphan_files(file_hash)
  WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_orphan_files_is_dup
  ON public.canvas_orphan_files(is_duplicate)
  WHERE is_duplicate = true;

-- 2. Extend automation_jobs with batch-progress columns
ALTER TABLE public.automation_jobs
  ADD COLUMN IF NOT EXISTS batch_cursor text,
  ADD COLUMN IF NOT EXISTS files_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS files_total integer NOT NULL DEFAULT 0;
