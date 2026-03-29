import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "AIzaSyARSBYVsR8yho5kI3WdzJ0oKUpJBykouls";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Map internal gateway model names to real Gemini model IDs */
function mapModel(model: string): string {
  const map: Record<string, string> = {
    "google/gemini-2.5-flash-image": "gemini-2.0-flash-preview-image-generation",
    "google/gemini-3-pro-image-preview": "gemini-2.0-flash-preview-image-generation",
    "google/gemini-3-flash-preview": "gemini-2.0-flash",
  };
  return map[model] || "gemini-2.0-flash-preview-image-generation";
}

/** Convert OpenAI-style messages array to Gemini contents array */
function toGeminiContents(messages: any[]): any[] {
  return messages.map((msg) => {
    const parts: any[] = [];
    const content = msg.content;

    if (typeof content === "string") {
      parts.push({ text: content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const url: string = part.image_url?.url || "";
          if (url.startsWith("data:")) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/s);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          } else {
            // Regular URL — pass as fileData
            parts.push({ fileData: { mimeType: "image/jpeg", fileUri: url } });
          }
        }
      }
    }

    return { role: msg.role === "assistant" ? "model" : "user", parts };
  });
}

/** Extract base64 image from Gemini native response */
function extractImage(data: any): string | null {
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      const mime = part.inlineData.mimeType || "image/png";
      return `data:${mime};base64,${part.inlineData.data}`;
    }
    // Also handle snake_case variant just in case
    if (part?.inline_data?.data) {
      const mime = part.inline_data.mime_type || "image/png";
      return `data:${mime};base64,${part.inline_data.data}`;
    }
  }
  return null;
}

/** Extract text from Gemini native response */
function extractText(data: any): string {
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (typeof part?.text === "string") return part.text;
  }
  return "";
}

function getUserError(finishReason: string | undefined): string | null {
  if (finishReason === "IMAGE_PROHIBITED_CONTENT" || finishReason === "PROHIBITED_CONTENT") {
    return "The AI could not generate this image due to content policy restrictions. Try modifying your prompt or using different reference images.";
  }
  if (finishReason === "MAX_TOKENS") {
    return "The image was too complex to generate. Try simplifying your prompt or using smaller reference images.";
  }
  if (finishReason === "SAFETY" || finishReason === "BLOCKLIST") {
    return "The request was blocked by safety filters. Please adjust your prompt.";
  }
  if (finishReason === "RECITATION") {
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

async function callGemini(model: string, messages: any[], attempt: number, action: string): Promise<Response> {
  const needsImage = action !== "randomize-prompt";
  const geminiModel = mapModel(model);

  console.log(`[gemini-proxy] Gemini API call: model=${geminiModel}, attempt=${attempt + 1}, needsImage=${needsImage}`);

  const contents = toGeminiContents(messages);
  const body: any = { contents };
  if (needsImage) {
    body.generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
  }

  const url = `${GEMINI_BASE}/${geminiModel}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
            text: `You are a photorealistic image compositor. The user wants to see how a custom t-shirt design looks on them.

TASK: Replace the clothing on the person in the first image with a white t-shirt that has the design from the second image printed on it.

RULES:
- Keep the person's face, hair, skin, pose, and background EXACTLY the same
- The t-shirt must look natural with realistic folds and lighting
- Place the design centered on the chest area of the t-shirt
- The design should be clearly visible and properly scaled
- Do NOT change anything else in the image
- Output a single photorealistic image

Person image: [first image]
Design to place on t-shirt: [second image]`,
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
        const response = await callGemini(model, messages, attempt, action);

        if (!response.ok) {
          const status = response.status;
          const text = await response.text();
          console.error(`[gemini-proxy] Gemini HTTP ${status} (attempt ${attempt + 1}):`, text.slice(0, 800));

          if (status === 429) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Surface the actual Google API error for all other failures
          lastError = `Gemini ${status}: ${text.slice(0, 400)}`;
          if (attempt < maxAttempts - 1) {
            console.log(`[gemini-proxy] Retrying in ${(attempt + 1) * 2}s...`);
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }

          return new Response(JSON.stringify({ error: lastError }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const data = await response.json();
        const finishReason = data.candidates?.[0]?.finishReason;
        const textContent = extractText(data);

        // For randomize-prompt, just return text
        if (action === "randomize-prompt") {
          console.log(`[gemini-proxy] randomize-prompt success`);
          return new Response(JSON.stringify({ image: null, text: textContent }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract image from response
        const imageData = extractImage(data);
        console.log(`[gemini-proxy] attempt=${attempt + 1} hasImage=${!!imageData} finishReason=${finishReason}`);

        if (!imageData) {
          // Check for policy/safety blocks — don't retry those
          const userError = getUserError(finishReason);
          if (userError) {
            console.error(`[gemini-proxy] Blocked: ${finishReason}`);
            return new Response(JSON.stringify({ error: userError, text: textContent }), {
              status: 422,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Log response structure for debugging
          const responseKeys = JSON.stringify({
            hasCandidates: !!data.candidates,
            partsCount: data.candidates?.[0]?.content?.parts?.length ?? 0,
            partTypes: (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => Object.keys(p)),
            finishReason,
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
