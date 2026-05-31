-- Keep Health Monitor realtime updates available for anon frontend clients.
DROP POLICY IF EXISTS deploy_log_anon_read ON public.deploy_log;

CREATE POLICY deploy_log_anon_read
  ON public.deploy_log FOR SELECT
  TO anon USING (true);

-- Ensure deploy_log is present in realtime publication on all environments.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deploy_log;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;
