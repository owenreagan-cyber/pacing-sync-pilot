-- Dev Canvas Logging Tables
-- Tracks dry-run deployments and snapshots for debugging & validation

CREATE TABLE IF NOT EXISTS dev_canvas_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_mode text NOT NULL CHECK (deployment_mode IN ('dry-run', 'live')),
  action text NOT NULL,
  subject text,
  course_id integer,
  page_url text,
  status text,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE dev_canvas_logs IS
  'Dry-run and live deployment logs. deployment_mode tracks whether this was a test or real deployment.';
COMMENT ON COLUMN dev_canvas_logs.deployment_mode IS
  'dry-run (test) or live (real Canvas update)';
COMMENT ON COLUMN dev_canvas_logs.action IS
  'e.g., page_deploy, assignment_sync, announcement_post';
COMMENT ON COLUMN dev_canvas_logs.metadata IS
  'Additional context: HTML hash, validation issues, retry attempts';

CREATE TABLE IF NOT EXISTS dev_canvas_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_mode text NOT NULL CHECK (deployment_mode IN ('dry-run', 'live')),
  subject text NOT NULL,
  course_id integer NOT NULL,
  page_url text NOT NULL,
  html_content text NOT NULL,
  validation_result jsonb,
  created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE dev_canvas_snapshots IS
  'Snapshots of Canvas page HTML before deployment. Used for debugging and FPK validation.';
COMMENT ON COLUMN dev_canvas_snapshots.deployment_mode IS
  'dry-run (test snapshot) or live (production snapshot)';
COMMENT ON COLUMN dev_canvas_snapshots.validation_result IS
  'FPK validation result: { pass: bool, issues: ValidationIssue[] }';

-- Enable RLS and allow all (dev environment)
ALTER TABLE dev_canvas_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_canvas_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_dev_logs" ON dev_canvas_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_dev_snapshots" ON dev_canvas_snapshots
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dev_canvas_logs_deployment_mode ON dev_canvas_logs(deployment_mode);
CREATE INDEX IF NOT EXISTS idx_dev_canvas_logs_subject ON dev_canvas_logs(subject);
CREATE INDEX IF NOT EXISTS idx_dev_canvas_logs_created_at ON dev_canvas_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_canvas_snapshots_deployment_mode ON dev_canvas_snapshots(deployment_mode);
CREATE INDEX IF NOT EXISTS idx_dev_canvas_snapshots_subject ON dev_canvas_snapshots(subject);
CREATE INDEX IF NOT EXISTS idx_dev_canvas_snapshots_course_id ON dev_canvas_snapshots(course_id);
