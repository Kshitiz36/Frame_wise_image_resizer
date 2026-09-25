# Architecture

Framewise is split into two files by convention, not necessity:
`index.html` (markup + styles) and `app.js` (all logic). Everything is
static — there's no build step, bundler, or transpilation.

## 1. Layout

```
┌─────────────────────────────────────────────────┐
│ header                                            │
├───────────────────────────────────────────────────┤
│ working-image card (shared upload, all tools use  │
│ this one image)                                    │
├───────────┬───────────────────────────┬────────────┤
│  tabs     │  active tool panel         │  preview  │
│ (sidebar) │  (Resize / Batch / etc.)   │  (sticky) │
└───────────┴───────────────────────────┴────────────┘
```

The **working image** is a single piece of global state (`workingImage` in
`app.js`) shared by all four tools. This is the key architectural decision
that makes "many features, one place" work: upload once, and every tab
reads from the same `Image` object rather than re-uploading per tool.

```js
workingImage = { img, file, name, type, w, h, aspect }
```

## 2. Rendering pipeline

All resizing/enhancement funnels through one function:

```
renderComposite(img, targetW, targetH, fit, bgColor, enhance, upscale)
  → creates a canvas at targetW*upscale × targetH*upscale
  → fills it with bgColor (visible in "contain" mode, or as JPEG backdrop)
  → computes a crop/pad rectangle via getFitRect(...)
  → applies a CSS filter string for brightness/contrast/saturation while
    drawing the source image onto the canvas
  → runs applySharpen() as a post-process convolution if sharpen > 0
  → returns the canvas
```

Both the **Resize & Enhance** tab and the **Batch Export** tab call this
same function — batch export just loops it once per selected preset size,
reusing whatever enhance settings are currently set in the Resize tab.

### Fit modes (`getFitRect`)

- **cover** — scales the source so it fully fills the target box, cropping
  the overflow. Defaults to a centered crop, but accepts an optional
  `manualCropRect` (source-pixel `{sx,sy,sw,sh}`) which the interactive
  crop selector supplies — when present, that exact region is used instead
  of the centered default.
- **contain** — scales the source to fit entirely inside the target box,
  letterboxing the remainder with `bgColor`.
- **stretch** — maps the full source directly onto the full target box,
  ignoring aspect ratio (can distort the image).

### Interactive crop selector

Only shown (and only meaningful) in Cover fit mode, since Contain and
Stretch don't crop. State lives in the `cropStage` object:

```js
cropStage = { dispW, dispH, scale, frameLeft, frameTop, frameW, frameH }
```

- `dispW/dispH` — the size the *full source image* is displayed at inside
  the crop stage (`computeDispSize`, capped to a max of 380px on the
  longer side, with a 2× upscale ceiling so tiny source images are still
  usable). Because this is a uniform scale-to-fit with no cropping, a
  point in display space maps to source space by simple division by
  `scale` — no separate coordinate system needed.
- `frameLeft/frameTop/frameW/frameH` — the crop frame's position and size,
  in that same display-pixel space. `frameW/frameH` are always locked to
  the current target aspect ratio (`resetCropFrame`, `onCropZoomChange`).
- **Drag** (`onCropPointerDown/Move/Up`) updates `frameLeft/frameTop` from
  pointer movement deltas, clamped so the frame never leaves the image
  bounds (`clampFramePosition`). Works with both mouse and touch events.
- **Zoom slider** (`onCropZoomChange`) recomputes `frameW/frameH` from the
  slider value while keeping the frame's center point fixed, then
  re-clamps — so zooming in feels like it's zooming toward wherever the
  frame currently is, not snapping back to center.
- `getManualCropRect()` converts the current frame back into source-image
  pixel coordinates (`{sx,sy,sw,sh} = frame / scale`) for `renderComposite`
  to consume.
- The frame is repositioned to a fresh centered default (`resetCropFrame`)
  whenever the target aspect ratio changes — via a preset click, a custom
  width/height edit, or switching fit mode to Cover — since a crop
  position from one aspect ratio isn't meaningful for another.
