import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Extract base64 image from various response formats the gateway might return */
function extractImage(data: any): string | null {
  // Format 1: content array with image_url objects
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "image_url" && part?.image_url?.url) return part.image_url.url;
      if (part?.type === "image" && part?.image_url?.url) return part.image_url.url;
      if (part?.inline_data?.data) {
        const mime = part.inline_data.mime_type || "image/png";
        return `data:${mime};base64,${part.inline_data.data}`;
      }
    }
  }

  // Format 2: separate images array on message
  const images = data?.choices?.[0]?.message?.images;
  if (Array.isArray(images) && images.length > 0) {
    if (images[0]?.image_url?.url) return images[0].image_url.url;
    if (images[0]?.url) return images[0].url;
    if (typeof images[0] === "string") return images[0];
  }

  // Format 3: top-level data array (images/generations style)
  if (Array.isArray(data?.data) && data.data[0]?.url) return data.data[0].url;
  if (Array.isArray(data?.data) && data.data[0]?.b64_json) {
    return `data:image/png;base64,${data.data[0].b64_json}`;
  }

  return null;
}

function getUserError(nativeFinishReason: string | undefined, finishReason: string | undefined): string | null {
  if (nativeFinishReason === "IMAGE_PROHIBITED_CONTENT" || nativeFinishReason === "PROHIBITED_CONTENT") {
    return "The AI could not generate this image due to content policy restrictions. Try modifying your prompt or using different reference images.";
  }
  if (nativeFinishReason === "MAX_TOKENS" || finishReason === "length") {
    return "The image was too complex to generate. Try simplifying your prompt or using smaller reference images.";
  }
  if (nativeFinishReason === "SAFETY" || nativeFinishReason === "BLOCKLIST") {
    return "The request was blocked by safety filters. Please adjust your prompt.";
  }
  if (nativeFinishReason === "RECITATION") {
    return "The AI could not generate an original image for this prompt. Try rephrasing.";
  }
  return null;
}

/** Sanitize youth-related terms to avoid content policy */
function sanitizeCharacter(character: string): string {
  return character.replace(
    /\b(boy|girl|child|kid|teen|teenager|minor|infant|baby|toddler)\b/gi,
    (match) => {
      const map: Record<string, string> = {
        boy: "young adult man", girl: "young adult woman", child: "adult person",
        kid: "adult person", teen: "young adult", teenager: "young adult",
        minor: "adult person", infant: "adult person", baby: "adult person",
        toddler: "adult person",
      };
      return map[match.toLowerCase()] || "adult person";
    }
  );
}

function buildGenerateDesignMessages(params: any) {
  const { character, characterImages, scene, sceneImage, style, styleImage, text: rawText, textImage, product, color } = params;
  const text = (rawText || "").trim();
  const safeCharacter = sanitizeCharacter(character || "No character specified");

  const content: any[] = [];
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
5. ABSOLUTELY NO Russian language, Cyrillic script, Russian words, or Russian cultural references. Use English or other non-Russian languages only.
6. ALL characters must be depicted as ADULTS (18+). Never depict minors or children.

CHARACTER/SUBJECT: ${safeCharacter}
${scene ? `SCENE/ACTION: ${scene}` : ""}
${style ? `ARTISTIC STYLE: ${style}` : ""}
${text ? `TYPOGRAPHY: Include the exact text "${text}" — legibility is priority, make it stylish and integrated` : "DO NOT include any text, words, letters, numbers, or typography of any kind in the design. The design must be purely visual/illustrative with absolutely no written elements."}

OUTPUT: A single square illustration on a solid pure white (#FFFFFF) background. No shadows, no frame, no extra elements.`,
  });

  if (characterImages?.length) {
    content.push({ type: "text", text: "Character reference images:" });
    for (const img of characterImages) {
      content.push({ type: "image_url", image_url: { url: img } });
    }
  }
  if (sceneImage) {
    content.push({ type: "text", text: "Scene reference:" });
    content.push({ type: "image_url", image_url: { url: sceneImage } });
  }
  if (styleImage) {
    content.push({ type: "text", text: "Style reference:" });
    content.push({ type: "image_url", image_url: { url: styleImage } });
  }
  if (textImage) {
    content.push({ type: "text", text: "Typography/font reference:" });
    content.push({ type: "image_url", image_url: { url: textImage } });
  }

  return [{ role: "user", content }];
}

