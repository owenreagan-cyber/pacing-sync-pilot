ALTER TABLE public.canvas_orphan_files
  ADD COLUMN IF NOT EXISTS ai_purpose text[],
  ADD COLUMN IF NOT EXISTS ai_snippet text,
  ADD COLUMN IF NOT EXISTS ai_resource_type text,
  ADD COLUMN IF NOT EXISTS ai_folder_chunked boolean NOT NULL DEFAULT false;
