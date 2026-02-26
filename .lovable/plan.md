
# Phase 5: Interactive Placement, Customize/Apply Flow, and Downloads

## What Gets Built

Phase 5 upgrades the studio from a one-shot generation into an interactive design tool where users can reposition and resize their design on the product, re-apply changes, and download high-quality results.

---

## Features

### 1. Draggable/Resizable Placement Zone
- Replace the static dashed-border overlay in `ProductPreview` with an interactive drag-and-resize component
- Users can click and drag to reposition the design zone on the product
- Corner handles allow resizing (maintaining aspect ratio)
- Live coordinate readout updates as the user moves the zone
- Placement changes update `useProductConfig` state via `setPlacementCoords`

### 2. Post-Generation "Customize and Apply" Flow
- After generation completes, the transparent design appears inside the placement zone on the product preview
- Users can drag/resize the design on the product before finalizing
- An "Apply" button re-composites the mockup at the new coordinates (client-side canvas, no AI call needed)
- A "Regenerate" button lets users tweak prompts and re-run the pipeline

### 3. Enhanced Result View and Downloads
- Show both the mockup and the print-ready PNG side by side (on wider screens)
- Add a "Download All" button that bundles mockup + transparent PNG
- Add filename customization: `{product}-{color}-{characterName}.png`
- Add a "Copy to Clipboard" button for the mockup image

### 4. Product Switching After Generation
- Unlock the product config panel after generation so users can switch products/colors
- Re-composite the transparent design onto the new product automatically (no re-generation needed)
- The placement zone adapts to the new product's default coordinates

---

## Technical Details

### New Component: `DraggablePlacement.tsx`
- A wrapper component using pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`) for drag behavior
- Calculates normalized coordinates (0-1 range) relative to the parent container
- Four corner resize handles that scale proportionally
- Props: `coords`, `onCoordsChange`, `children` (optional design image overlay), `disabled`

### Changes to `ProductPreview.tsx`
- Import and use `DraggablePlacement` instead of the static div
- Accept optional `designImage` prop to show the transparent design inside the zone
- Wire `onCoordsChange` to `productConfig.setPlacementCoords`

### Changes to `StudioPage.tsx`
- After generation, pass `result.transparentImage` to `ProductPreview`
- Add "Apply" button that calls `compositeMockup` from `generation.ts` with current coords
- Unlock product config after generation so users can switch products
- On product/color change post-generation, auto-recomposite

### Changes to `ResultView.tsx`
- Add "Copy to Clipboard" using `navigator.clipboard.write` with blob
- Improve download filenames to include product and color info
- Add "Download All" that triggers both downloads sequentially

### Changes to `DesignStudioPanel.tsx`
- After generation, replace "Generate Merchandise" with "Regenerate" and "Apply Changes" buttons
- "Apply Changes" re-composites without calling AI
- "Start New" resets everything as before

### Extraction from `generation.ts`
- Export the `compositeMockup` and `loadImage` functions so they can be called independently for re-compositing
