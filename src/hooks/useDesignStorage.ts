import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface SaveDesignParams {
  title: string;
  prompt: string;
  product: string;
  color: string;
  placementX: number;
  placementY: number;
  placementScale: number;
  transparentImageDataUrl: string;
  mockupImageDataUrl: string;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function useDesignStorage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const saveDesign = useCallback(async (params: SaveDesignParams): Promise<string | null> => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to save designs.", variant: "destructive" });
      return null;
    }

    try {
      const uid = user.id;
      const id = crypto.randomUUID();
      const transparentPath = `${uid}/${id}-transparent.png`;
      const mockupPath = `${uid}/${id}-mockup.png`;

      // Upload images in parallel
      const [tBlob, mBlob] = await Promise.all([
        dataUrlToBlob(params.transparentImageDataUrl),
        dataUrlToBlob(params.mockupImageDataUrl),
      ]);

      const [tUpload, mUpload] = await Promise.all([
        supabase.storage.from("designs").upload(transparentPath, tBlob, { contentType: "image/png" }),
        supabase.storage.from("designs").upload(mockupPath, mBlob, { contentType: "image/png" }),
      ]);

      if (tUpload.error) throw tUpload.error;
      if (mUpload.error) throw mUpload.error;

      // Insert record
      const { error } = await supabase.from("designs").insert({
        id,
        user_id: uid,
        title: params.title,
        prompt: params.prompt,
        product: params.product,
        color: params.color,
        placement_x: params.placementX,
        placement_y: params.placementY,
        placement_scale: params.placementScale,
        transparent_image_path: transparentPath,
        mockup_image_path: mockupPath,
      });

      if (error) throw error;

      toast({ title: "Design saved!" });
      return id;
    } catch (err: any) {
      console.error("Save design failed:", err);
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      return null;
    }
  }, [user, toast]);

  const deleteDesign = useCallback(async (designId: string, transparentPath: string | null, mockupPath: string | null) => {
    try {
      const paths = [transparentPath, mockupPath].filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from("designs").remove(paths);
      const { error } = await supabase.from("designs").delete().eq("id", designId);
      if (error) throw error;
      toast({ title: "Design deleted" });
      return true;
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  const togglePublish = useCallback(async (designId: string, currentlyPublished: boolean) => {
    try {
      const { error } = await supabase.from("designs").update({ is_published: !currentlyPublished }).eq("id", designId);
      if (error) throw error;
      toast({ title: currentlyPublished ? "Unpublished" : "Published to community!" });
      return true;
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  const toggleLike = useCallback(async (designId: string, isLiked: boolean) => {
    if (!user) return false;
    try {
      if (isLiked) {
        await supabase.from("design_likes").delete().eq("design_id", designId).eq("user_id", user.id);
      } else {
        await supabase.from("design_likes").insert({ design_id: designId, user_id: user.id });
      }
      return true;
    } catch {
      return false;
    }
  }, [user]);

  const getPublicUrl = useCallback((path: string) => {
    return supabase.storage.from("designs").getPublicUrl(path).data.publicUrl;
  }, []);

  return { saveDesign, deleteDesign, togglePublish, toggleLike, getPublicUrl };
}
