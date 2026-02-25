

# maika.ge Studio — Implementation Plan

## Phase 1: Foundation & Auth
Set up the core app shell with the banana-themed design system, dark/light mode support, and authentication.

**What we'll build:**
- Custom banana color palette and zinc-based gray theme integrated into Tailwind
- Dark mode (default) and light mode with theme toggle
- Login screen with Google OAuth and Guest (anonymous) sign-in
- Basic user profiles table (display name, avatar) with auto-creation on signup
- App layout: sidebar (450px on desktop) + main content area, responsive stacking on mobile
- Header/navbar with logo, user info, language toggle, theme toggle, and logout

## Phase 2: Product Configuration
Build the product selector with all its options, using placeholder images until real product photos are provided.

**What we'll build:**
- Product type grid (9 products: Hoodie, T-Shirt, Long Sleeve, etc.) with icons and descriptions
- Sub-product pill selector (e.g., Washed Hoodie, Oversized T-Shirt)
- Color swatch grid (20 colors, 4-column layout) with availability filtering
- Front/Back view toggle
- Product catalog service with O(1) lookups — catalog data stored as JSON, product images as placeholders for now
- Product photo display in main area with placement zone overlay (green dashed box)
- Controls locking behavior when a result exists

## Phase 3: Design Studio & Input Controls
Build the creative input interface where users describe their design.

**What we'll build:**
- Workflow guide box (4-step visual guide)
- Character section (always visible): multi-image upload, text description, paste support (⌘+V), preset thumbnails (Robot, Cat, Skull)
- Scene section (collapsible): single image + text, presets (Neon City, Nebula, Forest)
- Style section (collapsible): single image + text, presets (Synthwave, Japanese Ink, Pop Art)
- Typography section (collapsible): single image + text input
- Speed selector toggle (Fast vs Pro)
- Image thumbnail grid with view/delete on hover
- Lightbox for full-size image viewing

## Phase 4: AI Generation Pipeline
Wire up the core generation flow using Lovable AI gateway for Gemini model access.

**What we'll build:**
- Edge function proxy for Gemini API calls (using Lovable AI gateway with `gemini-2.5-flash-image` for Fast and `gemini-3-pro-image-preview` for Pro)
- Stage 1 — Design generation: structured prompt assembly from design params, multipart image+text request
- Stage 2 — Background removal: white-to-black conversion via Gemini, then client-side difference matting algorithm on canvas
- Stage 3 — Mockup compositing: client-side canvas layering of transparent design onto product photo at placement coordinates
- 3-step loading states with animated loader, status titles, and log lines
- Mobile full-screen overlay with blur backdrop during generation
- Generate button with proper disabled/loading states

## Phase 5: Results, Placement & Downloads
Display results and allow users to customize design placement on products.

**What we'll build:**
- Mockup card with blurred background effect, hover overlay with View and Download buttons
- Print file card with checkered transparency pattern, Download PNG button
- Interactive placement zone: drag to reposition, corner handle to resize, coordinate readout, reset button
- Touch-friendly drag/resize with 60fps performance (useRef-based, no React re-renders during drag)
- Customize/Apply/Cancel flow with controls unlocking
- Download functionality for both mockup and print file PNGs

## Phase 6: Storage, Gallery & Publishing
Persist designs and enable browsing/sharing.

**What we'll build:**
- Supabase Storage bucket (`designs`) with organized path structure
- Image processing pipeline: thumbnail (200×200), display (1200px), and full-size versions
- Auto-save designs after generation with all metadata
- Database tables: `designs` (private, RLS per user) and `public_designs` (public read, owner write)
- Private gallery tab ("My Designs") — horizontal scrollable strip of thumbnails
- Community gallery tab — public designs with username labels
- Click thumbnail to restore full design state
- Delete with confirmation (private only)
- Publish/Unpublish toggle on result cards
- Realtime subscriptions for both galleries

## Phase 7: Advanced Features & Polish
Layer on remaining features for a complete experience.

**What we'll build:**
- Upscale 4K flow: Gemini upscale + re-apply transparency
- Magic Randomizer: AI-generated cohesive prompts with Georgian and international "vibes", parallel reference image generation
- Random asset generation per section (dice button)
- Bilingual i18n (English + Georgian) with all translation keys
- Analytics events tracking (login, generate, download, publish, etc.)
- Toast notification system (error in red, info in yellow, auto-dismiss)
- Progressive image loading (thumbnail → display → full)
- Performance optimizations: `startTransition()`, image pre-decoding, in-memory caching

