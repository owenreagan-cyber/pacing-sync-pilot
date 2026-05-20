ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS homeroom_notes_html text;