async function callGateway(model: string, messages: any[], attempt: number, action: string): Promise<Response> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const needsImage = action !== "randomize-prompt";

  console.log(`[gemini-proxy] Gateway call: model=${model}, attempt=${attempt + 1}, modalities=${needsImage ? "image+text" : "text"}`);

  const body: any = { model, messages };
  if (needsImage) {
    body.modalities = ["image", "text"];
  }

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params } = await req.json();
    console.log(`[gemini-proxy] Action: ${action}`);

    let model: string;
    let messages: any[];

    if (action === "generate-design") {
      const speed = params.speed || "fast";
      model = speed === "fast" ? "google/gemini-2.5-flash-image" : "google/gemini-3-pro-image-preview";
      messages = buildGenerateDesignMessages(params);

    } else if (action === "convert-bg-black") {
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Change the background of this image from WHITE to PURE BLACK (#000000). Keep the subject/design EXACTLY identical — same colors, same details, same position. Only the white background should become pure black. Do not alter the subject in any way.",
          },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "upscale") {
      model = "google/gemini-3-pro-image-preview";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Upscale this image to 4K resolution (4096x4096). Keep exact same details, colors, composition. Just increase resolution with enhanced detail.",
          },
          { type: "image_url", image_url: { url: params.image } },
        ],
      }];

    } else if (action === "randomize-prompt") {
      model = "google/gemini-3-flash-preview";
      messages = [{
        role: "user",
        content: `You are a creative director for a streetwear merch brand. Generate a random, creative, unique design concept for a ${params.product || "hoodie"}.

Return ONLY a JSON object with these fields (no markdown, no explanation):
{
  "character": "A vivid character description (1-2 sentences)",
  "scene": "A scene/action/pose description (1 sentence)",
  "style": "An artistic style direction (1 sentence)",
  "text": "Optional catchy text/slogan to include (or empty string)"
}

Be wildly creative. Mix unexpected aesthetics: cyberpunk samurai, cosmic barista, underwater DJ, retro-futuristic gardener, etc. Make each concept unique and memorable.`,
      }];

    } else if (action === "virtual-tryon") {
      model = "google/gemini-2.5-flash-image";
      messages = [{
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a photorealistic image compositor.

TASK: Dress the person in the first photo with a ${params.colorName ? params.colorName + " " : ""}${params.productName || "t-shirt"} that has the design/print shown in the second image placed on the chest area.

EXPLICIT REQUIREMENTS:
- Garment type: ${params.productName || "t-shirt"} (NOT a different type)
- Garment color: ${params.colorName || "match the color shown in the second image"} (NOT white unless specified)
- Design/print: exactly as shown in the second image, centered on chest
- Person: face, hair, skin, pose, and background must stay EXACTLY the same
- The garment must have realistic folds and lighting

Output a single photorealistic image of the person wearing the ${params.colorName ? params.colorName + " " : ""}${params.productName || "t-shirt"} with the design.`,
          },
          { type: "image_url", image_url: { url: params.personImage } },
          { type: "image_url", image_url: { url: params.designImage } },
        ],
      }];

    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retry logic — up to 2 retries for image actions
    const maxAttempts = action === "randomize-prompt" ? 1 : 3;
    let lastError = "";

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await callGateway(model, messages, attempt, action);

        if (!response.ok) {
          const status = response.status;
          const text = await response.text();
          console.error(`[gemini-proxy] Gateway HTTP ${status} (attempt ${attempt + 1}):`, text.slice(0, 300));

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

          lastError = `Gateway returned ${status}`;
          if (attempt < maxAttempts - 1) {
            console.log(`[gemini-proxy] Retrying in ${(attempt + 1) * 2}s...`);
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }

          return new Response(JSON.stringify({ error: "AI generation failed. Please try again." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await response.json();
        const nativeFinishReason = data.choices?.[0]?.native_finish_reason;
        const finishReason = data.choices?.[0]?.finish_reason;
        const textContent = typeof data.choices?.[0]?.message?.content === "string"
          ? data.choices[0].message.content
          : "";

        // For randomize-prompt, just return text
        if (action === "randomize-prompt") {
          console.log(`[gemini-proxy] randomize-prompt success`);
          return new Response(JSON.stringify({ image: null, text: textContent }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract image from response
        const imageData = extractImage(data);
        console.log(`[gemini-proxy] attempt=${attempt + 1} hasImage=${!!imageData} finishReason=${finishReason} native=${nativeFinishReason}`);

        if (!imageData) {
          const userError = getUserError(nativeFinishReason, finishReason);
          if (userError) {
            console.error(`[gemini-proxy] Blocked: ${nativeFinishReason}`);
            return new Response(JSON.stringify({ error: userError, text: textContent }), {
              status: 422,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const responseKeys = JSON.stringify({
            hasChoices: !!data.choices,
            messageKeys: data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [],
            contentType: typeof data.choices?.[0]?.message?.content,
            contentIsArray: Array.isArray(data.choices?.[0]?.message?.content),
            finishReason,
            nativeFinishReason,
          });
          console.error(`[gemini-proxy] No image extracted (attempt ${attempt + 1}). Structure: ${responseKeys}`);

          lastError = "No image in response";
          if (attempt < maxAttempts - 1) {
            console.log(`[gemini-proxy] Retrying in ${(attempt + 1) * 2}s...`);
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }

          return new Response(JSON.stringify({ error: "AI did not return an image after multiple attempts. Please try again.", text: textContent }), {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Success
        console.log(`[gemini-proxy] Success: action=${action}, attempt=${attempt + 1}`);
        return new Response(JSON.stringify({ image: imageData, text: textContent }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      } catch (attemptErr) {
        lastError = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
        console.error(`[gemini-proxy] Attempt ${attempt + 1} exception:`, lastError);
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ error: `AI generation failed: ${lastError}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[gemini-proxy] Fatal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
