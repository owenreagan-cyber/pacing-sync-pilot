ALTER TABLE public.system_config
  ADD COLUMN IF NOT EXISTS admin_email text,
  ADD COLUMN IF NOT EXISTS morning_digest_emails text[] NOT NULL DEFAULT '{}';