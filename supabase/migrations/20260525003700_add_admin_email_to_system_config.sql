-- Add admin_email column to system_config for UI-configurable digest recipient
ALTER TABLE public.system_config
  ADD COLUMN IF NOT EXISTS admin_email text NOT NULL DEFAULT '';