- Visually, the dimmed "everything outside the frame gets cut" effect is a
  single CSS trick: `box-shadow: 0 0 0 2000px rgba(0,0,0,0.62)` on the
  frame element, clipped by `overflow:hidden` on the stage — no separate
  mask element needed. A faint rule-of-thirds grid is drawn on the frame
  itself via two layered `linear-gradient` backgrounds.

### Enhance

- Brightness/contrast/saturation are applied via the canvas 2D context's
  `filter` property (`brightness() contrast() saturate()`) at draw time —
  cheap, GPU-accelerated by the browser, no manual pixel math needed.
- Sharpening is a manual 3×3 unsharp-mask convolution
  (`applySharpen`) run against `ImageData` after the draw, blended against
  the original by the `amount` slider value. It's skipped above
  3000×3000px (`w*h > 3000*3000`) to avoid blocking the main thread for
  multiple seconds on large upscaled exports.
- Upscale is just a multiplier on the target width/height passed into
  `renderComposite` — the canvas draws the source at high `imageSmoothingQuality`,
  which is a smoothed enlargement, not a learned/AI super-resolution model.

## 3. Per-tool logic

### Resize & Enhance (`renderResizePreview`)
Reads current target dimensions, fit mode, background color, enhance
settings, and upscale factor from the DOM, calls `renderComposite`, stores
the result in `lastResizeCanvas`, and draws it into the shared preview
canvas. All controls are wired to a debounced re-render
(`scheduleResizeRender`, 220ms) so the preview stays live without
re-computing on every keystroke/slider tick.

### Batch Export (`generateBatchZip`)
1. Reads all checked preset checkboxes.
2. For each, calls `renderComposite` with that preset's width/height (but
   the *same* fit/enhance/upscale settings as the Resize tab) and awaits
   `canvas.toBlob`.
3. Adds each blob to a `JSZip` instance under a slugified filename
   (`category_name_widthxheight.ext`).
4. Updates a progress bar between each image (this loop is `async`/`await`
   so the UI thread stays responsive and repaints between iterations).
5. Once all images are added, calls `zip.generateAsync({type:'blob'})` and
   triggers a single ZIP download.

### Compress (`runCompress`, `compressToTarget`)
Renders the image once at its original size (no resize/enhance — this tab
is deliberately independent so you can compress without also changing
dimensions). For JPEG/WebP, `compressToTarget` runs an 8-iteration binary
search over the quality parameter (0.02–1.0), keeping the highest quality
whose resulting blob size is still ≤ the target byte count. PNG is handled
as a special case with an explicit message, since PNG encoding is lossless
and has no quality parameter to search over.

### Convert Format (`runConvert`)
Draws the original image at its native resolution onto a plain canvas — if
converting to JPEG, the canvas is first filled with the chosen background
color so transparent PNG regions flatten predictably instead of turning
black. Exports via `canvas.toBlob` at the chosen format/quality.

## 4. Design tokens

CSS custom properties at the top of the `<style>` block in `index.html`
(`--ink`, `--panel`, `--mint`, `--mono`, `--display`, etc.) drive the
entire visual system and match the sibling Scanpost project's palette,
so the two tools feel like part of the same product family.

## 5. Extending the project

- **Real AI upscaling / denoising**: would require either a WASM ML model
  bundled client-side (e.g. a distilled super-resolution net) or a backend
  inference endpoint — out of scope for a static, zero-backend tool.
- **Manual crop repositioning**: currently "cover" mode always centers the
  crop. A draggable crop-offset UI on the preview canvas would let users
  reposition before exporting.
- **Multi-file batch conversion**: Convert Format currently operates on the
  single shared working image; a variant accepting many files at once
  (looping the same `runConvert` logic and zipping the results, mirroring
  Batch Export) would extend it to true bulk conversion.
- **HEIC input support**: iPhone photos in HEIC format aren't decodable by
  `<canvas>` directly in most browsers; a library like `heic2any` could be
  added to convert HEIC → JPEG on load before entering the existing
  pipeline.
