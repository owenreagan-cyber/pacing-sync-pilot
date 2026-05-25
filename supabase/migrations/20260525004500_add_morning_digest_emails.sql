-- Add morning_digest_emails column to system_config for multiple morning digest recipients
ALTER TABLE public.system_config
  ADD COLUMN IF NOT EXISTS morning_digest_emails text[] NOT NULL DEFAULT '{}';

-- Seed Owen's email as the first morning digest recipient
UPDATE public.system_config
  SET morning_digest_emails = ARRAY['Owen.reagan@thalesacademy.org']
  WHERE id = 'current'
    AND (morning_digest_emails IS NULL OR morning_digest_emails = '{}');
