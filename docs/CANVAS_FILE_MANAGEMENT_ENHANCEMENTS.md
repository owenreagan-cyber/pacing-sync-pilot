# Canvas File Management Enhancements (May 2026)

## Scope Delivered

1. **System optimization**
   - Learning-rule cache loaded once per sync run (removes per-file rule lookup queries).
   - Retry-enabled Canvas API calls in sync/rename execution paths.
   - Added query indexes for high-volume `files`, `content_map`, and `canvas_orphan_files` reads.
   - Added normalized file-name sanitization to reduce rename failures.

2. **Folder organization**
   - Rename/execute flows now support nested folder paths (e.g. `Math/Q1/Week 3/Worksheets`).
   - Missing folders are created recursively and linked in one operation.

3. **Naming conventions**
   - Sync can consume configurable file naming templates from `system_config.auto_logic.file_naming_templates`.
   - Prefixes are read from `system_config.assignment_prefixes`.
   - Auto-increment fallback lesson numbering is applied when a rule/type exists but lesson number is missing.
   - Unicode/special characters are normalized and file names are capped to Canvas-safe length.

4. **Dashboard/UI**
   - Existing File Organizer and Content Registry continue to provide:
     - real-time counts (mapped/missing/rename queue),
     - bulk operations,
     - duplicate management and cleanup controls.

5. **Automation/triggers**
   - Nightly automation now includes:
     - pattern training (`canvas-pattern-train`),
     - duplicate scan (`canvas-detect-duplicates` in mark-only mode),
     - folder cleanup dry-run (`canvas-cleanup-folders`).

## Migration / Rollout

Apply the new index migration:

```bash
supabase migration up
```

Migration file:
- `supabase/migrations/20260522013000_canvas_file_management_optimization_indexes.sql`

## Rollback

If needed, drop only the new indexes:

```sql
DROP INDEX IF EXISTS public.files_needs_rename_updated_idx;
DROP INDEX IF EXISTS public.files_confidence_subject_type_idx;
DROP INDEX IF EXISTS public.content_map_subject_type_synced_idx;
DROP INDEX IF EXISTS public.content_map_canvas_file_idx;
DROP INDEX IF EXISTS public.canvas_orphan_files_course_status_created_idx;
```

## Monitoring

- Use `deploy_log` entries for:
  - `canvas-files-sync`
  - `canvas-file-rename`
  - `canvas-batch-classify`
  - `automation-nightly`
- Use `automation_jobs` for status/retry and resumable progress.
