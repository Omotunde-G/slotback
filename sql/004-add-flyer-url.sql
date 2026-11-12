ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS flyer_url TEXT;
  