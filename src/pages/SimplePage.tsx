import { useState, useRef, useCallback, useMemo, useEffect, lazy, Suspense } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview, { type DesignLayer } from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Type, X, ChevronDown, Palette, Plus, ShoppingBag, Shirt } from "lucide-react";
import QuantityStepper from "@/components/QuantityStepper";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, BRAND_SIZES, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import { consumeConstructorSeed, type ConstructorSeed } from "@/lib/constructorSeed";
import { CONSTRUCTOR_APPLY_EVENT } from "@/lib/mockupSuggestion";
// Text-colour palette — shared with the /chat handoff so both validate against
// the same list. Same values, same order as the former local constant.
import { TEXT_COLORS, DEFAULT_TEXT_COLOR_HEX, resolveTextColorHex } from "@/lib/textColors";
import type { DesignState, DesignStateSide } from "@/lib/designState";
import { useAnalytics } from "@/hooks/useAnalytics";
import { calculatePrice } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getGuestSessionId } from "@/lib/guestSession";
import PriceDisplay from "@/components/PriceDisplay";
// OrderDialog ships ~21 KB (radix dialog + form code) and never renders on
// initial paint — wait until the customer actually opens it.
const OrderDialog = lazy(() => import("@/components/OrderDialog"));
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import ContactBar from "@/components/ContactBar";
import AppHeader from "@/components/AppHeader";
import SeoHead from "@/components/SeoHead";
import { runGenerationPipeline, callGemini, loadImage, restyleImage, editImage, RateLimitError, GenerationBlockedError } from "@/lib/generation";
import { useGenerationLimit } from "@/hooks/useGenerationLimit";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { getStyleOptions } from "@/lib/designStyles";
import { chromaKeyGreen } from "@/lib/chromaKey";
import { t } from "@/lib/i18n";
import type { AppStatus } from "@/hooks/useDesign";
import LoginModal from "@/components/LoginModal";
import TryOnModal from "@/components/TryOnModal";
import SimpleAiChatPanel, { type AiChatMessage } from "@/components/SimpleAiChatPanel";

const FONT_GROUPS = [
  {
    label: "ქართული ფონტები",
    fonts: [
      { name: "Noto Sans Georgian", family: "'Noto Sans Georgian', sans-serif" },
      { name: "Noto Serif Georgian", family: "'Noto Serif Georgian', serif" },
      { name: "BPG Arial", family: "'BPG Arial', sans-serif" },
      { name: "FiraGO", family: "'FiraGO', sans-serif" },
    ],
  },
  {
    label: "ინგლისური Sans",
    fonts: [
      { name: "Roboto", family: "'Roboto', sans-serif" },
      { name: "Open Sans", family: "'Open Sans', sans-serif" },
      { name: "Montserrat", family: "'Montserrat', sans-serif" },
      { name: "Oswald", family: "'Oswald', sans-serif" },
      { name: "Raleway", family: "'Raleway', sans-serif" },
      { name: "Arial", family: "Arial, sans-serif" },
      { name: "Verdana", family: "Verdana, sans-serif" },
      { name: "Tahoma", family: "Tahoma, sans-serif" },
    ],
  },
  {
    label: "ინგლისური Serif",
    fonts: [
      { name: "Playfair Display", family: "'Playfair Display', serif" },
      { name: "Merriweather", family: "'Merriweather', serif" },
      { name: "Garamond", family: "'Garamond', serif" },
      { name: "Times New Roman", family: "'Times New Roman', serif" },
    ],
  },
  {
    label: "სათაური / Display",
    fonts: [
      { name: "Impact", family: "Impact, sans-serif" },
      { name: "Anton", family: "'Anton', Impact, sans-serif" },
      { name: "Bebas Neue", family: "'Bebas Neue', Impact, sans-serif" },
    ],
  },
  {
    label: "Script / Mono",
    fonts: [
      { name: "Dancing Script", family: "'Dancing Script', cursive" },
      { name: "Pacifico", family: "'Pacifico', cursive" },
      { name: "Brush Script", family: "'Brush Script MT', cursive" },
      { name: "Monospace", family: "'Courier New', monospace" },
    ],
  },
];

const FONTS = FONT_GROUPS.flatMap((g) => g.fonts);



const LAYER_COLORS = [
  "bg-blue-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-rose-500",
  "bg-amber-500",
];

const MAX_PHOTOS = 5;

// Phase B restyle presets — shown as chips in the photo "Edit with AI" panel.
// Each `instruction` is style-only + subject-preserving; the gemini-proxy
// "restyle" action prepends a fixed server-side GUARD. Free-text overrides a
// chip. The preset list lives here in the frontend (not the proxy) so it can be
// tuned without redeploying the edge function.
const RESTYLE_PRESETS: { key: string; ge: string; en: string; instruction: string }[] = [
  // Pixar 3D first so it sits right after the "ფონის მოხსნა" (remove-bg) chip.
  { key: "pixar", ge: "Pixar 3D", en: "Pixar 3D",
    instruction: "Re-render this photo in a 3D animated movie style — Pixar-like soft rendering, smooth subsurface-scattering skin, soft global illumination, big expressive eyes, rounded stylized forms. Keep the same subject, pose and composition. Do NOT reproduce any real Pixar character, film, or brand — original styling only." },
  { key: "anime", ge: "ანიმე", en: "Anime",
    instruction: "Repaint this photo in modern Japanese anime style — clean cel-shading, bold ink outlines, expressive eyes, vibrant flat color. Keep the same subject, pose, composition and background layout." },
  { key: "watercolor", ge: "აკვარელი", en: "Watercolor",
    instruction: "Repaint this photo as a soft watercolor painting — visible paper texture, bleeding pigments, gentle washes and light brush strokes. Preserve the same subject, pose and composition." },
  { key: "oil", ge: "ზეთის ფერწერა", en: "Oil",
    instruction: "Render this photo as a classical oil painting — thick impasto brush strokes, rich layered color, painterly lighting on canvas. Keep the subject's identity, pose and composition unchanged." },
  { key: "popart", ge: "პოპ-არტი", en: "Pop art",
    instruction: "Restyle this photo as bold pop-art — high-contrast flat color blocks, halftone dots, thick outlines, Warhol/Lichtenstein aesthetic. Keep the same subject, pose and layout." },
  { key: "sketch", ge: "ესკიზი", en: "Pencil sketch",
    instruction: "Convert this photo into a detailed hand-drawn graphite pencil sketch — fine cross-hatching, soft shading, white-paper background. Preserve the subject, proportions and composition." },
  { key: "comic", ge: "კომიქსი", en: "Comic",
    instruction: "Restyle this photo as Western comic-book art — bold inked linework, cel shading, dramatic flat colors and subtle halftone. Keep the same subject, pose, expression and composition." },
  { key: "realistic", ge: "რეალისტური", en: "Realistic",
    instruction: "Re-render this photo as a hyperrealistic photograph — natural lighting, real skin and fabric textures, photographic depth of field and fine detail, no illustration or stylization. Keep the same subject, pose and composition." },
];

// Simple funnels the customer's whole sentence into the `character` param, so
// garment-priming words in their text (e.g. "a cat on a t-shirt") fight the
// shared prompt's no-garment guard — and the realistic branch has no explicit
// no-garment rule at all. Append this reinforcement to `character` on BOTH
// generation paths (with-bg and without-bg). Verbatim copy of the admin Trend
// Agent's GUARD_NO_GARMENT (src/components/admin/AiAgent.tsx) — the proven
// wording — kept Simple-local so the shared gemini-proxy prompt and the admin
// agent stay untouched. The customer's text is preserved as-is before this.
const GUARD_NO_GARMENT =
  "Output ONLY the standalone design artwork itself on a plain solid " +
  "white background. Do NOT draw or include any t-shirt, hoodie, garment, " +
  "apparel, clothing, fabric, mockup, folded shirt, hanger, or product of " +
  "any kind. No clothing item, no product photo, no shirt — just the " +
  "isolated graphic artwork, centered, ready to be printed.";

// WITHOUT-background mode only. The customer's free-text often implies a scene
// ("…on Tbilisi rooftops"), which the model renders as a full-frame
// environment — leaving no plain background for runTransparencyPipeline to
// isolate, so the result comes back as a rectangular scene WITH background.
// This steers generation toward a single isolated subject on solid white so
// the cut-out is clean. NOT applied in with-background mode (scenes are fine
// there). Simple-side only — the shared gemini-proxy prompt and the
// transparency pipeline internals stay untouched.
const GUARD_ISOLATE_BG =
  "CRITICAL: render the subject as a SINGLE ISOLATED design element on a PLAIN " +
  "SOLID WHITE (#FFFFFF) background. Do NOT draw any scenery, environment, " +
  "landscape, room, sky, ground, floor, wall, building, rooftop, city, street " +
  "or any background setting — even if the description mentions a place or " +
  "location, treat it ONLY as theme/style inspiration, NEVER as a literal " +
  "background. No full-frame scene, no rectangular photo, no border. The " +
  "background must be empty pure white so the artwork can be cleanly cut out.";

// Appended to the character prompt ONLY when the user provided a quoted slogan
// (rendered via the `text` param). The model tends to place typography on a
// paper/card/poster surface; this keeps the lettering as standalone graphics.
// Client-side only — the shared gemini-proxy prompt stays untouched.
const GUARD_SLOGAN_NO_CARD =
  "Render any text as bold STANDALONE typography/lettering floating directly " +
  "on the plain background — NOT placed on a paper, card, poster, sign, banner, " +
  "sticker, label, note, frame, or any rectangular backdrop surface. No sheet " +
  "of paper, no card, no poster behind the text — just the letters as isolated " +
  "graphic artwork.";

// Display-only watermark: draw "maika.ge" bottom-right (white + drop-shadow,
// mirroring compositeMockup's style) onto a copy of the image, preserving
// transparency. Used to brand the AI result shown in the panel and the shared
// image — NEVER the transferImage that goes onto the product/order. Separate
// from the byte-stable compositeMockup / runGenerationPipeline. Falls back to
// the original on any failure so a watermark hiccup never breaks the result.
async function watermarkForDisplay(dataUrl: string): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0);

    const fontSize = Math.max(14, Math.round(w * 0.032));
    ctx.font = `600 ${fontSize}px "BPG Nino Mtavruli", "Noto Sans Georgian", "Segoe UI", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("maika.ge", w - fontSize * 0.8, h - fontSize * 0.6);

    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

// Stable per-tab session id so all composite events from one customer's
// design session can be correlated when triaging an incident. Stored in
// sessionStorage so a page reload preserves the id across navigations.
function getCompositeSessionId(): string {
  try {
    if (typeof sessionStorage === "undefined") return "no-session";
    const KEY = "maika_composite_session_id";
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "no-session";
  }
}

// Fire-and-forget telemetry sink. Keeps console.warn for in-browser
// debugging and also persists the event to composite_events so a
// reproducible incident can be triaged from the DB. The insert is
// awaited only to attach an error log — we never block the compositor
// on it.
function logCompositeEvent(
  eventType: string,
  eventData: Record<string, unknown>,
) {
  console.warn("[composite-telemetry]", { function: eventType, ...eventData });
  // composite_events is a new table not yet in the generated Database
  // types — `as any` mirrors the pattern already used elsewhere for
  // schema-ahead-of-types inserts (see OrderDialog.tsx).
  void (supabase as any)
    .from("composite_events")
    .insert({
      session_id: getCompositeSessionId(),
      event_type: eventType,
      event_data: eventData,
    })
    .then((res: { error: { message: string } | null }) => {
      if (res?.error) {
        console.warn(
          "[composite-telemetry] insert failed:",
          res.error.message,
        );
      }
    });
}

// Render a text string to a TIGHT raster canvas (sized to the glyph box, with
// a little padding for accents/descenders), so the word can be scaled as one
// unit like a photo. `aspect` = canvas.width / canvas.height. Returns null for
// empty content. Used by the live editor preview AND both compositors, so the
// raster (hence its aspect) is produced identically everywhere.
function renderTextRasterCanvas(
  content: string,
  fontFamily: string,
  color: string,
  fontSize: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return null;
  measureCtx.font = `bold ${fontSize}px ${fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const w = measureCtx.measureText(line).width;
    if (w > widest) widest = w;
  }
  const lineHeight = fontSize * 1.25;
  const pad = Math.ceil(fontSize * 0.18);
  const w = Math.max(1, Math.ceil(widest) + pad * 2);
  const h = Math.max(1, Math.ceil(lineHeight * lines.length) + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  const startY = pad + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], w / 2, startY + i * lineHeight);
  }
  return canvas;
}

