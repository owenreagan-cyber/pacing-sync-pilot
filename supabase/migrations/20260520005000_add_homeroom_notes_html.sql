ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS homeroom_notes_html text;

COMMENT ON COLUMN public.newsletters.homeroom_notes_html IS
  'Rich HTML for the Homeroom Notes card. When present, overrides the plain-text homeroom_notes field. Allows bold headings, links, and formatted content inside the card body.';
