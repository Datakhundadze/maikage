# maika.ge — Claude Code Session Context

## პროექტი
- **Repo:** `/home/user/maikage` (git)
- **საიტი:** `maika.ge` — Georgian custom merch platform (t-shirts, hoodies, etc.)
- **Stack:** React + TypeScript + Vite + Tailwind + Supabase (Edge Functions)
- **Hosting:** Lovable.dev (auto-deploys from GitHub on PR merge)
- **Branch:** `claude/review-georgian-content-JJ2Ge` ← ყველა ცვლილება ამ branch-ში

## Git workflow
```bash
git add <files>
git commit -m "message\n\nhttps://claude.ai/code/session_01HhaqQ8En6fdVXK1pkBCVfs"
git push -u origin claude/review-georgian-content-JJ2Ge
```
- Lovable-ში PR merge → ის auto-deploy აკეთებს
- Edge functions-ის შეცვლის შემდეგ Lovable-ს უნდა სთხოვო "Redeploy all edge functions"

---

## ძირითადი ფაილები

| ფაილი | მიზანი |
|---|---|
| `supabase/functions/gemini-proxy/index.ts` | AI gateway (Lovable AI → Google Gemini) |
| `src/pages/TryOnPage.tsx` | Virtual try-on page — flood fill colorization |
| `src/components/ResultView.tsx` | Generation result view + try-on navigate |
| `src/pages/SimplePage.tsx` | Simple mode page |
| `src/pages/StudioPage.tsx` | AI Studio page |
| `src/pages/LandingPage.tsx` | Homepage (3 cards + B2B section) |
| `src/hooks/useAppState.tsx` | Global state: lang, theme, mode |
| `src/hooks/useGenerationLimit.ts` | Generation limit (logged-in: unlimited) |
| `src/components/AppHeader.tsx` | Header: lang toggle, theme toggle, nav |
| `src/components/DesignStudioPanel.tsx` | Step flow (1→4) + generate button |
| `src/components/ProductConfigPanel.tsx` | Product/Brand/Color/Size/View selectors |
| `src/lib/i18n.ts` | EN/GE translations |
| `src/lib/catalog.ts` | Products, colors, sizes, image URLs |
| `src/index.css` | CSS vars: `.dark` (orange) + `.green` (green) themes |

---

## გაკეთებული ცვლილებები (ეს session)

### 1. Gemini Proxy (edge function)
- **Lovable AI gateway** იყენებს: `https://ai.gateway.lovable.dev/v1/chat/completions`
- `LOVABLE_API_KEY` env var
- Actions: `generate-design`, `virtual-tryon`, `convert-bg-black`, `upscale`, `randomize-prompt`
- Virtual try-on: 2 mode:
  - **normal**: transparent design + colorize client-side
  - **`useMockupStyle: true`** (Premium Hoodie etc.): mockup image → AI replicates texture

### 2. Virtual Try-On (`TryOnPage.tsx`)
- **Flood fill colorization** — starts from upper-chest center (~50%, 47%), spreads through connected white/gray pixels
- Torso bounds: y 25-85%, x 12-88%
- `isShirt` check: `brightness > 130 && saturation < 65 && !isSkinHue`
- `isSkinHue`: `pr > pg + 25 && pg > pb + 10`
- **Premium Hoodie** (`state.subType === "Premium Hoodie"`): uses `mockupImage` as design, skips colorization
- `subType` is passed through: StudioPage → ResultView → navigate state → TryOnPage

### 3. Generation Limit
- Logged-in users: **no limit** (`return { allowed: true }`)
- Guests: 1 generation limit

### 4. Login / OAuth
- `redirect_uri: window.location.href` (same-page redirect)
- `useAppState` mode: uses **sessionStorage** (not localStorage) → fresh visit = landing page

### 5. Theme System
- **Dark Orange** (`.dark`): bg `#0a0a0a`, accent `hsl(40,100%,50%)` orange
- **Light Green** (`.green`): bg `#ffffff`, accent `hsl(162,64%,44%)` = `#25B988`
- Toggle: cycles `dark ↔ green`, saves to `localStorage`
- AppHeader: color dot swatch (🟢 = currently dark, click→green; 🟠 = currently green, click→dark)

### 6. Landing Page
- **3 cards** (was 4): მარტივი რეჟიმი, AI სტუდიო, PHOTOSTUDIO — STICKERS წაშლილია
- B2B icons: `h-8 w-8` (32px)

### 7. Step Flow (DesignStudioPanel)
- Progress bar between steps
- Active step: orange + scale
- Completed step: ✓ checkmark
- `stepDone`: checks if character/scene/style have content

### 8. ProductConfigPanel
- Labels use i18n (`config.product`, `config.brand`, etc.)
- Size: **dropdown** `<select>` (was buttons), placeholder "აირჩიე ზომა"
- View: "წინა"/"უკანა" via i18n

### 9. Coordinate readout
- Removed "56%, 42%" debug text from `DraggablePlacement.tsx`

---

## i18n Keys (ახალი)
```
config.product / config.brand / config.color / config.view
config.size / config.front / config.back / config.chooseSize
nav.simple
studio.guide.paste → "Ctrl+V სურათის ჩასასმელად"
```

---

## ცნობილი პრობლემები / შენიშვნები

1. **Edge function redeploy**: Lovable-მ შეიძლება auto-deploy-ზე ძველი version გამოიყენოს. PR merge-ის შემდეგ სთხოვე "Redeploy all edge functions".

2. **Try-on flood fill**: თუ AI-ს result-ი ძალიან ბნელია ან shirt ცენტრში არ არის — seed-ი ვერ მოიძებნება და original (white) დაბრუნდება. `seedIdx === -1` ანუ fallback.

3. **Try-on colorization**: მუშაობს მხოლოდ white/near-white AI output-ზე. Dark colors (navy, black) — multiply blend მათზე კარგად არ მუშაობს (output ძალიან მუქია).

4. **Premium Hoodie**: `TEXTURED_PRODUCTS = ["Premium Hoodie"]` — სხვა textured products-ის დამატება `TryOnPage.tsx`-ში.

---

## Env Variables (Supabase)
- `LOVABLE_API_KEY` — Lovable AI gateway key
- Supabase project: `supabase/config.toml`-ში

---

## როგორ გააგრძელო ახალ ჩატში

1. გახსენი ახალი Claude Code chat
2. დაწერე: **"I'm continuing work on the maika.ge project. Read /home/user/maikage/CLAUDE_CONTEXT.md for full context, then help me with: [შენი კითხვა]"**
3. Claude წაიკითხავს ამ ფაილს და სრული კონტექსტი ექნება
