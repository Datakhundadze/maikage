import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type EventType = "page_visit" | "design_generated" | "product_selected";

export function useAnalytics() {
  const trackEvent = useCallback(async (eventType: EventType, eventData: Record<string, unknown> = {}) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("analytics_events").insert({
        event_type: eventType,
        event_data: eventData as any,
        user_id: user.id,
      });
    } catch {
      // Silently fail — analytics should never break the app
    }
  }, []);

  return { trackEvent };
}
