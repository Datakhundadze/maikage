// Flags on the site's GPT generation (add-only, 2026-11-01, owner GO).
//
// GPT's transparent mode treats a flag's WHITE field as background, so on a
// dark garment only the coloured parts showed (verified 31.10 with the
// Georgian flag). For a flag / coat of arms / emblem the site therefore asks
// GPT for an OPAQUE image on a solid magenta key colour and cuts the magenta
// out here — the same approach the DM bot uses (meta-webhook/sketchParse.ts
// buildFlagGenerateParams + sketchRaster.keyOutColor).

export const FLAG_PROMPT_RE = /დროშ|გერბ|ემბლემ|\bflags?\b|coat of arms|\bemblem/i;
export const KEY_COLOR_HEX = "#FF00FF";

/** Start of SimplePage's GUARD_NO_GARMENT — the customer's own text comes before it. */
const GUARD_START = "Output ONLY the standalone design artwork";

export const GUARD_FLAG_ON_KEY =
  "Draw ONLY the flag / coat of arms itself, flat and straight on, large, centred, with its exact colours " +
  "and proportions — its white parts are solid opaque white. Everything around it is a SOLID, uniform PURE " +
  "MAGENTA (#FF00FF) background: no gradient, no shadow, no texture, no border, no pole. Magenta is a cut-out " +
  "key colour: never use magenta or pink inside the flag.";

/** The customer's words, without the site's white-background guards. */
export function customerText(character: unknown): string {
  const c = typeof character === "string" ? character : "";
  const at = c.indexOf(GUARD_START);
  return (at >= 0 ? c.slice(0, at) : c).trim();
}

export function isFlagCharacter(character: unknown): boolean {
  return FLAG_PROMPT_RE.test(customerText(character));
}

/** generate-design-gpt params for a flag: opaque, on the magenta key. */
export function flagDesignParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    ...params,
    character: `${customerText(params.character)}. ${GUARD_FLAG_ON_KEY}`,
    style: "flat vector graphic",
    text: "",
    isRealistic: false,
    transparent: false,
  };
}

/**
 * Magenta → transparent with a soft edge (RGB distance inner..outer), the key's
 * tint pulled out of edge pixels. Pure, on RGBA bytes (tested without a canvas).
 */
export function keyOutRgba(d: Uint8ClampedArray, hex = KEY_COLOR_HEX, inner = 60, outer = 140): void {
  const h = hex.replace("#", "");
  const kr = parseInt(h.slice(0, 2), 16), kg = parseInt(h.slice(2, 4), 16), kb = parseInt(h.slice(4, 6), 16);
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb);
    if (dist <= inner) { d[i + 3] = 0; continue; }
    if (dist >= outer) continue;
    const a = (dist - inner) / (outer - inner);
    d[i + 3] = Math.round(d[i + 3] * a);
    d[i] = Math.max(0, Math.min(255, Math.round((d[i] - kr * (1 - a)) / a)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round((d[i + 1] - kg * (1 - a)) / a)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round((d[i + 2] - kb * (1 - a)) / a)));
  }
}

/** Browser: key the magenta out of a data URL → transparent PNG data URL. */
export async function keyOutMagenta(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  keyOutRgba(data.data);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