// Draw a text raster CONTAIN-fit into a window box (canvas px), centred at
// (winCx, winCy) and honouring rotation — the SAME window-box model photos use
// (drawPhotoOntoCanvas). The window box comes from the layer's coords.scale /
// scaleY, so the composited text matches the editor preview's object-contain
// render exactly (no fixed font size, no reflow, no clipping).
function drawTextContained(
  ctx: CanvasRenderingContext2D,
  content: string,
  fontFamily: string,
  color: string,
  fontSize: number,
  winCx: number,
  winCy: number,
  winW: number,
  winH: number,
  rotationDeg: number,
): void {
  const raster = renderTextRasterCanvas(content, fontFamily, color, fontSize);
  if (!raster || winW <= 0 || winH <= 0) return;
  const rasterAspect = raster.width / raster.height;
  const boxAspect = winW / winH;
  let drawW: number;
  let drawH: number;
  if (rasterAspect >= boxAspect) {
    drawW = winW;
    drawH = winW / rasterAspect;
  } else {
    drawH = winH;
    drawW = winH * rasterAspect;
  }
  if (rotationDeg) {
    ctx.save();
    ctx.translate(winCx, winCy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(raster, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  } else {
    ctx.drawImage(raster, winCx - drawW / 2, winCy - drawH / 2, drawW, drawH);
  }
}

interface PhotoLayer {
  id: string;
  image: string;
  coords: PlacementCoords;
  /** Source image's natural width / height. Populated asynchronously
   *  after the photo loads; used by DraggablePlacement to lock corner
   *  resize to this aspect so dragging doesn't stretch the image. */
  naturalAspect?: number;
  /** Source-image crop / pan state, in zone fractions (same units as
   *  `coords.scale`). `sourceScale` is the source width; `sourceOffsetX/Y`
   *  is the source center offset from the window center. Undefined means
   *  cover-fit-centered (the editor renders that as the implicit default).
   *  Becomes defined once the customer drags an edge handle or pans. */
  sourceScale?: number;
  sourceOffsetX?: number;
  sourceOffsetY?: number;
}

// Render a photo layer onto a 2D canvas, honoring either the legacy
// cover-fit mode (no source state) or the new crop mode (source state
// present). zone* params are in canvas pixels; the photo's coords/source
// are interpreted as zone fractions. Rotation is applied around the
// window center. Caller controls ctx.globalAlpha.
function drawPhotoOntoCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  zoneX: number,
  zoneY: number,
  zoneW: number,
  zoneH: number,
  photo: {
    coords: PlacementCoords;
    sourceScale?: number;
    sourceOffsetX?: number;
    sourceOffsetY?: number;
  },
): void {
  const winW = zoneW * photo.coords.scale;
  const winH = zoneH * (photo.coords.scaleY ?? photo.coords.scale);
  const winCx = zoneX + zoneW * photo.coords.x;
  const winCy = zoneY + zoneH * photo.coords.y;
  const winX = winCx - winW / 2;
  const winY = winCy - winH / 2;
  const rotationDeg = photo.coords.rotation ?? 0;

  const hasCropState =
    photo.sourceScale !== undefined &&
    photo.sourceOffsetX !== undefined &&
    photo.sourceOffsetY !== undefined &&
    photo.sourceScale > 0 &&
    img.naturalWidth > 0 &&
    img.naturalHeight > 0;

  if (hasCropState) {
    // Source rect in canvas pixels (the image's "physical" placement on
    // the t-shirt mockup, independent of the window box).
    const naturalAspect = img.naturalWidth / img.naturalHeight;
    const srcW_canvas = zoneW * photo.sourceScale!;
    const srcH_canvas = srcW_canvas / naturalAspect;
    const srcCx_canvas = winCx + zoneW * photo.sourceOffsetX!;
    const srcCy_canvas = winCy + zoneH * photo.sourceOffsetY!;
    const srcX_canvas = srcCx_canvas - srcW_canvas / 2;
    const srcY_canvas = srcCy_canvas - srcH_canvas / 2;

    // Intersection of source rect with the window — that's what's
    // actually visible. Clip pre-rotation in window-space coordinates.
    const destX = Math.max(srcX_canvas, winX);
    const destY = Math.max(srcY_canvas, winY);
    const destR = Math.min(srcX_canvas + srcW_canvas, winX + winW);
    const destB = Math.min(srcY_canvas + srcH_canvas, winY + winH);
    const destW = destR - destX;
    const destH = destB - destY;
    if (destW <= 0 || destH <= 0) return;

    // Map the visible portion back to image-native pixel space.
    const sxFrac = (destX - srcX_canvas) / srcW_canvas;
    const syFrac = (destY - srcY_canvas) / srcH_canvas;
    const swFrac = destW / srcW_canvas;
    const shFrac = destH / srcH_canvas;
    const sx = sxFrac * img.naturalWidth;
    const sy = syFrac * img.naturalHeight;
    const sw = swFrac * img.naturalWidth;
    const sh = shFrac * img.naturalHeight;

    if (rotationDeg) {
      ctx.save();
      ctx.translate(winCx, winCy);
      ctx.rotate((rotationDeg * Math.PI) / 180);
      ctx.drawImage(img, sx, sy, sw, sh, destX - winCx, destY - winCy, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destW, destH);
    }
    return;
  }

  // Legacy cover-fit mode: center-crop the image to fill the window.
  // Matches the visual rendering of orders placed before crop UX shipped.
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const winAspect = winW / winH;
  let srcX = 0;
  let srcY = 0;
  let srcW = img.naturalWidth;
  let srcH = img.naturalHeight;
  if (imgAspect > winAspect) {
    srcW = img.naturalHeight * winAspect;
    srcX = (img.naturalWidth - srcW) / 2;
  } else {
    srcH = img.naturalWidth / winAspect;
    srcY = (img.naturalHeight - srcH) / 2;
  }
  if (rotationDeg) {
    ctx.save();
    ctx.translate(winCx, winCy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(img, srcX, srcY, srcW, srcH, -winW / 2, -winH / 2, winW, winH);
    ctx.restore();
  } else {
    ctx.drawImage(img, srcX, srcY, srcW, srcH, winX, winY, winW, winH);
  }
}

interface TextLayer {
  id: string;
  content: string;
  font: typeof FONTS[0];
  color: string;
  coords: PlacementCoords;
  /** Tight text-raster aspect (rasterW / rasterH), filled in once the raster
   *  renders. Drives aspect-locked resize (so the whole word scales as one
   *  unit) and lets the compositors contain-fit, mirroring photo layers. */
  naturalAspect?: number;
}

interface SideData {
  photos: PhotoLayer[];
  texts: TextLayer[];
}

const MAX_TEXTS = 5;
const DEFAULT_TEXT_COORDS: PlacementCoords = { x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 };

// Stagger text #1..#N diagonally (up-right) from the default position so a
// newly-added text's placement frame doesn't land exactly on top of the
// previous one. Keeps the default box size. index = current text count.
function staggeredTextCoords(index: number): PlacementCoords {
  const step = 0.07;
  return {
    x: Math.min(0.9, Math.max(0.1, DEFAULT_TEXT_COORDS.x + index * step)),
    y: Math.min(0.9, Math.max(0.1, DEFAULT_TEXT_COORDS.y - index * step)),
    scale: DEFAULT_TEXT_COORDS.scale,
    scaleY: DEFAULT_TEXT_COORDS.scaleY ?? DEFAULT_TEXT_COORDS.scale,
  };
}

// True when a side has at least one non-empty text element.
const sideHasText = (s: SideData) => s.texts.some((tl) => tl.content.trim().length > 0);

// Build a human-readable, copyable summary of the user's text so the admin
// can see the exact text, font, and color without reading it off the mockup.
function buildTextPrompt(front: SideData, back: SideData): string | null {
  const parts: string[] = [];
  const fmt = (label: string, s: SideData) => {
    s.texts.forEach((tl, i) => {
      if (!tl.content.trim()) return;
      const suffix = s.texts.length > 1 ? ` #${i + 1}` : "";
      parts.push(
        `${label}${suffix}:\n` +
          `  ტექსტი: ${tl.content}\n` +
          `  ფონტი: ${tl.font.family}\n` +
          `  ფერი: ${tl.color}`
      );
    });
  };
  fmt("წინა მხარე", front);
  fmt("უკანა მხარე", back);
  return parts.length ? parts.join("\n\n") : null;
}

// Build the structured editor state for persistence. Photo URLs start as
// null and are filled in by the order/cart submission flow once the
// originals upload completes.
function buildDesignStateInput(
  frontData: SideData,
  backData: SideData,
  product: string,
  subProduct: string,
  color: string,
): DesignState | null {
  const buildSide = (s: SideData, view: "front" | "back"): DesignStateSide | null => {
    if (s.photos.length === 0 && !sideHasText(s)) return null;
    const resolvedSub = subProduct || catalog.getDefaultSubProduct(product as ProductType);
    const imageResult = catalog.findImageForColor(product as ProductType, resolvedSub, color as ProductColor, view);
    const zone = imageResult?.entry.placementZone;
    return {
      side: view,
      photos: s.photos.map((p, i) => ({
        url: null,
        x: p.coords.x,
        y: p.coords.y,
        scale: p.coords.scale,
        scaleY: p.coords.scaleY ?? p.coords.scale,
        rotation: p.coords.rotation ?? 0,
        z_order: i,
        natural_aspect: p.naturalAspect,
        source_scale: p.sourceScale,
        source_offset_x: p.sourceOffsetX,
        source_offset_y: p.sourceOffsetY,
      })),
      texts: s.texts
        .filter((tl) => tl.content.trim())
        .map((tl) => ({
          content: tl.content,
          font: tl.font.family,
          fontName: tl.font.name,
          color: tl.color,
          x: tl.coords.x,
          y: tl.coords.y,
          scale: tl.coords.scale,
          scaleY: tl.coords.scaleY ?? tl.coords.scale,
          rotation: tl.coords.rotation ?? 0,
          naturalAspect: tl.naturalAspect,
        })),
      zone: {
        x: zone?.x ?? 0.5,
        y: zone?.y ?? 0.5,
        width: zone?.scale ?? 1,
        height: zone?.scaleY ?? zone?.scale ?? 1,
      },
    };
  };
  const front = buildSide(frontData, "front");
  const back = buildSide(backData, "back");
  if (!front && !back) return null;
  return { version: 1, front, back };
}

// The empty placement frame uses zone-fill so a first-time upload lands
// exactly where the dashed box sits. Subsequent uploads use a smaller box
// offset from center so the customer can see each new photo distinctly
// instead of having every upload completely cover the previous one
// (which is what zone-fill defaults caused).
const DEFAULT_PHOTO_COORDS: PlacementCoords = { x: 0.5, y: 0.5, scale: 1, scaleY: 1 };

// Stagger photos #2..#N at half size in a small diagonal so collisions are
// visible. Customer is expected to drag/resize from there.
function staggeredPhotoCoords(index: number): PlacementCoords {
  const step = 0.08;
  return {
    x: Math.min(0.95, Math.max(0.05, 0.5 + (index - 1) * step)),
    y: Math.min(0.95, Math.max(0.05, 0.5 + (index - 1) * step)),
    scale: 0.5,
    scaleY: 0.5,
  };
}

const DEFAULT_SIDE: SideData = {
  photos: [],
  texts: [],
};

// ── Chest placement for a seeded layer ───────────────────────────────────
// Coords are ZONE-relative (see useProductConfig): x/y are fractions of the
// printable zone, x=0.5 is its horizontal centre, and x grows to the RIGHT on
// screen (compositeSide: winCx = zoneX + zoneW * coords.x).
//
// ⚠️ ORIENTATION: the product photos are FRONT views, so the garment faces the
// viewer — the WEARER'S left chest (the heart side) is on the VIEWER'S RIGHT,
// i.e. x > 0.5. "left-chest" therefore takes the LARGER x. Do not mirror this.
//
// Sizes derive from DEFAULT_TEXT_COORDS rather than being invented: a chest
// print is CHEST_SCALE_FACTOR of a centred print, applied to scale and scaleY
// alike so the default's aspect is preserved, and sits in the upper third of
// the zone.
// 0.55 read as a tiny mark rather than a chest print. 0.85 is the largest value
// that still keeps chest TEXT clearly smaller than a centred print: a literal
// 2x on the old linear size would be 0.4*0.55*2 = 0.44, which EXCEEDS the
// centred box's own 0.40 width. 0.85 gives ~1.55x linear (~2.4x area) and stays
// ~15% under centre. Overflow is safe at both chest positions: the hard ceiling
// at x=0.72 is 2*(1-0.72)=0.56, and the widest box here is the photo at 0.425
// (right edge 0.72+0.2125 = 0.9325 < 1.0).
const CHEST_SCALE_FACTOR = 0.85;
const CHEST_Y = 0.3;
const CHEST_X_OFFSET = 0.22;

export type SeedPlacement = "center" | "left-chest" | "right-chest";

/** Chest coords for a TEXT layer, scaled down from DEFAULT_TEXT_COORDS. */
function chestTextCoords(placement: "left-chest" | "right-chest"): PlacementCoords {
  const baseScaleY = DEFAULT_TEXT_COORDS.scaleY ?? DEFAULT_TEXT_COORDS.scale;
  return {
    // wearer's left = viewer's right = larger x
    x: placement === "left-chest" ? 0.5 + CHEST_X_OFFSET : 0.5 - CHEST_X_OFFSET,
    y: CHEST_Y,
    scale: DEFAULT_TEXT_COORDS.scale * CHEST_SCALE_FACTOR,
    scaleY: baseScaleY * CHEST_SCALE_FACTOR,
  };
}

/** Chest coords for a PHOTO layer, scaled down from the zone-fill default. */
function chestPhotoCoords(placement: "left-chest" | "right-chest"): PlacementCoords {
  return {
    x: placement === "left-chest" ? 0.5 + CHEST_X_OFFSET : 0.5 - CHEST_X_OFFSET,
    y: CHEST_Y,
    // Photos default to filling the zone (scale 1); a chest print is a fraction
    // of that. addPhotoLayer's contain-fit probe then preserves x/y and
    // recomputes scale/scaleY from this base, so the aspect stays correct.
    scale: CHEST_SCALE_FACTOR * 0.5,
    scaleY: CHEST_SCALE_FACTOR * 0.5,
  };
}

let photoIdCounter = 0;
let chatMsgCounter = 0;
let textIdCounter = 0;

export default function SimplePage() {
  const { lang, theme, toggleTheme } = useAppState();
  const productConfig = useProductConfig();
  const { trackEvent } = useAnalytics();
  const { user } = useAuth();
  const { addItem: addToCart, adding: addingToCart } = useCart();
  const { toast } = useToast();

  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    trackEvent("page_visit", { page: "simple" });
  }, [trackEvent]);

  // Track if generation was saved for current design session
  const [openFontPickerId, setOpenFontPickerId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Where the next uploaded photo will land (zone-relative). Defaults to
  // zone-fill, centred. The empty placement frame is wired to this so the
  // user can pre-position the upload by dragging the dashed box, and the
  // first uploaded photo lands exactly where they put it.
  const [nextPhotoCoords, setNextPhotoCoords] = useState<PlacementCoords>({
    x: 0.5, y: 0.5, scale: 1, scaleY: 1,
  });

  // Per-side state
  const [frontData, setFrontData] = useState<SideData>({ ...DEFAULT_SIDE });
  const [backData, setBackData] = useState<SideData>({ ...DEFAULT_SIDE });

  const currentView = productConfig.config.view;
  const isFront = currentView === "front";
  const sideData = isFront ? frontData : backData;
  const setSideData = isFront ? setFrontData : setBackData;

  // ── AI design (Phase 1) ──────────────────────────────────────────────
  // Guest quota = 2 (Studio keeps its default 5; shared hook is parameterized).
  const { checkLimit: checkAiLimit, recordGeneration: recordAiGeneration } = useGenerationLimit(2);
  const { saveDesign } = useDesignStorage();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStyle, setAiStyle] = useState("");
  const [aiWithBackground, setAiWithBackground] = useState(false); // default: without background
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState<AppStatus>("GENERATING_DESIGN");
  // resultImage = shown in the panel; transferImage = injected as a layer.
  const [aiResult, setAiResult] = useState<{ resultImage: string; transferImage: string; downloadImage: string } | null>(null);
  // Per-layer "Edit with AI": which photo's background removal is in flight
  // (null = none) — drives the button's loading/disabled state.
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  // Chat panel state: the transcript, which photo's chat edit is in flight
  // (edit-image / restyle — separate lock from bg-removal so each shows its
  // own pending state; all disable each other), and the collapsed/expanded
  // state of the generation options row (progressive disclosure).
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  const [chatEditingId, setChatEditingId] = useState<string | null>(null);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(true);
  // Last text-to-image prompt — the regenerate button re-runs it after the
  // chat input has been cleared.
  const lastGenPromptRef = useRef("");

  // Append a message to the merged chat transcript (module counter mirrors
  // photoIdCounter's id pattern).
  const pushChat = useCallback((msg: Omit<AiChatMessage, "id">) => {
    setChatMessages(prev => [...prev, { ...msg, id: `msg-${++chatMsgCounter}` }]);
  }, []);
  const [showTryOn, setShowTryOn] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalMessage, setLoginModalMessage] = useState<string | undefined>();
  // Anti-abuse generation block (server-enforced): true → persistent "place an
  // order / contact us" notice in the AI panel. Cleared on a successful generate.
  const [aiBlocked, setAiBlocked] = useState(false);
  const aiStyleOptions = getStyleOptions(lang);

  // Helpers to update current side
  const updateField = <K extends keyof SideData>(key: K, value: SideData[K]) => {
    setSideData(prev => ({ ...prev, [key]: value }));
  };

  // Resolve the placement zone for the current product/color/view so the
  // upload handler and the layer builder can derive contain / cover-fit
  // math in zone-fraction units. The zone aspect (not always square)
  // shows up because source `scale` is in zone-X-fraction terms.
  const zoneForLayers = useMemo(() => {
    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(
      config.product as ProductType,
      resolvedSub,
      config.color as ProductColor,
      currentView,
    );
    return imageResult?.entry.placementZone;
  }, [productConfig, currentView]);

  // Append a photo layer from a data URL. Used by BOTH the file upload and
  // the AI "transfer to product" action, so a generated design behaves
  // exactly like an uploaded photo — same default coords/zone, same async
  // contain-fit, same DraggablePlacement handles, same order/cart path.
  const addPhotoLayer = useCallback((dataUrl: string) => {
    const photoId = `photo-${++photoIdCounter}`;
    setSideData(prev => {
      if (prev.photos.length >= MAX_PHOTOS) return prev;
      const newPhoto: PhotoLayer = {
        id: photoId,
        image: dataUrl,
        // First photo: land at wherever the user dragged the empty
        // placement frame (or zone-fill default if they never moved it).
        // Subsequent photos: stagger at half-size so they don't cover
        // each other completely.
        coords:
          prev.photos.length === 0
            ? { ...nextPhotoCoords }
            : staggeredPhotoCoords(prev.photos.length),
      };
      return { ...prev, photos: [...prev.photos, newPhoto] };
    });
    // Auto-select the newly added photo so the keyboard delete handler
    // can target it without extra clicks.
    setSelectedLayerId(photoId);

    // Measure natural aspect asynchronously and apply CONTAIN-fit to the
    // photo's window so the entire image is visible by default — no
    // auto-crop, matching Canva / Figma / Photoshop behavior. Source state
    // is set explicitly so renderers skip the legacy cover-fit fallback.
    const probe = new Image();
    probe.onload = () => {
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      const naturalAspect = probe.naturalWidth / probe.naturalHeight;
      const zoneW = zoneForLayers?.scale ?? 1;
      const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
      const zonePixelAspect = zoneW / zoneH;
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p => {
          if (p.id !== photoId) return p;
          const baseScale = p.coords.scale;
          const baseScaleY = p.coords.scaleY ?? p.coords.scale;
          let newScale: number;
          let newScaleY: number;
          if (naturalAspect >= zonePixelAspect) {
            newScale = baseScale;
            newScaleY = baseScale * zoneW / (naturalAspect * zoneH);
          } else {
            newScaleY = baseScaleY;
            newScale = baseScaleY * naturalAspect * zoneH / zoneW;
          }
          return {
            ...p,
            naturalAspect,
            coords: { ...p.coords, scale: newScale, scaleY: newScaleY },
            sourceScale: newScale,
            sourceOffsetX: 0,
            sourceOffsetY: 0,
          };
        }),
      }));
    };
    probe.src = dataUrl;
  }, [setSideData, nextPhotoCoords, zoneForLayers]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addPhotoLayer(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [addPhotoLayer]);

  // ── AI generation handlers ───────────────────────────────────────────
  const handleAiGenerate = useCallback(async (promptOverride?: string) => {
    const text = (promptOverride ?? aiPrompt).trim();
    if (!text || aiGenerating) return;
    // A quoted phrase in the prompt is the slogan to render AS typography.
    // Passed via the `text` generation param (empty when no quote → the
    // model's default "no text" behavior is unchanged). Covers straight,
    // curly, Georgian („…“) and guillemet quotes.
    const slogan = text.match(/[«"„“”'`]([^«»"„“”'`]{2,120})[»"“”'`]/)?.[1]?.trim() ?? "";
    const limit = checkAiLimit();
    if (!limit.allowed) {
      if ('reason' in limit && limit.reason === "guest_limit") {
        setLoginModalMessage('message' in limit ? limit.message : undefined);
        setShowLoginModal(true);
      }
      return;
    }
    setAiGenerating(true);
    setAiStatus("GENERATING_DESIGN");
    setAiResult(null);
    try {
      recordAiGeneration();
      const { config } = productConfig;
      const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
      const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, config.view);
      const productImageUrl = imageResult?.entry?.imageUrl ?? null;
      const isExactColor = imageResult?.isExact ?? false;
      const zone = imageResult?.entry?.placementZone;
      const placementCoords = config.placementCoords;
      const isRealistic = /realistic|photo|რეალ/i.test(aiStyle || "");
      // Reinforce the no-garment constraint, mirroring the admin Trend Agent.
      // The user's intent is preserved verbatim; the guard is appended after.
      const characterWithGuard = `${text} ${GUARD_NO_GARMENT}${slogan ? ` ${GUARD_SLOGAN_NO_CARD}` : ""}`;

      let resultImage: string;
      let transferImage: string;
      let transparentImage: string | null;
      let mockupImage: string | null;

      if (!aiWithBackground) {
        // WITHOUT background → full existing pipeline incl. runTransparencyPipeline.
        // Append GUARD_ISOLATE_BG so the subject is rendered on plain white with
        // no scenery — otherwise a scene-y prompt fills the frame and there's
        // nothing for the transparency pipeline to cleanly isolate.
        const gen = await runGenerationPipeline(
          {
            designParams: { character: `${characterWithGuard} ${GUARD_ISOLATE_BG}`, scene: "", style: aiStyle, text: slogan, characterImages: [], sceneImage: null, styleImage: null, textImage: null },
            product: config.product,
            color: config.color,
            // A slogan forces the pro model. "fast" selects
            // gemini-2.5-flash-image, which garbles non-Latin scripts —
            // Georgian slogans come back as scrambled Mtavruli capitals
            // instead of the Mkhedruli that was asked for. This is the model
            // the retired Studio used for text (speed defaulted to "pro"),
            // so it restores the pre-regression behavior. Textless designs
            // stay on flash — no cost change there.
            speed: slogan ? "pro" : "fast",
          },
          placementCoords,
          productImageUrl,
          (s) => setAiStatus(s as AppStatus),
          isExactColor,
          zone,
        );
        // Result panel shows the STANDALONE design (bg-removed artwork), not
        // the watermarked product mockup — the mockup is for the product
        // preview / post-transfer. transferImage stays the transparent artwork
        // so transfer / upscale / try-on operate on the cut-out.
        resultImage = gen.transparentImage;
        transferImage = gen.transparentImage;
        transparentImage = gen.transparentImage;
        mockupImage = gen.mockupImage;
      } else {
        // WITH background → bare generate-design, SKIP the transparency stage.
        // Simple's own layer compositing places it on the product on transfer,
        // so no Stage-3 composite is needed here. The `isRealistic` flag (not a
        // style-string override) selects the verbatim realistic prompt branch
        // in the proxy — identical prompt to runGenerationPipeline's realistic path.
        const { image: rawImage } = await callGemini("generate-design", {
          character: characterWithGuard, scene: "", style: aiStyle, text: slogan,
          characterImages: [], sceneImage: null, styleImage: null, textImage: null,
          product: config.product, color: config.color,
          // Slogan → pro, same reason as the without-background path above.
          // Realistic already required pro (flash is biased toward illustration).
          speed: slogan || isRealistic ? "pro" : "fast", isRealistic,
        });
        resultImage = rawImage;
        transferImage = rawImage;
        transparentImage = null;
        mockupImage = rawImage;
      }

      // DISPLAY (resultImage) gets a "maika.ge" watermark baked in (display-only
      // — transferImage stays clean for transfer/order/upscale/try-on). The
      // SHARE image (downloadImage) must also be watermarked: without-bg's mockup
      // already is (compositeMockup bakes it), but with-bg's mockup is the raw
      // generation, so stamp it here.
      const displayImage = await watermarkForDisplay(resultImage);
      const shareImage = aiWithBackground ? await watermarkForDisplay(mockupImage) : mockupImage;
      setAiResult({ resultImage: displayImage, transferImage, downloadImage: shareImage });
      setAiBlocked(false); // a successful generation means we're not blocked

      // Analytics generations row — mirrors Studio's generation-time insert.
      void (async () => {
        try {
          const genId = crypto.randomUUID();
          const upload = async (dataUrl: string | null, suffix: string) => {
            if (!dataUrl) return null;
            const blob = await fetch(dataUrl).then(r => r.blob());
            const path = `generations/${genId}-${suffix}.png`;
            const { error } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
            return error ? null : path;
          };
          const [mockupPath, transparentPath] = await Promise.all([
            upload(mockupImage, "mockup"),
            upload(transparentImage, "transparent"),
          ]);
          await supabase.from("generations").insert({
            user_id: user?.id ?? null,
            session_id: !user ? getGuestSessionId() : null,
            is_guest: !user,
            product: config.product,
            color: config.color,
            style: aiStyle || "simple-ai",
            prompt: text,
            mockup_image_path: mockupPath,
            transparent_image_path: transparentPath,
          });
        } catch (e) {
          console.error("[Simple AI] generations insert failed:", e);
        }
      })();

      // Auto-save to "My Designs" (logged-in only; guests skip).
      if (user) {
        void saveDesign({
          title: text.slice(0, 60) || "AI Design",
          prompt: text,
          product: config.product,
          color: config.color,
          placementX: placementCoords.x,
          placementY: placementCoords.y,
          placementScale: placementCoords.scale,
          transparentImageDataUrl: transparentImage ?? transferImage,
          mockupImageDataUrl: mockupImage ?? transferImage,
        }).catch((e) => console.error("[Simple AI] My Designs save failed:", e));
      }

      trackEvent("design_generated", { product: config.product, mode: "simple-ai" });
    } catch (err) {
      // Anti-abuse block (403): persistent "place an order / contact us" notice
      // in the panel — NOT the login modal (the user is already logged in).
      if (err instanceof GenerationBlockedError) {
        setAiBlocked(true);
      } else if (err instanceof RateLimitError) {
        // Server-side rate limit (429): anon → login modal, authed → toast.
        if (err.requiresLogin) {
          setLoginModalMessage(t(lang, "rateLimit.signIn"));
          setShowLoginModal(true);
        } else {
          toast({ title: t(lang, "rateLimit.slowDownTitle"), description: t(lang, "rateLimit.slowDown") });
        }
      } else {
        toast({ title: t(lang, "simpleAi.error"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      }
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, aiStyle, aiWithBackground, aiGenerating, checkAiLimit, recordAiGeneration, productConfig, user, saveDesign, trackEvent, toast, lang]);

  const handleAiTransfer = useCallback(() => {
    if (!aiResult) return;
    if (sideData.photos.length >= MAX_PHOTOS) {
      toast({ title: t(lang, "simpleAi.maxPhotos"), variant: "destructive" });
      return;
    }
    addPhotoLayer(aiResult.transferImage);
    toast({ title: t(lang, "simpleAi.transferred") });
  }, [aiResult, sideData.photos.length, addPhotoLayer, toast, lang]);

  // Surface each completed generation as a chat message. Keyed on the result
  // object's identity so re-renders don't duplicate the append —
  // handleAiGenerate's internals stay untouched.
  const lastResultRef = useRef<typeof aiResult>(null);
  useEffect(() => {
    if (aiResult && aiResult !== lastResultRef.current) {
      lastResultRef.current = aiResult;
      pushChat({ role: "assistant", image: aiResult.resultImage, kind: "generated" });
    }
  }, [aiResult, pushChat]);

  // Share the (already-watermarked) result image via the native share sheet on
  // mobile. downloadImage is the watermarked mockup (without-bg) / watermarked
  // raw (with-bg) — never the clean transferImage. Falls back to a Web-Share
  // text/url, then to a plain download, on platforms without file sharing.
  const handleAiShare = useCallback(async () => {
    if (!aiResult) return;
    const src = aiResult.downloadImage;
    const title = "maika.ge";
    const text = lang === "en" ? "Check out my design on maika.ge" : "ნახე ჩემი დიზაინი maika.ge-ზე";
    try {
      const blob = await fetch(src).then((r) => r.blob());
      const file = new File([blob], "maika-design.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
        return;
      }
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url: window.location.origin });
        return;
      }
      // No Web Share API (most desktops) → download the watermarked image.
      const a = document.createElement("a");
      a.href = src;
      a.download = "maika-design.png";
      a.click();
      toast({ title: lang === "en" ? "Image saved" : "სურათი შენახულია" });
    } catch (err) {
      // User-cancelled the native sheet → no-op. Other errors → toast.
      if (err instanceof Error && err.name === "AbortError") return;
      toast({
        title: lang === "en" ? "Share failed" : "გაზიარება ვერ მოხერხდა",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, [aiResult, lang, toast]);

  // Measure a (possibly new) image's natural aspect and re-apply CONTAIN-fit to
  // an EXISTING photo layer — keeps the layer's position, recomputes scale for
  // the new aspect. Mirrors addPhotoLayer's probe; used by background removal,
  // whose transparent cutout can have a different aspect than the original.
  const applyContainFit = useCallback((photoId: string, dataUrl: string) => {
    const probe = new Image();
    probe.onload = () => {
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      const naturalAspect = probe.naturalWidth / probe.naturalHeight;
      const zoneW = zoneForLayers?.scale ?? 1;
      const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
      const zonePixelAspect = zoneW / zoneH;
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p => {
          if (p.id !== photoId) return p;
          const baseScale = p.coords.scale;
          const baseScaleY = p.coords.scaleY ?? p.coords.scale;
          let newScale: number;
          let newScaleY: number;
          if (naturalAspect >= zonePixelAspect) {
            newScale = baseScale;
            newScaleY = baseScale * zoneW / (naturalAspect * zoneH);
          } else {
            newScaleY = baseScaleY;
            newScale = baseScaleY * naturalAspect * zoneH / zoneW;
          }
          return {
            ...p,
            naturalAspect,
            coords: { ...p.coords, scale: newScale, scaleY: newScaleY },
            sourceScale: newScale,
            sourceOffsetX: 0,
            sourceOffsetY: 0,
          };
        }),
      }));
    };
    probe.src = dataUrl;
  }, [setSideData, zoneForLayers]);

  // Per-layer "Edit with AI" → Remove background (A2, photo-appropriate path).
  // gemini-proxy "isolate-subject" puts the subject on a GREEN chroma screen,
  // then chromaKeyGreen keys the green to transparency client-side. Photos are
  // deliberately NOT sent through the design pipeline's convert-bg-black +
  // difference matting (runTransparencyPipeline), which returns a silhouette/
  // mask for photographic subjects. Replaces the layer image + re-fits (cutout
  // aspect may differ). 429 → login modal / slow-down toast like other AI calls.
  const handleRemoveBgPhoto = useCallback(async (photo: PhotoLayer) => {
    if (editingPhotoId) return;
    setEditingPhotoId(photo.id);
    try {
      const { image: greenBg } = await callGemini("isolate-subject", { image: photo.image });
      const transparentImage = await chromaKeyGreen(greenBg);
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p => (p.id === photo.id ? { ...p, image: transparentImage } : p)),
      }));
      applyContainFit(photo.id, transparentImage);
      toast({ title: lang === "en" ? "Background removed ✓" : "ფონი მოიხსნა ✓" });
    } catch (err) {
      if (err instanceof RateLimitError) {
        if (err.requiresLogin) {
          setLoginModalMessage(t(lang, "rateLimit.signIn"));
          setShowLoginModal(true);
        } else {
          toast({ title: t(lang, "rateLimit.slowDownTitle"), description: t(lang, "rateLimit.slowDown") });
        }
      } else {
        toast({
          title: lang === "en" ? "Background removal failed" : "ფონის მოხსნა ვერ მოხერხდა",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    } finally {
      setEditingPhotoId(null);
    }
  }, [editingPhotoId, applyContainFit, setSideData, toast, lang]);

  // Chat edit — the merged panel's free-text / chip edit path. Mirrors the
  // retired handleRestylePhoto pattern exactly (write the result back into the
  // SAME clean p.image slot — never watermarked, flows straight to
  // transfer/order — and re-fit since the output aspect may differ), with the
  // proxy action switched by mode: "edit" → edit-image (general
  // instruction-following, e.g. "add a hat"), "restyle" → restyle
  // (style-transfer-only guard; used by the preset chips). Appends the result
  // (or an error note) to the chat transcript.
  const handleChatEdit = useCallback(async (photo: PhotoLayer, instruction: string, mode: "edit" | "restyle") => {
    if (editingPhotoId || chatEditingId || aiGenerating) return;
    const text = instruction.trim();
    if (!text) return;
    setChatEditingId(photo.id);
    try {
      const edited = mode === "restyle"
        ? await restyleImage(photo.image, text)
        : await editImage(photo.image, text);
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p => (p.id === photo.id ? { ...p, image: edited } : p)),
      }));
      applyContainFit(photo.id, edited);
      pushChat({ role: "assistant", image: edited, kind: "edited" });
    } catch (err) {
      if (err instanceof GenerationBlockedError) {
        setAiBlocked(true);
      } else if (err instanceof RateLimitError) {
        if (err.requiresLogin) {
          setLoginModalMessage(t(lang, "rateLimit.signIn"));
          setShowLoginModal(true);
        } else {
          toast({ title: t(lang, "rateLimit.slowDownTitle"), description: t(lang, "rateLimit.slowDown") });
        }
      } else {
        toast({
          title: lang === "en" ? "Edit failed" : "რედაქტირება ვერ მოხერხდა",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
      pushChat({
        role: "assistant",
        text: lang === "en" ? "Couldn't apply that — please try again." : "ვერ შესრულდა — სცადე თავიდან.",
        kind: "error",
      });
    } finally {
      setChatEditingId(null);
    }
  }, [editingPhotoId, chatEditingId, aiGenerating, applyContainFit, setSideData, pushChat, toast, lang]);

  // ── Chat orchestration (merged panel) ──────────────────────────────────
  // Routing rule: no photo layers → free text is a text-to-image prompt
  // (handleAiGenerate, untouched); a photo exists → free text is an edit
  // command for the ACTIVE layer (selected, else most recent) via edit-image.
  // Preset chips stay on restyle; the bg chip stays on handleRemoveBgPhoto.
  const activeChatPhoto =
    sideData.photos.find(p => p.id === selectedLayerId) ??
    sideData.photos[sideData.photos.length - 1] ??
    null;

  const chatBusy = aiGenerating || chatEditingId !== null || editingPhotoId !== null;

  const handleChatSubmit = useCallback(() => {
    const text = aiPrompt.trim();
    if (!text || chatBusy) return;
    pushChat({ role: "user", text });
    if (activeChatPhoto) {
      handleChatEdit(activeChatPhoto, text, "edit");
    } else {
      lastGenPromptRef.current = text;
      handleAiGenerate(text);
    }
    setAiPrompt("");
  }, [aiPrompt, chatBusy, activeChatPhoto, handleChatEdit, handleAiGenerate, pushChat]);

  const handleChatPresetChip = useCallback((preset: { ge: string; en: string; instruction: string }) => {
    if (!activeChatPhoto || chatBusy) return;
    pushChat({ role: "user", text: lang === "en" ? preset.en : preset.ge });
    handleChatEdit(activeChatPhoto, preset.instruction, "restyle");
  }, [activeChatPhoto, chatBusy, handleChatEdit, pushChat, lang]);

  const handleChatRemoveBg = useCallback(() => {
    if (!activeChatPhoto || chatBusy) return;
    pushChat({ role: "user", text: lang === "en" ? "Remove background" : "ფონის მოხსნა" });
    handleRemoveBgPhoto(activeChatPhoto);
  }, [activeChatPhoto, chatBusy, handleRemoveBgPhoto, pushChat, lang]);

  const handleChatRegenerate = useCallback(() => {
    if (chatBusy || !lastGenPromptRef.current) return;
    pushChat({ role: "user", text: lastGenPromptRef.current });
    handleAiGenerate(lastGenPromptRef.current);
  }, [chatBusy, handleAiGenerate, pushChat]);

  // Open the inline virtual try-on modal with the generated design. TryOnModal
  // owns the whole flow (person upload → gemini-proxy "virtual-tryon" → result)
  // including its own 429 handling, so the user stays inside Simple.
  const handleAiTryOn = useCallback(() => {
    if (!aiResult) return;
    setShowTryOn(true);
  }, [aiResult]);

  // Proceed from a try-on RESULT straight to the order flow. Ensures the
  // tried-on design is actually placed on the product (reusing the same
  // addPhotoLayer path as transfer; it self-guards MAX_PHOTOS), then opens
  // the existing Simple OrderDialog. Mockups are rebuilt by the debounced
  // recompute effect from the updated design and read live by OrderDialog
  // at submit time. Wired into TryOnModal via its optional onOrder prop.
  const handleAiOrder = useCallback(() => {
    if (!aiResult) return;
    const alreadyPlaced = sideData.photos.some(p => p.image === aiResult.transferImage);
    if (!alreadyPlaced) addPhotoLayer(aiResult.transferImage);
    setShowTryOn(false);
    // Size gate mirrors the main order button: brand-sized products (and
    // phone cases) need a size before the order form can open.
    const needsSize = (BRAND_SIZES[productConfig.config.subProduct]?.length > 0) || productConfig.config.product === "Phone Case";
    if (needsSize && !productConfig.config.size) {
      setSizeError(true);
      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSizeError(false);
    setOrderDialogOpen(true);
  }, [aiResult, sideData.photos, addPhotoLayer, productConfig.config.subProduct, productConfig.config.product, productConfig.config.size]);

  const aiTransferLabel = (() => {
    const p = productConfig.config.product;
    if (p === "T-Shirt") return t(lang, "simpleAi.transferTshirt");
    if (p === "Hoodie") return t(lang, "simpleAi.transferHoodie");
    if (p === "Tote Bag") return t(lang, "simpleAi.transferBag");
    return t(lang, "simpleAi.transferDefault");
  })();

  const removePhoto = (id: string) => {
    setSideData(prev => ({
      ...prev,
      photos: prev.photos.filter(p => p.id !== id),
    }));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  // ── Text layers (multi-text) ──────────────────────────────────────────
  const addTextLayer = useCallback(() => {
    const id = `text-${++textIdCounter}`;
    setSideData(prev => {
      if (prev.texts.length >= MAX_TEXTS) return prev;
      const newText: TextLayer = {
        id,
        content: "",
        font: FONTS[0],
        color: "#000000",
        coords: staggeredTextCoords(prev.texts.length),
      };
      return { ...prev, texts: [...prev.texts, newText] };
    });
    // Auto-select so the empty text's DraggablePlacement frame + handles show
    // immediately — the user can position it first, then type into it.
    setSelectedLayerId(id);
    setOpenFontPickerId(null);
  }, [setSideData]);

  const updateText = useCallback((id: string, patch: Partial<Omit<TextLayer, "id">>) => {
    setSideData(prev => ({
      ...prev,
      texts: prev.texts.map(tl => tl.id === id ? { ...tl, ...patch } : tl),
    }));
  }, [setSideData]);

  const removeText = useCallback((id: string) => {
    setSideData(prev => ({
      ...prev,
      texts: prev.texts.filter(tl => tl.id !== id),
    }));
    setSelectedLayerId(prev => (prev === id ? null : prev));
    setOpenFontPickerId(prev => (prev === id ? null : prev));
  }, [setSideData]);

  // ── Constructor seed intake (one-shot) ───────────────────────────────
  // A sender (today: the /chat "ესკიზის ნახვა" button) stashes a design in
  // localStorage and opens "/?constructor=1" in a NEW TAB. localStorage is used
  // because sessionStorage is per-tab and would be empty here.
  //
  // The seed is CONSUMED on mount — read and deleted in one step, into a ref,
  // BEFORE anything is applied — so it can never replay, and so the phased
  // application below can keep reading it after it is gone from storage.
  //
  // Product / brand / colour / side travel INSIDE the same seed (their usual
  // home, `maika-product-config`, is sessionStorage and is likewise empty in a
  // new tab), and are applied through useProductConfig's own setters one phase
  // per effect run — setProduct resets brand and colour, so the order
  // product → brand → colour → side matters and each must settle before the
  // next. Layers are only added once the config matches.
  //
  // APPENDS ONLY: existing frontData/backData layers are never cleared or
  // replaced, and a side already at MAX_PHOTOS / MAX_TEXTS silently skips that
  // layer rather than dropping the customer's own work.
  const seedAppliedRef = useRef(false);
  const seedRef = useRef<ConstructorSeed | null | undefined>(undefined);
  // Bumped by the in-place listener below to re-run the applier for a payload
  // that arrived from the floating widget while this page is already mounted.
  const [seedNonce, setSeedNonce] = useState(0);

  // IN-PLACE handoff. The floating widget is on every page, including this one,
  // where opening a new tab would be absurd. It dispatches a cancelable event;
  // we load the payload into the SAME ref the mount seed uses, reset the guard
  // and bump the nonce so the existing phased applier below runs it unchanged.
  // preventDefault() is what tells the dispatcher a live constructor took it.
  useEffect(() => {
    const onApply = (e: Event) => {
      const detail = (e as CustomEvent<ConstructorSeed>).detail;
      if (!detail) return;
      seedRef.current = detail;
      seedAppliedRef.current = false;
      setSeedNonce((n) => n + 1);
      e.preventDefault();
    };
    window.addEventListener(CONSTRUCTOR_APPLY_EVENT, onApply);
    return () => window.removeEventListener(CONSTRUCTOR_APPLY_EVENT, onApply);
  }, []);
  useEffect(() => {
    if (seedAppliedRef.current) return;
    if (seedRef.current === undefined) {
      // Reads AND deletes in one step, before any of it is applied.
      seedRef.current = consumeConstructorSeed();
    }
    const seed = seedRef.current;
    if (!seed) {
      seedAppliedRef.current = true;
      return;
    }

    // Product selection, one phase per run (each setter resets the next level).
    if (seed.product && seed.product !== productConfig.config.product) {
      productConfig.setProduct(seed.product as ProductType);
      return;
    }
    if (seed.subProduct && seed.subProduct !== productConfig.config.subProduct) {
      productConfig.setSubProduct(seed.subProduct);
      return;
    }
    if (seed.color && seed.color !== productConfig.config.color) {
      productConfig.setColor(seed.color as ProductColor);
      return;
    }
    // Align the view before seeding; this effect re-runs once it settles.
    if (seed.side && seed.side !== currentView) {
      productConfig.setView(seed.side);
      return;
    }
    // ── GENERATION seed (stage 1) ────────────────────────────────────
    // Runs only AFTER the product phases above have settled, because
    // handleAiGenerate reads productConfig.config (product/colour/view) and
    // the aiStyle / aiWithBackground state to build its request. Each is its
    // own phase so React has committed it before the next one reads it.
    if (seed.generate) {
      if (seed.generate.style !== undefined && seed.generate.style !== aiStyle) {
        setAiStyle(seed.generate.style);
        return;
      }
      const wantBg = seed.generate.withBackground === true;
      if (wantBg !== aiWithBackground) {
        setAiWithBackground(wantBg);
        return;
      }
      seedAppliedRef.current = true;
      // Call the EXISTING entry point with a prompt override — never the
      // pipeline directly. handleAiGenerate owns GUARD_NO_GARMENT,
      // GUARD_ISOLATE_BG, the slogan quote-extraction and the forced-Pro
      // routing for Georgian slogans; bypassing it would reintroduce the
      // Georgian typography regression. Its internals are untouched.
      void handleAiGenerate(seed.generate.prompt);
      return;
    }

    // A chest placement for a PHOTO is applied through the constructor's own
    // mechanism: nextPhotoCoords is "where the empty frame sits", and
    // addPhotoLayer uses it verbatim for the first photo. Set it, then let this
    // effect re-run and add the layer — deterministic, with no post-hoc patch
    // racing addPhotoLayer's async contain-fit probe (which preserves x/y and
    // recomputes scale from whatever base it finds).
    const chest = seed.placement === "left-chest" || seed.placement === "right-chest"
      ? seed.placement
      : null;
    if (seed.image && chest) {
      const want = chestPhotoCoords(chest);
      if (nextPhotoCoords.x !== want.x || nextPhotoCoords.y !== want.y || nextPhotoCoords.scale !== want.scale) {
        setNextPhotoCoords(want);
        return;
      }
    }

    seedAppliedRef.current = true;

    // Photo: reuse the existing add path so the async naturalAspect probe and
    // contain-fit behave exactly as they do for a manual upload.
    if (seed.image) {
      addPhotoLayer(seed.image);
    }

    // Text: same layer shape addTextLayer builds (Georgian FONTS[0], black,
    // staggered coords) but with the seeded content, so the rasterisation
    // effect picks it up and fills naturalAspect normally.
    const seedText = seed.text?.trim();
    if (seedText) {
      const id = `text-${++textIdCounter}`;
      let added = false;
      setSideData((prev) => {
        if (prev.texts.length >= MAX_TEXTS) return prev;
        added = true;
        const newText: TextLayer = {
          id,
          content: seedText,
          font: FONTS[0],
          // Palette-only: an unknown name resolves to null and falls back to
          // the default, so an arbitrary hex can never be injected.
          color: resolveTextColorHex(seed.textColor) ?? DEFAULT_TEXT_COLOR_HEX,
          // No placement (or "center", or anything unrecognised) keeps today's
          // behaviour byte-for-byte: staggeredTextCoords(0) IS DEFAULT_TEXT_COORDS.
          coords: chest ? chestTextCoords(chest) : staggeredTextCoords(prev.texts.length),
        };
        return { ...prev, texts: [...prev.texts, newText] };
      });
      // Select the text last so it wins when a photo was seeded too, matching
      // normal add behaviour (the most recently added layer is selected).
      if (added) setSelectedLayerId(id);
    }
  }, [currentView, productConfig, addPhotoLayer, setSideData, nextPhotoCoords, aiStyle, aiWithBackground, handleAiGenerate, seedNonce]);

  // Pressing Delete or Backspace on a selected layer removes it. Skipped
  // when the focus is in a text input/textarea so the user can still edit
  // their text content normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (!selectedLayerId) return;
      if (selectedLayerId.startsWith("text-")) {
        removeText(selectedLayerId);
      } else {
        removePhoto(selectedLayerId);
      }
      setSelectedLayerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

  const updatePhotoCoords = useCallback((id: string, coords: PlacementCoords) => {
    setSideData(prev => ({
      ...prev,
      photos: prev.photos.map(p => p.id === id ? { ...p, coords } : p),
    }));
  }, [setSideData]);

  const updatePhotoSource = useCallback(
    (id: string, source: { scale: number; offsetX: number; offsetY: number }) => {
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p =>
          p.id === id
            ? {
                ...p,
                sourceScale: source.scale,
                sourceOffsetX: source.offsetX,
                sourceOffsetY: source.offsetY,
              }
            : p,
        ),
      }));
    },
    [setSideData],
  );

  const clearDesign = () => {
    setSideData(prev => ({
      ...prev,
      photos: [],
      texts: [],
    }));
  };

  // Render each text element to its own transparent canvas image, keyed by
  // text id, for the live preview layers. Recomputes when the current side's
  // texts change. Multiline via \n.
  const [textImages, setTextImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      const aspects: Record<string, number> = {};
      for (const tl of sideData.texts) {
        if (!tl.content.trim()) continue;
        // Tight raster (same helper the compositors use) so object-contain in
        // the preview fills the window box snugly and the word never crops.
        const raster = renderTextRasterCanvas(tl.content, tl.font.family, tl.color, 160);
        if (!raster) continue;
        next[tl.id] = raster.toDataURL("image/png");
        aspects[tl.id] = raster.width / raster.height;
      }
      if (cancelled) return;
      setTextImages(next);
      // Store each text's raster aspect on its layer (drives the aspect-locked
      // resize + the compositors) and snug-fit the window height to that aspect
      // — only when the aspect actually CHANGED, so this never loops and never
      // fights an in-flight resize (resize keeps the aspect, so it's a no-op).
      setSideData((prev) => {
        const zoneW = zoneForLayers?.scale ?? 1;
        const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
        let changed = false;
        const texts = prev.texts.map((tl) => {
          const aspect = aspects[tl.id];
          if (!aspect || aspect <= 0) return tl;
          if (tl.naturalAspect !== undefined && Math.abs(tl.naturalAspect - aspect) < 0.002) return tl;
          changed = true;
          const newScaleY = zoneH > 0 ? (tl.coords.scale * zoneW) / (aspect * zoneH) : (tl.coords.scaleY ?? tl.coords.scale);
          return { ...tl, naturalAspect: aspect, coords: { ...tl.coords, scaleY: newScaleY } };
        });
        return changed ? { ...prev, texts } : prev;
      });
    });
    return () => { cancelled = true; };
  }, [sideData.texts, zoneForLayers, setSideData]);

  // Initial cover-fit source state for a photo whose customer hasn't yet
  // dragged an edge handle / panned. Matches what `object-cover` does
  // visually: source covers the window, with the longer dimension
  // extending beyond. The compositors and live preview both treat
  // missing source state as equivalent to this default.
  const coverFitSource = useCallback(
    (photo: PhotoLayer): { scale: number; offsetX: number; offsetY: number } | undefined => {
      const naturalAspect = photo.naturalAspect;
      if (!naturalAspect || naturalAspect <= 0) return undefined;
      const zoneW = zoneForLayers?.scale ?? 1;
      const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
      const winScale = photo.coords.scale;
      const winScaleY = photo.coords.scaleY ?? photo.coords.scale;
      // Box pixel aspect (assuming square parent): (winScale × zoneW) / (winScaleY × zoneH).
      const boxAspect = (winScale * zoneW) / (winScaleY * zoneH);
      let sourceScale: number;
      if (naturalAspect >= boxAspect) {
        // Image is wider than box: source matches box HEIGHT, extends horizontally.
        sourceScale = (winScaleY * zoneH * naturalAspect) / zoneW;
      } else {
        // Image is taller than box: source matches box WIDTH.
        sourceScale = winScale;
      }
      return { scale: sourceScale, offsetX: 0, offsetY: 0 };
    },
    [zoneForLayers],
  );

  // Faint "ტექსტი" hint shown inside an EMPTY text layer's draggable frame so
  // the user has something to grab before typing. Editor-overlay only — never
  // composited into the mockup or print file (both skip empty texts).
  const textPlaceholder = useMemo(() => {
    if (typeof document === "undefined") return "";
    const W = 800, H = 240;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(120,120,120,0.5)";
    ctx.font = '600 96px "Noto Sans Georgian", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lang === "en" ? "Text" : "ტექსტი", W / 2, H / 2);
    return canvas.toDataURL("image/png");
  }, [lang]);

  // Build layers array
  const layers = useMemo<DesignLayer[]>(() => {
    const result: DesignLayer[] = [];
    sideData.photos.forEach((photo, index) => {
      // If the customer has already cropped/panned this photo we carry
      // those stored values through. Otherwise we synthesize a cover-fit
      // default so DraggablePlacement always has a defined source state
      // to drag from (without it, the first edge-drag would shift from 0).
      const storedSource =
        photo.sourceScale !== undefined && photo.sourceOffsetX !== undefined && photo.sourceOffsetY !== undefined
          ? { scale: photo.sourceScale, offsetX: photo.sourceOffsetX, offsetY: photo.sourceOffsetY }
          : coverFitSource(photo);
      result.push({
        id: photo.id,
        image: photo.image,
        coords: photo.coords,
        onCoordsChange: (c) => updatePhotoCoords(photo.id, c),
        accentClass: LAYER_COLORS[index % LAYER_COLORS.length],
        selected: selectedLayerId === photo.id,
        onSelect: () => setSelectedLayerId(photo.id),
        naturalAspect: photo.naturalAspect,
        source: storedSource,
        onSourceChange: (s) => updatePhotoSource(photo.id, s),
      });
    });
    sideData.texts.forEach((tl) => {
      // Empty text → faint placeholder so its DraggablePlacement frame is
      // grabbable immediately; non-empty text → its rendered image (once ready).
      const img = tl.content.trim() ? textImages[tl.id] : textPlaceholder;
      if (!img) return;
      result.push({
        id: tl.id,
        image: img,
        coords: tl.coords,
        onCoordsChange: (c) => setSideData(prev => ({
          ...prev,
          texts: prev.texts.map((x) => x.id === tl.id ? { ...x, coords: c } : x),
        })),
        accentClass: "bg-emerald-500",
        selected: selectedLayerId === tl.id,
        onSelect: () => setSelectedLayerId(tl.id),
        // Text carries naturalAspect (no crop `source`) → aspect-locked resize
        // (whole word scales as one unit) + object-contain render in the preview.
        naturalAspect: tl.naturalAspect,
      });
    });
    return result;
  }, [sideData.photos, sideData.texts, textImages, textPlaceholder, setSideData, updatePhotoCoords, updatePhotoSource, coverFitSource, selectedLayerId]);

  const hasPhotos = sideData.photos.length > 0;
  // The currently-selected PHOTO layer (undefined when nothing or a text layer
  // is selected) — drives the per-layer "Edit with AI" affordance.
  const selectedPhoto = sideData.photos.find(p => p.id === selectedLayerId);
  const canAddMore = sideData.photos.length < MAX_PHOTOS;

  // Wait for the user-selected font to actually be loaded before drawing
  // text on canvas. Without this the browser silently falls back to a system
  // font when canvas runs faster than the network request to fonts.googleapis,
  // which produced order mockups where the text either looked wrong or was so
  // small at fallback metrics that it was invisible at admin thumbnail size.
  const ensureFontReady = async (fontFamily: string) => {
    if (typeof document === "undefined" || !document.fonts) return;
    try {
      // Pull just the first family ("'Playfair Display', serif" → "Playfair Display").
      const first = fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (first) await (document as any).fonts.load(`bold 80px "${first}"`);
      await document.fonts.ready;
    } catch { /* fonts API best-effort */ }
  };

  // Composite layers onto product image for a given side
  const compositeSide = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !sideHasText(side)) return null;
    for (const tl of side.texts) {
      if (tl.content.trim()) await ensureFontReady(tl.font.family);
    }

    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, view);
    const baseImageUrl = imageResult?.entry.imageUrl ?? null;
    const needsColorFilter = imageResult ? !imageResult.isExact : false;
    const zone = imageResult?.entry.placementZone;

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;

    // Draw product base. For non-exact colors (e.g. GIORDANO Black uses the
     // White base image), tint with luminance-based RGB multiplication so the
     // composited mockup matches the live preview. Canvas CSS filters are
     // unreliable across browsers / image origins, so we manipulate pixels
     // directly — same logic as ProductPreview's colorizeImage().
     if (baseImageUrl) {
       try {
         const img = new Image();
         img.crossOrigin = "anonymous";
         await new Promise<void>((resolve, reject) => {
           img.onload = () => resolve();
           img.onerror = () => reject();
           img.src = baseImageUrl;
         });
         ctx.drawImage(img, 0, 0, 800, 800);
         if (needsColorFilter) {
           const colorEntry = COLORS.find((c) => c.name === config.color);
           const baseHex = colorEntry?.hex ?? "#FFFFFF";
           // Pure black would zero out shadow detail; #1a1a1a preserves texture.
           const targetHex = config.color === "Black" ? "#1a1a1a" : baseHex;
           const r = parseInt(targetHex.slice(1, 3), 16);
           const g = parseInt(targetHex.slice(3, 5), 16);
           const b = parseInt(targetHex.slice(5, 7), 16);
           const imageData = ctx.getImageData(0, 0, 800, 800);
           const data = imageData.data;
           for (let i = 0; i < data.length; i += 4) {
             if (data[i + 3] === 0) continue;
             const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
             const t = lum / 255;
             data[i] = Math.round(r * t);
             data[i + 1] = Math.round(g * t);
             data[i + 2] = Math.round(b * t);
           }
           ctx.putImageData(imageData, 0, 0);
         }
       } catch {
         ctx.fillStyle = "#f0f0f0";
         ctx.fillRect(0, 0, 800, 800);
       }
     } else {
       ctx.fillStyle = "#f0f0f0";
       ctx.fillRect(0, 0, 800, 800);
     }

    // Zone geometry (in canvas pixels) — still used for positioning photos
    // since coords are zone-relative, but no longer used to clip drawing.
    // Customers can now drag layers anywhere on the t-shirt (sleeves,
    // hem, etc.) and the mockup reflects exactly what they placed.
    const zoneW = zone ? 800 * zone.scale : 800;
    const zoneH = zone ? 800 * (zone.scaleY ?? zone.scale) : 800;
    const zoneX = zone ? 800 * zone.x - zoneW / 2 : 0;
    const zoneY = zone ? 800 * zone.y - zoneH / 2 : 0;

    // Draw photo layers (positioned via zone offset; clipping removed —
    // off-zone parts are visible on the mockup, matching the live preview).
    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        drawPhotoOntoCanvas(ctx, img, zoneX, zoneY, zoneW, zoneH, photo);
      } catch { /* skip */ }
    }

    // [composite-telemetry] Captures the exact state the compositor sees
    // so a future incident can be triaged from composite_events without
    // depending on the customer's browser DevTools. Insert is fire-and-
    // forget; the compositor never blocks on it.
    {
      const firstText = side.texts.find((tl) => tl.content.trim());
      logCompositeEvent("compositeSide", {
        side: view,
        hasPhotos: side.photos.length > 0,
        photoCount: side.photos.length,
        hasText: sideHasText(side),
        textCount: side.texts.filter((tl) => tl.content.trim()).length,
        textPreview: firstText?.content.slice(0, 30) ?? "",
        zoneX, zoneY, zoneW, zoneH,
        fontFaceReady:
          typeof document !== "undefined" && document.fonts
            ? document.fonts.check('bold 80px "Noto Sans Georgian"')
            : null,
        timestamp: Date.now(),
      });
    }

    // Draw EVERY text element via the SAME window-box model photos use: the
    // text raster is contain-fit into the box the user sized (coords.scale ×
    // scaleY) at coords.x/y, so the mockup matches the editor preview exactly
    // (no fixed font size, no reflow, no clipping). 800 = mockup canvas width.
    for (const tl of side.texts) {
      if (!tl.content.trim()) continue;
      const tc = tl.coords;
      const winW = zoneW * tc.scale;
      const winH = zoneH * (tc.scaleY ?? tc.scale);
      const winCx = zoneX + zoneW * tc.x;
      const winCy = zoneY + zoneH * tc.y;
      drawTextContained(
        ctx, tl.content, tl.font.family, tl.color, Math.round(800 * 0.3),
        winCx, winCy, winW, winH, tc.rotation ?? 0,
      );
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Composite design-only (photos + text on transparent background, no product)
  // Used as the "print file" saved alongside the full mockup.
  //
  // Output is sized to the full mockup-canvas area (not the zone) so the
  // print file contains every layer the customer placed, including ones
  // that extend onto sleeves, hem, or beyond the dashed editor zone. The
  // print shop is free to crop to the actual garment area at their end.
  //
  // Resolution: 4000 px on the longer side. The mockup source is always
  // 800×800, so this is 5× linear scale ≈ 5x DPI on the source mockup.
  // For a 33×33 cm t-shirt print area that's ~300 DPI — enough for DTG /
  // sublimation print. The user's investigation suggested 5900×7080 for
  // a 50×60 cm rectangular front at 300 DPI, but our mockup canvas is
  // square and capping at 4000 keeps the data-URL size manageable while
  // still well above print-quality at common print sizes.
  const compositeDesignOnly = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !sideHasText(side)) return null;
    for (const tl of side.texts) {
      if (tl.content.trim()) await ensureFontReady(tl.font.family);
    }

    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, view);
    const zone = imageResult?.entry.placementZone;

    const PRINT_MAX = 4000;
    const canvasW = PRINT_MAX;
    const canvasH = PRINT_MAX;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;

    // Zone in print-canvas pixels — used to map zone-relative photo coords
    // to t-shirt-canvas positions, the same way compositeSide does.
    const printZoneW = zone ? canvasW * zone.scale : canvasW;
    const printZoneH = zone ? canvasH * (zone.scaleY ?? zone.scale) : canvasH;
    const printZoneX = zone ? canvasW * zone.x - printZoneW / 2 : 0;
    const printZoneY = zone ? canvasH * zone.y - printZoneH / 2 : 0;

    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        drawPhotoOntoCanvas(ctx, img, printZoneX, printZoneY, printZoneW, printZoneH, photo);
      } catch { /* skip */ }
    }

    // [composite-telemetry] same as compositeSide above.
    {
      const firstText = side.texts.find((tl) => tl.content.trim());
      logCompositeEvent("compositeDesignOnly", {
        side: view,
        hasPhotos: side.photos.length > 0,
        photoCount: side.photos.length,
        hasText: sideHasText(side),
        textCount: side.texts.filter((tl) => tl.content.trim()).length,
        textPreview: firstText?.content.slice(0, 30) ?? "",
        zoneX: printZoneX,
        zoneY: printZoneY,
        zoneW: printZoneW,
        zoneH: printZoneH,
        canvasW,
        canvasH,
        fontFaceReady:
          typeof document !== "undefined" && document.fonts
            ? document.fonts.check('bold 80px "Noto Sans Georgian"')
            : null,
        timestamp: Date.now(),
      });
    }

    // Draw EVERY text element into the print file via the same window-box
    // contain-fit as compositeSide (a dropped/mis-sized text = wrong product),
    // so the print file matches the editor + the mockup. Raster rendered at
    // print resolution (canvasW * 0.3) so it stays crisp when contain-fit.
    for (const tl of side.texts) {
      if (!tl.content.trim()) continue;
      const tc = tl.coords;
      const winW = printZoneW * tc.scale;
      const winH = printZoneH * (tc.scaleY ?? tc.scale);
      const winCx = printZoneX + printZoneW * tc.x;
      const winCy = printZoneY + printZoneH * tc.y;
      drawTextContained(
        ctx, tl.content, tl.font.family, tl.color, Math.round(canvasW * 0.3),
        winCx, winCy, winW, winH, tc.rotation ?? 0,
      );
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Save Simple mode design to generations table
  const saveToGenerations = useCallback(async (frontMockup: string | null, backMockup: string | null, designOnly: string | null) => {
    try {
      const { config } = productConfig;
      const genId = crypto.randomUUID();
      const imageData = frontMockup || backMockup;

      // Upload mockup image
      let mockupPath: string | null = null;
      if (imageData) {
        const blob = await fetch(imageData).then(r => r.blob());
        const path = `generations/${genId}-mockup.png`;
        const { error: upErr } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
        if (!upErr) mockupPath = path;
      }

      // Upload design-only (transparent) image — this is the print file
      let transparentPath: string | null = null;
      if (designOnly) {
        const blob = await fetch(designOnly).then(r => r.blob());
        const path = `generations/${genId}-transparent.png`;
        const { error: upErr } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
        if (!upErr) transparentPath = path;
      }

      const record = {
        user_id: user?.id ?? null,
        session_id: !user ? getGuestSessionId() : null,
        is_guest: !user,
        product: config.product,
        color: config.color,
        style: "simple",
        prompt: null,
        mockup_image_path: mockupPath,
        transparent_image_path: transparentPath,
      };
      await supabase.from("generations" as any).insert(record);
    } catch (e) {
      console.error("[Simple] Failed to save generation:", e);
    }
  }, [user, productConfig]);

  // Memoized mockup data URLs for order
  const [frontMockup, setFrontMockup] = useState<string | null>(null);
  const [backMockup, setBackMockup] = useState<string | null>(null);
  const [frontDesignOnly, setFrontDesignOnly] = useState<string | null>(null);
  const [backDesignOnly, setBackDesignOnly] = useState<string | null>(null);

  // Generate mockups when design changes — debounced so dragging stays
  // smooth. Each composite call rebuilds 800-3000 px canvases and emits
  // toDataURL strings, which is heavy enough to stutter every drag tick.
  // The live preview (DraggablePlacement layers) updates in real time
  // anyway, so the heavyweight composite only needs to run once the user
  // stops moving.
  useEffect(() => {
    const hasFrontDesign = frontData.photos.length > 0 || sideHasText(frontData);
    const hasBackDesign = backData.photos.length > 0 || sideHasText(backData);

    if (!hasFrontDesign) {
      setFrontMockup(null);
      setFrontDesignOnly(null);
    }
    if (!hasBackDesign) {
      setBackMockup(null);
      setBackDesignOnly(null);
    }

    if (!hasFrontDesign && !hasBackDesign) return;

    const timer = setTimeout(() => {
      if (hasFrontDesign) {
        compositeSide(frontData, "front").then(setFrontMockup);
        compositeDesignOnly(frontData, "front").then(setFrontDesignOnly);
      }
      if (hasBackDesign) {
        compositeSide(backData, "back").then(setBackMockup);
        compositeDesignOnly(backData, "back").then(setBackDesignOnly);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [frontData, backData, productConfig.config.product, productConfig.config.subProduct, productConfig.config.color]);

  // ── Virtual try-on (generalized) ────────────────────────────────────────
  // The design to try on: the placed design-only composite (photos + text —
  // covers uploads, transferred AI designs and text layers; front first,
  // try-on renders the garment's front), falling back to a generated-but-not-
  // yet-transferred AI result. null = nothing to try on → button hidden,
  // modal unmounted. handleAiTryOn stays untouched for the chat's
  // generated-message button; this path serves the persistent button below
  // the product preview.
  const tryOnDesignImage = frontDesignOnly ?? backDesignOnly ?? aiResult?.transferImage ?? null;

  const handleTryOnOpen = useCallback(() => {
    if (!tryOnDesignImage) return;
    setShowTryOn(true);
  }, [tryOnDesignImage]);

  // Order from a try-on: with an aiResult delegate to the untouched
  // handleAiOrder (which also places the generated design if needed);
  // otherwise the design is already on the product, so run the same size
  // gate as the main order button and open the dialog.
  const handleTryOnOrder = useCallback(() => {
    if (aiResult) {
      handleAiOrder();
      return;
    }
    setShowTryOn(false);
    const needsSize = (BRAND_SIZES[productConfig.config.subProduct]?.length > 0) || productConfig.config.product === "Phone Case";
    if (needsSize && !productConfig.config.size) {
      setSizeError(true);
      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSizeError(false);
    setOrderDialogOpen(true);
  }, [aiResult, handleAiOrder, productConfig.config.subProduct, productConfig.config.product, productConfig.config.size]);

  // Rendered in two slots — desktop main column below ProductPreview, and an
  // lg:hidden slot below the mobile inline preview — so it sits "under the
  // shirt" on both breakpoints. Stateless element, so sharing it is safe.
  const tryOnButton = tryOnDesignImage ? (
    <Button variant="outline" className="w-full gap-1.5" onClick={handleTryOnOpen}>
      <Shirt className="h-4 w-4" />
      {t(lang, "simpleAi.tryOn")}
    </Button>
  ) : null;

  // The AI design panel is rendered in two responsive slots: under the mobile
  // inline preview (lg:hidden) and in the desktop main column below the
  // product preview (hidden lg:flex). It's fully controlled, so a single
  // shared element rendered in both slots stays in sync — only one is visible
  // per breakpoint. Mirrors StudioPage's mobile-preview-in-sidebar pattern.
  const aiPanel = (
    <SimpleAiChatPanel
      lang={lang}
      messages={chatMessages}
      input={aiPrompt}
      onInputChange={setAiPrompt}
      onSubmit={handleChatSubmit}
      canSubmit={aiPrompt.trim().length > 0 && !chatBusy}
      busy={chatBusy}
      generating={aiGenerating}
      status={aiStatus}
      activePhoto={activeChatPhoto ? { id: activeChatPhoto.id, image: activeChatPhoto.image } : null}
      hasPhotos={hasPhotos}
      canUpload={canAddMore}
      onUploadClick={() => fileInputRef.current?.click()}
      restylePresets={RESTYLE_PRESETS}
      onPresetChip={handleChatPresetChip}
      onRemoveBg={handleChatRemoveBg}
      optionsOpen={chatOptionsOpen}
      onToggleOptions={setChatOptionsOpen}
      styleOptions={aiStyleOptions}
      selectedStyle={aiStyle}
      onSelectStyle={setAiStyle}
      withBackground={aiWithBackground}
      onToggleBackground={setAiWithBackground}
      hasResult={!!aiResult}
      transferLabel={aiTransferLabel}
      onTransfer={handleAiTransfer}
      onRegenerate={handleChatRegenerate}
      onShare={handleAiShare}
      onTryOn={handleAiTryOn}
      blocked={aiBlocked}
    />
  );

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title="ფოტო და ტექსტი მაისურზე — Maika.ge"
        description="ატვირთე ფოტო და დაბეჭდე უნიკალური დიზაინი მაისურზე, oversize ჰუდიზე, ჩანთაზე ან ქეისზე. რეცხვაგამძლე ეკოლოგიური საღებავი, შეკვეთიდან იმავე ან მეორე დღეს."
      />
      <AppHeader />
      <ContactBar />
      <LoginModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message={loginModalMessage}
      />
      {tryOnDesignImage && (
        <TryOnModal
          open={showTryOn}
          onClose={() => setShowTryOn(false)}
          designImage={tryOnDesignImage}
          onOrder={handleTryOnOrder}
        />
      )}
      {/* Sidebar + Main wrapper */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:overflow-hidden">

        <div className="overflow-y-auto flex-1 p-4 space-y-6">
          {/* Product config */}
          <ProductConfigPanel
            config={productConfig.config}
            locked={false}
            onProductChange={(p) => { productConfig.setProduct(p); setSizeError(false); }}
            onSubProductChange={(s) => { productConfig.setSubProduct(s); setSizeError(false); }}
            onColorChange={productConfig.setColor}
            onViewChange={productConfig.setView}
            selectedSize={productConfig.config.size}
            onSizeChange={(s) => { productConfig.setSize(s); setSizeError(false); }}
            sizeError={sizeError}
          />

          {/* Mobile-only inline preview — below view buttons, same as Studio mode */}
          <div className="lg:hidden rounded-xl overflow-hidden border border-border bg-background">
            <ProductPreview
              productName={productConfig.config.product}
              subProduct={productConfig.config.subProduct}
              colorName={productConfig.config.color}
              view={productConfig.config.view}
              placementCoords={hasPhotos || sideHasText(sideData) ? productConfig.config.placementCoords : nextPhotoCoords}
              onCoordsChange={hasPhotos || sideHasText(sideData) ? productConfig.setPlacementCoords : setNextPhotoCoords}
              layers={layers.length > 0 ? layers : undefined}
              onBackgroundClick={() => setSelectedLayerId(null)}
              // Loupe zoom source = the debounce-composited mockup for the
              // current view (READ-only). undefined when no design → no button.
              loupeSrc={(hasPhotos || sideHasText(sideData)) ? (isFront ? frontMockup : backMockup) : undefined}
            />
          </div>

          {/* Try-on — mobile slot, directly below the inline preview */}
          {tryOnButton && <div className="lg:hidden">{tryOnButton}</div>}

          {/* Side indicator */}
          <div className="text-xs text-muted-foreground text-center">
            {lang === "en"
              ? `Editing: ${isFront ? "Front" : "Back"} side`
              : `რედაქტირება: ${isFront ? "წინა" : "უკანა"} მხარე`}
          </div>

          {/* AI chat panel — the SINGLE slot for both breakpoints (the desktop
              main column holds only the product preview). The chat contains
              the only visible upload zone; the hidden input below is the real
              upload mechanism it clicks, and it must stay mounted even with
              zero photos (the chat's empty-state upload depends on it). */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          {aiPanel}

          {/* Photos — selection strip only (the upload moved into the chat):
              thumbnails pick the chat's active photo / preview layer and
              delete layers. Hidden entirely when there are no photos. */}
          {hasPhotos && (
          <div className="border-t border-sidebar-border pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" />
              {lang === "en" ? "Photos" : "ფოტოები"}
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {sideData.photos.length}/{MAX_PHOTOS}
              </span>
            </h3>

            {/* Photo thumbnails */}
            {hasPhotos && (
              <div className="flex flex-wrap gap-2">
                {sideData.photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    onClick={() => setSelectedLayerId(photo.id)}
                    className="relative group cursor-pointer"
                  >
                    <div className={`absolute -top-1 -left-1 h-4 w-4 rounded-full ${LAYER_COLORS[index % LAYER_COLORS.length]} flex items-center justify-center z-10`}>
                      <span className="text-[9px] text-white font-bold">{index + 1}</span>
                    </div>
                    <img
                      src={photo.image}
                      alt={`photo ${index + 1}`}
                      width={64}
                      height={64}
                      className={`h-16 w-16 rounded-lg object-cover border transition-colors ${
                        selectedLayerId === photo.id ? "border-primary ring-2 ring-primary/40" : "border-border"
                      }`}
                      loading="lazy"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removePhoto(photo.id); }}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground h-5 w-5 flex items-center justify-center hover:scale-110 transition-transform"
                      aria-label="წაშლა"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Handle-semantics hint. Was previously a floating tooltip
                in DraggablePlacement that overlapped the photo's top
                edge inside the print zone area (bug 2). Lifting it into
                the sidebar keeps the preview clean while still giving
                customers an inline reminder of what each handle does.
                Conditional on hasPhotos so the line only appears when
                it's relevant. */}
            {hasPhotos && (
              <p className="text-[10px] leading-snug text-muted-foreground">
                {lang === "en"
                  ? "Corners: resize • Edges: crop • Center: move (Alt: pan)"
                  : "კუთხეები: ზომა • კიდეები: ჭრა • ცენტრი: გადატანა (Alt: წანაცვლება)"}
              </p>
            )}

          </div>
          )}

          {/* Text — multiple independent text elements, each placeable separately */}
          <div className="border-t border-sidebar-border pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Type className="h-3.5 w-3.5" />
              {lang === "en" ? "Text" : "ტექსტი"}
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {sideData.texts.length}/{MAX_TEXTS}
              </span>
            </h3>

            {sideData.texts.map((tl, index) => (
              <div
                key={tl.id}
                onClick={() => setSelectedLayerId(tl.id)}
                className={`space-y-2 rounded-lg border p-2.5 transition-colors ${
                  selectedLayerId === tl.id ? "border-primary/60 bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {lang === "en" ? "Text" : "ტექსტი"} #{index + 1}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeText(tl.id); }}
                    aria-label={lang === "en" ? "Remove" : "წაშლა"}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <Textarea
                  value={tl.content}
                  onChange={(e) => updateText(tl.id, { content: e.target.value })}
                  placeholder={lang === "en" ? "Enter your text..." : "შეიყვანეთ ტექსტი..."}
                  className="bg-card resize-none"
                  rows={2}
                />

                {/* Font picker (per text) */}
                <div className="relative">
                  <button
                    onClick={() => setOpenFontPickerId(openFontPickerId === tl.id ? null : tl.id)}
                    className="w-full flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/50 transition-colors"
                  >
                    <span style={{ fontFamily: tl.font.family }}>{tl.font.name}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${openFontPickerId === tl.id ? "rotate-180" : ""}`} />
                  </button>
                  {openFontPickerId === tl.id && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-64 overflow-y-auto">
                      {FONT_GROUPS.map((group) => (
                        <div key={group.label}>
                          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/50 sticky top-0">
                            {group.label}
                          </div>
                          {group.fonts.map((font) => (
                            <button
                              key={font.name}
                              onClick={() => { updateText(tl.id, { font }); setOpenFontPickerId(null); }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                                tl.font.name === font.name ? "bg-accent text-accent-foreground" : "text-popover-foreground"
                              }`}
                            >
                              <span style={{ fontFamily: font.family, fontSize: "14px" }}>{font.name}</span>
                              <span style={{ fontFamily: font.family }} className="text-muted-foreground text-xs">
                                AaBb აბ
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Text color picker (per text) */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Palette className="h-3 w-3" />
                    {lang === "en" ? "Text Color" : "ტექსტის ფერი"}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {TEXT_COLORS.map((color) => (
                      <button
                        key={color.hex}
                        onClick={() => updateText(tl.id, { color: color.hex })}
                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                          tl.color === color.hex ? "border-primary scale-110 ring-2 ring-primary/30" : "border-border"
                        }`}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={addTextLayer}
              disabled={sideData.texts.length >= MAX_TEXTS}
            >
              <Plus className="h-3.5 w-3.5" />
              {lang === "en" ? "Add text" : "ტექსტის დამატება"}
            </Button>
          </div>

          {(hasPhotos || sideHasText(sideData)) && (
            <Button variant="outline" size="sm" onClick={clearDesign}>
              {lang === "en" ? "Clear all" : "გასუფთავება"}
            </Button>
          )}

          {/* Price Display & Order */}
          {(() => {
            const hasFront = frontData.photos.length > 0 || sideHasText(frontData);
            const hasBack = backData.photos.length > 0 || sideHasText(backData);
            const breakdown = calculatePrice(
              productConfig.config.product,
              productConfig.config.subProduct,
              hasFront,
              hasBack,
              false,
            );
            return (
              <>
                <PriceDisplay breakdown={breakdown} />
                {(() => {
                  const needsSize = (BRAND_SIZES[productConfig.config.subProduct]?.length > 0) || productConfig.config.product === "Phone Case";
                  // Both buttons must use fresh composite output. The useEffect
                  // that populates frontMockup/backDesignOnly is debounced
                  // 250ms, so a quick click can race past stale state and ship
                  // a missing back print file. Re-compute synchronously here.
                  const computeFresh = async () => {
                    const hasFront = frontData.photos.length > 0 || sideHasText(frontData);
                    const hasBack = backData.photos.length > 0 || sideHasText(backData);
                    const [fm, bm, fdo, bdo] = await Promise.all([
                      hasFront ? compositeSide(frontData, "front") : Promise.resolve(null),
                      hasBack ? compositeSide(backData, "back") : Promise.resolve(null),
                      hasFront ? compositeDesignOnly(frontData, "front") : Promise.resolve(null),
                      hasBack ? compositeDesignOnly(backData, "back") : Promise.resolve(null),
                    ]);
                    setFrontMockup(fm);
                    setBackMockup(bm);
                    setFrontDesignOnly(fdo);
                    setBackDesignOnly(bdo);
                    return { fm, bm, fdo, bdo };
                  };

                  const handleOrderClick = async () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    const { fm, bm, fdo, bdo } = await computeFresh();
                    if (fm || bm) saveToGenerations(fm, bm, fdo || bdo);
                    setOrderDialogOpen(true);
                  };
                  const handleAddToCart = async () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    const { fm, bm, fdo, bdo } = await computeFresh();
                    if (!fm && !bm) {
                      toast({ title: "ჯერ შექმენი დიზაინი", variant: "destructive" });
                      return;
                    }
                    try {
                      await addToCart({
                        product: productConfig.config.product,
                        subProduct: productConfig.config.subProduct,
                        color: productConfig.config.color,
                        size: productConfig.config.size || null,
                        isStudio: false,
                        frontMockupDataUrl: fm,
                        backMockupDataUrl: bm,
                        transparentImageDataUrl: fdo,
                        backTransparentImageDataUrl: bdo,
                        frontOriginalPhotos: frontData.photos.map(p => p.image),
                        backOriginalPhotos: backData.photos.map(p => p.image),
                        prompt: buildTextPrompt(frontData, backData),
                        productPrice: breakdown.total,
                        quantity,
                        designState: buildDesignStateInput(
                          frontData,
                          backData,
                          productConfig.config.product,
                          productConfig.config.subProduct,
                          productConfig.config.color,
                        ),
                      });
                      toast({ title: "კალათაში დაემატა ✓" });
                      setQuantity(1);
                    } catch (e: any) {
                      toast({ title: "შეცდომა", description: e.message, variant: "destructive" });
                    }
                  };
                  return (
                    <>
                      <Button
                        className="w-full h-12 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base"
                        onClick={handleOrderClick}
                      >
                        <ShoppingBag className="h-5 w-5" />
                        შეკვეთა
                      </Button>
                      <div>
                        <h3 className="text-sm font-semibold mb-2">რაოდენობა</h3>
                        <QuantityStepper value={quantity} onChange={setQuantity} />
                      </div>
                      <Button
                        variant="outline"
                        className="w-full h-11 gap-2 font-semibold text-sm"
                        onClick={handleAddToCart}
                        disabled={addingToCart}
                      >
                        <ShoppingBag className="h-4 w-4" />
                        {addingToCart ? "ემატება..." : "კალათაში დამატება"}
                      </Button>
                      <Suspense fallback={null}>
                        <OrderDialog
                          breakdown={breakdown}
                          product={productConfig.config.product}
                          subProduct={productConfig.config.subProduct}
                          color={productConfig.config.color}
                          isStudio={false}
                          externalOpen={orderDialogOpen}
                          onExternalOpenChange={setOrderDialogOpen}
                          frontMockupDataUrl={frontMockup}
                          backMockupDataUrl={backMockup}
                          transparentImageDataUrl={frontDesignOnly}
                          backTransparentImageDataUrl={backDesignOnly}
                          frontOriginalPhotos={frontData.photos.map(p => p.image)}
                          backOriginalPhotos={backData.photos.map(p => p.image)}
                          size={productConfig.config.size}
                          prompt={buildTextPrompt(frontData, backData)}
                          designState={buildDesignStateInput(
                            frontData,
                            backData,
                            productConfig.config.product,
                            productConfig.config.subProduct,
                            productConfig.config.color,
                          )}
                          quantity={quantity}
                        >
                          <span className="hidden" />
                        </OrderDialog>
                      </Suspense>
                    </>
                  );
                })()}
              </>
            );
          })()}

        </div>

        {/* Footer: theme switcher */}
        <div className="shrink-0 border-t border-sidebar-border p-3 flex items-center justify-end gap-2">
          <div className="flex items-center gap-1.5 px-2">
            <button
              onClick={() => theme !== "dark" && toggleTheme()}
              className={`h-5 w-5 rounded-full bg-black border transition-all ${theme === "dark" ? "border-white/50 ring-2 ring-white/30 scale-110" : "border-white/20 opacity-50 hover:opacity-80"}`}
              title="Dark"
            />
            <button
              onClick={() => theme !== "green" && toggleTheme()}
              className={`h-5 w-5 rounded-full bg-[#25B988] transition-all ${theme === "green" ? "ring-2 ring-[#25B988]/60 scale-110" : "opacity-50 hover:opacity-80"}`}
              title="Green"
            />
          </div>
        </div>
      </aside>

      {/* Main column — desktop only; mobile/tablet use the inline preview in
          the sidebar. Holds ONLY the product preview — the AI chat panel
          lives in the sidebar on both breakpoints. The preview is an
          AUTO-HEIGHT, width-capped, centered block (NOT flex-1): its card is
          aspect-square, so its height comes from its width — a flex-1 box
          shorter than the square clipped it at the top. */}
      <main className="hidden lg:flex flex-1 bg-background overflow-y-auto flex-col">
        <div className="shrink-0 flex justify-center pt-2">
          <div className="w-full max-w-lg">
            <ProductPreview
              productName={productConfig.config.product}
              subProduct={productConfig.config.subProduct}
              colorName={productConfig.config.color}
              view={productConfig.config.view}
              placementCoords={productConfig.config.placementCoords}
              onCoordsChange={productConfig.setPlacementCoords}
              layers={layers.length > 0 ? layers : undefined}
              onBackgroundClick={() => setSelectedLayerId(null)}
              // Loupe zoom source = the debounce-composited mockup for the
              // current view (READ-only). undefined when no design → no button.
              loupeSrc={(hasPhotos || sideHasText(sideData)) ? (isFront ? frontMockup : backMockup) : undefined}
            />
          </div>
        </div>
        {/* Try-on — desktop slot, directly below the product preview */}
        {tryOnButton && (
          <div className="shrink-0 border-t border-border p-3">
            <div className="max-w-lg mx-auto w-full">{tryOnButton}</div>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
