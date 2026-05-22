-- Migration: Fix RLS security policies
-- Replaces overly permissive allow_all (FOR ALL USING (true)) policies with
-- explicit operation-specific policies requiring authenticated access.
-- Edge Functions use SUPABASE_SERVICE_ROLE_KEY and therefore bypass RLS entirely.

-- ============================================================
-- Helper: drop allow_all policy (handles both quoted and
-- unquoted variants used across migrations).
-- ============================================================

-- ===================== system_config ========================
DROP POLICY IF EXISTS "allow_all" ON public.system_config;
DROP POLICY IF EXISTS allow_all ON public.system_config;

CREATE POLICY system_config_authenticated_read
  ON public.system_config FOR SELECT
  TO authenticated USING (true);

CREATE POLICY system_config_authenticated_write
  ON public.system_config FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY system_config_authenticated_update
  ON public.system_config FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY system_config_authenticated_delete
  ON public.system_config FOR DELETE
  TO authenticated USING (true);

-- ========================= weeks ============================
DROP POLICY IF EXISTS "allow_all" ON public.weeks;
DROP POLICY IF EXISTS allow_all ON public.weeks;

CREATE POLICY weeks_authenticated_read
  ON public.weeks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY weeks_authenticated_write
  ON public.weeks FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY weeks_authenticated_update
  ON public.weeks FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY weeks_authenticated_delete
  ON public.weeks FOR DELETE
  TO authenticated USING (true);

-- ====================== pacing_rows =========================
DROP POLICY IF EXISTS "allow_all" ON public.pacing_rows;
DROP POLICY IF EXISTS allow_all ON public.pacing_rows;

CREATE POLICY pacing_rows_authenticated_read
  ON public.pacing_rows FOR SELECT
  TO authenticated USING (true);

CREATE POLICY pacing_rows_authenticated_write
  ON public.pacing_rows FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY pacing_rows_authenticated_update
  ON public.pacing_rows FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY pacing_rows_authenticated_delete
  ON public.pacing_rows FOR DELETE
  TO authenticated USING (true);

-- ======================= deploy_log =========================
DROP POLICY IF EXISTS "allow_all" ON public.deploy_log;
DROP POLICY IF EXISTS allow_all ON public.deploy_log;

CREATE POLICY deploy_log_authenticated_read
  ON public.deploy_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY deploy_log_authenticated_write
  ON public.deploy_log FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY deploy_log_authenticated_update
  ON public.deploy_log FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY deploy_log_authenticated_delete
  ON public.deploy_log FOR DELETE
  TO authenticated USING (true);

-- ========================= files ============================
DROP POLICY IF EXISTS "allow_all" ON public.files;
DROP POLICY IF EXISTS allow_all ON public.files;

CREATE POLICY files_authenticated_read
  ON public.files FOR SELECT
  TO authenticated USING (true);

CREATE POLICY files_authenticated_write
  ON public.files FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY files_authenticated_update
  ON public.files FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY files_authenticated_delete
  ON public.files FOR DELETE
  TO authenticated USING (true);

-- ===================== announcements ========================
DROP POLICY IF EXISTS "allow_all" ON public.announcements;
DROP POLICY IF EXISTS allow_all ON public.announcements;

CREATE POLICY announcements_authenticated_read
  ON public.announcements FOR SELECT
  TO authenticated USING (true);

CREATE POLICY announcements_authenticated_write
  ON public.announcements FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY announcements_authenticated_update
  ON public.announcements FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY announcements_authenticated_delete
  ON public.announcements FOR DELETE
  TO authenticated USING (true);

-- ====================== newsletters =========================
DROP POLICY IF EXISTS "allow_all" ON public.newsletters;
DROP POLICY IF EXISTS allow_all ON public.newsletters;

CREATE POLICY newsletters_authenticated_read
  ON public.newsletters FOR SELECT
  TO authenticated USING (true);

CREATE POLICY newsletters_authenticated_write
  ON public.newsletters FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY newsletters_authenticated_update
  ON public.newsletters FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY newsletters_authenticated_delete
  ON public.newsletters FOR DELETE
  TO authenticated USING (true);

-- ====================== content_map =========================
DROP POLICY IF EXISTS "allow_all" ON public.content_map;
DROP POLICY IF EXISTS allow_all ON public.content_map;

CREATE POLICY content_map_authenticated_read
  ON public.content_map FOR SELECT
  TO authenticated USING (true);

