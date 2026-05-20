-- 1. Add homeroom_notes_html column (idempotent)
ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS homeroom_notes_html text;

COMMENT ON COLUMN public.newsletters.homeroom_notes_html IS
  'Rich HTML for the Homeroom Notes card. When present, overrides the plain-text homeroom_notes field. Allows bold headings, links, and formatted content inside the card body.';

-- 2. Verify system_config row exists with correct prefixes
SELECT id, assignment_prefixes FROM public.system_config WHERE id = 'current';