ALTER TABLE public.canvas_orphan_files
  ADD COLUMN IF NOT EXISTS ai_confidence integer;

COMMENT ON COLUMN public.canvas_orphan_files.ai_confidence IS
  'AI classification confidence score (0–100). Values below 80 are flagged as Needs Review.';
