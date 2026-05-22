-- Canvas file-management optimization indexes for large-batch sync + registry queries
-- Safe rollout: IF NOT EXISTS only, no destructive schema changes.

CREATE INDEX IF NOT EXISTS files_needs_rename_updated_idx
  ON public.files (needs_rename, updated_at DESC);

CREATE INDEX IF NOT EXISTS files_confidence_subject_type_idx
  ON public.files (confidence, subject, type);

CREATE INDEX IF NOT EXISTS content_map_subject_type_synced_idx
  ON public.content_map (subject, type, last_synced DESC);

CREATE INDEX IF NOT EXISTS content_map_canvas_file_idx
  ON public.content_map (canvas_file_id)
  WHERE canvas_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS canvas_orphan_files_course_status_created_idx
  ON public.canvas_orphan_files (course_id, status, created_at);
