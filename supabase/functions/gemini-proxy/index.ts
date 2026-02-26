import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { action, params } = await req.json();

    let model: string;
    let messages: any[];

    if (action === "generate-design") {
      const { character, characterImages, scene, sceneImage, style, styleImage, text, textImage, product, color, speed } = params;
      
      model = speed === "fast" ? "google/gemini-2.5-flash-image" : "google/gemini-3-pro-image-preview";

      // Build multipart content
      const content: any[] = [];

      // System-like instruction as first text block
      content.push({
        type: "text",
        text: `You are an expert concept artist for a streetwear merchandise brand. Generate a design for printing on a ${product} (${color} color).

DESIGN SYSTEM:
- Character/Subject = WHO is in the design
- Scene/Action = The pose, environment, action
- Style = Art direction, visual aesthetic  
- Typography = Text to include

CRITICAL RULES:
1. Pure white background (#FFFFFF) — absolutely no gradients, shadows, or textures in background
2. Design must be a printable silhouette/illustration suitable for garment printing
3. High contrast, bold lines, vibrant colors
4. No frame, no border, no mockup — just the raw design on white

CHARACTER/SUBJECT: ${character || "No character specified"}
${scene ? `SCENE/ACTION: ${scene}` : ""}
${style ? `ARTISTIC STYLE: ${style}` : ""}
${text ? `TYPOGRAPHY: Include the exact text "${text}" — legibility is priority, make it stylish and integrated` : ""}

OUTPUT: A single square illustration on a solid pure white (#FFFFFF) background. No shadows, no frame, no extra elements.`
      });

      // Attach character reference images
      if (characterImages?.length) {
        content.push({ type: "text", text: "Character reference images:" });
        for (const img of characterImages) {
          content.push({ type: "image_url", image_url: { url: img } });
        }
      }

      // Attach scene reference
      if (sceneImage) {
        content.push({ type: "text", text: "Scene reference:" });
        content.push({ type: "image_url", image_url: { url: sceneImage } });
      }

      // Attach style reference
      if (styleImage) {
        content.push({ type: "text", text: "Style reference:" });
        content.push({ type: "image_url", image_url: { url: styleImage } });
      }

      // Attach text/font reference
      if (textImage) {
        content.push({ type: "text", text: "Typography/font reference:" });
        content.push({ type: "image_url", image_url: { url: textImage } });
      }

      messages = [{ role: "user", content }];

    } else if (action === "convert-bg-black") {
      model = "google/gemini-3-pro-image-preview";
      const { image } = params;
      
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Change the background of this image from WHITE to PURE BLACK (#000000). Keep the subject/design EXACTLY identical — same colors, same details, same position. Only the white background should become pure black. Do not alter the subject in any way."
          },
          { type: "image_url", image_url: { url: image } }
        ]
      }];

    } else if (action === "upscale") {
      model = "google/gemini-3-pro-image-preview";
      const { image } = params;
      
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Upscale this image to 4K resolution (4096x4096). Keep exact same details, colors, composition. Just increase resolution with enhanced detail."
          },
          { type: "image_url", image_url: { url: image } }
        ]
      }];

    } else if (action === "randomize-prompt") {
      model = "google/gemini-3-flash-preview";
      const { product } = params;

      messages = [{
        role: "user",
        content: `You are a creative director for a streetwear merch brand. Generate a random, creative, unique design concept for a ${product || "hoodie"}.

Return ONLY a JSON object with these fields (no markdown, no explanation):
{
  "character": "A vivid character description (1-2 sentences)",
  "scene": "A scene/action/pose description (1 sentence)",
  "style": "An artistic style direction (1 sentence)",
  "text": "Optional catchy text/slogan to include (or empty string)"
}

Be wildly creative. Mix unexpected aesthetics: cyberpunk samurai, cosmic barista, underwater DJ, retro-futuristic gardener, etc. Make each concept unique and memorable.`
      }];

    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const text = await response.text();
      console.error("AI gateway error:", status, text);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "AI generation failed. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract image from response
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const textContent = data.choices?.[0]?.message?.content;

    console.log("AI response - action:", action, "hasImage:", !!imageData, "textLength:", textContent?.length || 0);

    if (!imageData) {
      console.error("No image in AI response. Full response:", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI did not return an image. Please try again.", text: textContent }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ image: imageData, text: textContent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("gemini-proxy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