CREATE POLICY content_map_authenticated_write
  ON public.content_map FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY content_map_authenticated_update
  ON public.content_map FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY content_map_authenticated_delete
  ON public.content_map FOR DELETE
  TO authenticated USING (true);

-- ===================== teacher_memory =======================
DROP POLICY IF EXISTS "allow_all" ON public.teacher_memory;
DROP POLICY IF EXISTS allow_all ON public.teacher_memory;

CREATE POLICY teacher_memory_authenticated_read
  ON public.teacher_memory FOR SELECT
  TO authenticated USING (true);

CREATE POLICY teacher_memory_authenticated_write
  ON public.teacher_memory FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY teacher_memory_authenticated_update
  ON public.teacher_memory FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY teacher_memory_authenticated_delete
  ON public.teacher_memory FOR DELETE
  TO authenticated USING (true);

-- ================= teacher_feedback_log =====================
DROP POLICY IF EXISTS "allow_all" ON public.teacher_feedback_log;
DROP POLICY IF EXISTS allow_all ON public.teacher_feedback_log;

CREATE POLICY teacher_feedback_log_authenticated_read
  ON public.teacher_feedback_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY teacher_feedback_log_authenticated_write
  ON public.teacher_feedback_log FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY teacher_feedback_log_authenticated_update
  ON public.teacher_feedback_log FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY teacher_feedback_log_authenticated_delete
  ON public.teacher_feedback_log FOR DELETE
  TO authenticated USING (true);

-- ==================== teacher_patterns ======================
DROP POLICY IF EXISTS "allow_all" ON public.teacher_patterns;
DROP POLICY IF EXISTS allow_all ON public.teacher_patterns;

CREATE POLICY teacher_patterns_authenticated_read
  ON public.teacher_patterns FOR SELECT
  TO authenticated USING (true);

CREATE POLICY teacher_patterns_authenticated_write
  ON public.teacher_patterns FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY teacher_patterns_authenticated_update
  ON public.teacher_patterns FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY teacher_patterns_authenticated_delete
  ON public.teacher_patterns FOR DELETE
  TO authenticated USING (true);

-- ================= deploy_notifications =====================
DROP POLICY IF EXISTS "allow_all" ON public.deploy_notifications;
DROP POLICY IF EXISTS allow_all ON public.deploy_notifications;

CREATE POLICY deploy_notifications_authenticated_read
  ON public.deploy_notifications FOR SELECT
  TO authenticated USING (true);

CREATE POLICY deploy_notifications_authenticated_write
  ON public.deploy_notifications FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY deploy_notifications_authenticated_update
  ON public.deploy_notifications FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY deploy_notifications_authenticated_delete
  ON public.deploy_notifications FOR DELETE
  TO authenticated USING (true);

-- ==================== automation_jobs =======================
DROP POLICY IF EXISTS "allow_all" ON public.automation_jobs;
DROP POLICY IF EXISTS allow_all ON public.automation_jobs;

CREATE POLICY automation_jobs_authenticated_read
  ON public.automation_jobs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY automation_jobs_authenticated_write
  ON public.automation_jobs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY automation_jobs_authenticated_update
  ON public.automation_jobs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY automation_jobs_authenticated_delete
  ON public.automation_jobs FOR DELETE
  TO authenticated USING (true);

-- ================ system_health_snapshots ===================
DROP POLICY IF EXISTS "allow_all" ON public.system_health_snapshots;
DROP POLICY IF EXISTS allow_all ON public.system_health_snapshots;

CREATE POLICY system_health_snapshots_authenticated_read
  ON public.system_health_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY system_health_snapshots_authenticated_write
  ON public.system_health_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY system_health_snapshots_authenticated_update
  ON public.system_health_snapshots FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY system_health_snapshots_authenticated_delete
  ON public.system_health_snapshots FOR DELETE
  TO authenticated USING (true);

-- ==================== canvas_snapshots ======================
DROP POLICY IF EXISTS "allow_all" ON public.canvas_snapshots;
DROP POLICY IF EXISTS allow_all ON public.canvas_snapshots;

CREATE POLICY canvas_snapshots_authenticated_read
  ON public.canvas_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY canvas_snapshots_authenticated_write
  ON public.canvas_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY canvas_snapshots_authenticated_update
  ON public.canvas_snapshots FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY canvas_snapshots_authenticated_delete
  ON public.canvas_snapshots FOR DELETE
  TO authenticated USING (true);

-- ==================== canvas_patterns =======================
DROP POLICY IF EXISTS "allow_all" ON public.canvas_patterns;
DROP POLICY IF EXISTS allow_all ON public.canvas_patterns;

