
-- Storage bucket for design images
INSERT INTO storage.buckets (id, name, public) VALUES ('designs', 'designs', true);

-- Storage policies
CREATE POLICY "Users can upload own designs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own designs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own designs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'designs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Public can view design images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'designs');

-- Designs table
CREATE TABLE public.designs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  prompt TEXT,
  product TEXT NOT NULL,
  color TEXT NOT NULL,
  placement_x REAL NOT NULL DEFAULT 0.5,
  placement_y REAL NOT NULL DEFAULT 0.28,
  placement_scale REAL NOT NULL DEFAULT 0.38,
  transparent_image_path TEXT,
  mockup_image_path TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

-- Users can CRUD their own designs
CREATE POLICY "Users can read own designs"
  ON public.designs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own designs"
  ON public.designs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own designs"
  ON public.designs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own designs"
  ON public.designs FOR DELETE
  USING (auth.uid() = user_id);

-- Anyone can read published designs (community gallery)
CREATE POLICY "Public can read published designs"
  ON public.designs FOR SELECT
  USING (is_published = true);

-- Timestamp trigger
CREATE TRIGGER update_designs_updated_at
  BEFORE UPDATE ON public.designs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for designs
ALTER PUBLICATION supabase_realtime ADD TABLE public.designs;

-- Likes table (one like per user per design)
CREATE TABLE public.design_likes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  design_id UUID NOT NULL REFERENCES public.designs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, design_id)
);

ALTER TABLE public.design_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read likes"
  ON public.design_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own likes"
  ON public.design_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes"
  ON public.design_likes FOR DELETE
  USING (auth.uid() = user_id);

-- Function to update likes_count on designs
CREATE OR REPLACE FUNCTION public.update_design_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.designs SET likes_count = likes_count + 1 WHERE id = NEW.design_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.designs SET likes_count = likes_count - 1 WHERE id = OLD.design_id;
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER on_like_change
  AFTER INSERT OR DELETE ON public.design_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_design_likes_count();
