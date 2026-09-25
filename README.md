# Framewise — Resize, Enhance, Compress & Convert Studio

A single upload, four tools, all client-side: resize a photo to a trending
platform size (or your own dimensions), sharpen/brighten/upscale it, choose
your output format, hit a target file size, or just swap formats — no
account, no server, no upload leaving your browser.

Open `index.html` in any modern browser and it just works.

---

## Features

### 1. Resize & Enhance
- **Trending size presets** grouped by platform: WhatsApp DP, Telegram
  profile, Instagram (post/portrait/landscape/story/profile), Facebook
  (profile/cover/post), X/Twitter (profile/header/post), LinkedIn
  (profile/banner/post), YouTube (icon/thumbnail/banner), Snapchat,
  Pinterest, plus general sizes (passport photo, HD/4K wallpaper).
- **Custom width/height** with an aspect-ratio lock toggle.
- **Fit mode**: Cover (crop to fill, centered), Contain (pad with a
  background color), or Stretch.
- **Interactive crop selector** (Cover mode only): the full photo is shown
  with a movable frame — drag it anywhere to choose exactly what stays in
  frame, with everything outside dimmed out so you can see what's being
  cut before you export. A zoom slider tightens the frame for a more
  zoomed-in crop.
- **Enhance controls**: sharpen, brightness, contrast, saturation, and a
  smoothed 1×/2×/4× upscale — plus a one-click "Auto-enhance" preset.
- **Output format & quality**: JPEG, PNG, or WebP with an adjustable
  quality slider.
- Live preview canvas updates as you adjust any control.

### 2. Batch Export
Tick as many trending sizes as you want, reuse the same enhance settings
from the Resize tab, and export everything at once as a single ZIP —
useful for generating a full "social media kit" from one source photo.

### 3. Compress
Give it a target file size in KB; it binary-searches JPEG/WebP quality to
land just under that target and reports the quality level it landed on.
(PNG is called out as lossless — quality can't be reduced, so it can't hit
an arbitrary target size.)

### 4. Convert Format
Quick format swap with no resizing — JPEG, PNG, or WebP, with a background
color picker to flatten transparent PNGs sensibly when converting to JPEG.

## Honest limitations (read this before relying on it)

- **The movable crop frame applies to one aspect ratio at a time.** It
  drives the Resize & Enhance tab's single download. Batch Export renders
  many different aspect ratios at once, so it always falls back to an
  auto-centered crop per size rather than reusing your manual frame
  position — there's no single crop position that's meaningful across a
  square Instagram post and a tall WhatsApp status image at the same time.
- **Upscaling is smoothing, not AI super-resolution.** The 2×/4× upscale
  option enlarges using high-quality canvas interpolation. It will not
  invent detail that isn't in the source photo — for genuinely blurry or
  low-res source images, don't expect DSLR-quality output.
- **Sharpen is a standard unsharp-mask convolution**, run in JavaScript on
  the canvas pixel data. It's skipped automatically above roughly 3000×3000
  px to keep the browser responsive, since the algorithm is O(width ×
  height).
- **Passport photo dimensions are an approximation.** Official
  requirements vary by country and issuing authority — always verify
  against your specific country's current rules before submitting.
- **Everything runs in your browser tab.** Nothing is uploaded anywhere,
  which also means nothing here can process images faster than your
  device's own CPU/GPU allows — very large batch jobs on large images may
  take a few seconds per image.

## Getting started

No installation required.

```bash
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

Or host the folder as-is on any static host (GitHub Pages, Netlify, S3) —
nothing to build or compile.

## Project structure

```
framewise/
├── index.html           # markup + styles
├── app.js                # all application logic
├── README.md             # this file
├── LICENSE                # MIT
└── docs/
    └── ARCHITECTURE.md   # how the code is organized internally
```

## Tech stack

- Plain HTML/CSS/JS — no framework, no build step.
- [JSZip](https://stuk.github.io/jszip/) (loaded from cdnjs) for the Batch
  Export ZIP download.
- Canvas 2D API for every image operation: crop/pad, CSS `filter` for
  brightness/contrast/saturation, and a manual convolution for sharpening.
- Google Fonts: Space Grotesk (display) + IBM Plex Mono (data/UI text).

## Browser support

Any modern evergreen browser (Chrome, Firefox, Safari, Edge). Relies on
`<canvas>`, `FileReader`, `Blob`, and `canvas.toBlob` — all standard since
~2015. WebP export support depends on the browser's canvas encoder
(all current major browsers support it).

## License

MIT — see `LICENSE`.