CREATE POLICY canvas_patterns_authenticated_read
  ON public.canvas_patterns FOR SELECT
  TO authenticated USING (true);

CREATE POLICY canvas_patterns_authenticated_write
  ON public.canvas_patterns FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY canvas_patterns_authenticated_update
  ON public.canvas_patterns FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY canvas_patterns_authenticated_delete
  ON public.canvas_patterns FOR DELETE
  TO authenticated USING (true);

-- ===================== learning_rules =======================
DROP POLICY IF EXISTS "allow_all" ON public.learning_rules;
DROP POLICY IF EXISTS allow_all ON public.learning_rules;

CREATE POLICY learning_rules_authenticated_read
  ON public.learning_rules FOR SELECT
  TO authenticated USING (true);

CREATE POLICY learning_rules_authenticated_write
  ON public.learning_rules FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY learning_rules_authenticated_update
  ON public.learning_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY learning_rules_authenticated_delete
  ON public.learning_rules FOR DELETE
  TO authenticated USING (true);

-- ================= annual_pacing_master =====================
DROP POLICY IF EXISTS "allow_all" ON public.annual_pacing_master;
DROP POLICY IF EXISTS allow_all ON public.annual_pacing_master;

CREATE POLICY annual_pacing_master_authenticated_read
  ON public.annual_pacing_master FOR SELECT
  TO authenticated USING (true);

CREATE POLICY annual_pacing_master_authenticated_write
  ON public.annual_pacing_master FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY annual_pacing_master_authenticated_update
  ON public.annual_pacing_master FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY annual_pacing_master_authenticated_delete
  ON public.annual_pacing_master FOR DELETE
  TO authenticated USING (true);

-- ==================== school_calendar =======================
DROP POLICY IF EXISTS "allow_all" ON public.school_calendar;
DROP POLICY IF EXISTS allow_all ON public.school_calendar;

CREATE POLICY school_calendar_authenticated_read
  ON public.school_calendar FOR SELECT
  TO authenticated USING (true);

CREATE POLICY school_calendar_authenticated_write
  ON public.school_calendar FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY school_calendar_authenticated_update
  ON public.school_calendar FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY school_calendar_authenticated_delete
  ON public.school_calendar FOR DELETE
  TO authenticated USING (true);

-- ================== canvas_orphan_files =====================
DROP POLICY IF EXISTS "allow_all" ON public.canvas_orphan_files;
DROP POLICY IF EXISTS allow_all ON public.canvas_orphan_files;

CREATE POLICY canvas_orphan_files_authenticated_read
  ON public.canvas_orphan_files FOR SELECT
  TO authenticated USING (true);

CREATE POLICY canvas_orphan_files_authenticated_write
  ON public.canvas_orphan_files FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY canvas_orphan_files_authenticated_update
  ON public.canvas_orphan_files FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY canvas_orphan_files_authenticated_delete
  ON public.canvas_orphan_files FOR DELETE
  TO authenticated USING (true);

-- ==================== dev_canvas_logs =======================
DROP POLICY IF EXISTS "allow_all_dev_logs" ON public.dev_canvas_logs;
DROP POLICY IF EXISTS "allow_all" ON public.dev_canvas_logs;
DROP POLICY IF EXISTS allow_all ON public.dev_canvas_logs;

CREATE POLICY dev_canvas_logs_authenticated_read
  ON public.dev_canvas_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY dev_canvas_logs_authenticated_write
  ON public.dev_canvas_logs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY dev_canvas_logs_authenticated_update
  ON public.dev_canvas_logs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY dev_canvas_logs_authenticated_delete
  ON public.dev_canvas_logs FOR DELETE
  TO authenticated USING (true);

-- ================== dev_canvas_snapshots ====================
DROP POLICY IF EXISTS "allow_all_dev_snapshots" ON public.dev_canvas_snapshots;
DROP POLICY IF EXISTS "allow_all" ON public.dev_canvas_snapshots;
DROP POLICY IF EXISTS allow_all ON public.dev_canvas_snapshots;

CREATE POLICY dev_canvas_snapshots_authenticated_read
  ON public.dev_canvas_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY dev_canvas_snapshots_authenticated_write
  ON public.dev_canvas_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY dev_canvas_snapshots_authenticated_update
  ON public.dev_canvas_snapshots FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY dev_canvas_snapshots_authenticated_delete
  ON public.dev_canvas_snapshots FOR DELETE
  TO authenticated USING (true);
