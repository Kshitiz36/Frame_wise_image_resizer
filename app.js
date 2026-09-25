/* ============================================================
   FRAMEWISE — resize / enhance / compress / convert, all client-side
   ============================================================ */

/* ---------- Trending preset sizes ---------- */
const PRESETS = [
  {cat:'WhatsApp',   name:'Profile / DP',      w:500,  h:500},
  {cat:'WhatsApp',   name:'Status Image',      w:1080, h:1920},
  {cat:'Telegram',   name:'Profile Photo',     w:512,  h:512},
  {cat:'Instagram',  name:'Post (Square)',     w:1080, h:1080},
  {cat:'Instagram',  name:'Post (Portrait)',   w:1080, h:1350},
  {cat:'Instagram',  name:'Post (Landscape)',  w:1080, h:566},
  {cat:'Instagram',  name:'Story / Reel',      w:1080, h:1920},
  {cat:'Instagram',  name:'Profile Picture',   w:320,  h:320},
  {cat:'Facebook',   name:'Profile Picture',   w:720,  h:720},
  {cat:'Facebook',   name:'Cover Photo',       w:820,  h:312},
  {cat:'Facebook',   name:'Post Image',        w:1200, h:630},
  {cat:'X / Twitter',name:'Profile Photo',     w:400,  h:400},
  {cat:'X / Twitter',name:'Header',            w:1500, h:500},
  {cat:'X / Twitter',name:'Post Image',        w:1600, h:900},
  {cat:'LinkedIn',   name:'Profile Photo',     w:400,  h:400},
  {cat:'LinkedIn',   name:'Cover Banner',      w:1584, h:396},
  {cat:'LinkedIn',   name:'Post Image',        w:1200, h:627},
  {cat:'YouTube',    name:'Channel Icon',      w:800,  h:800},
  {cat:'YouTube',    name:'Thumbnail',         w:1280, h:720},
  {cat:'YouTube',    name:'Channel Banner',    w:2560, h:1440},
  {cat:'Snapchat',   name:'Profile Picture',   w:320,  h:320},
  {cat:'Pinterest',  name:'Pin Image',         w:1000, h:1500},
  {cat:'General',    name:'Passport Photo*',   w:413,  h:531},
  {cat:'General',    name:'HD Wallpaper',      w:1920, h:1080},
  {cat:'General',    name:'4K Wallpaper',      w:3840, h:2160},
];

/* ---------- Global state ---------- */
let workingImage = null;      // {img, file, name, type, w, h, aspect}
let lastResizeCanvas = null;
let lastCompressBlob = null;
let lastConvertBlob = null;

/* Interactive crop-frame state — only meaningful in "cover" fit mode.
   dispW/dispH/scale describe how the full source image is shown in the
   crop stage; frameLeft/Top/W/H are in that same display-pixel space. */
let cropStage = null; // {dispW, dispH, scale, frameLeft, frameTop, frameW, frameH}
let cropDragging = false;
let cropDragStart = null; // {mouseX, mouseY, frameLeft, frameTop}

/* ---------- Small helpers ---------- */
function $(id){ return document.getElementById(id); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function extFromMime(m){ return m==='image/jpeg' ? 'jpg' : m==='image/png' ? 'png' : 'webp'; }
function humanKB(bytes){ return Math.round(bytes/1024*10)/10 + ' KB'; }

function canvasToBlobAsync(canvas, mime, q){
  return new Promise(res => canvas.toBlob(res, mime, q));
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadCanvas(canvas, filename, mime, quality){
  canvas.toBlob(blob => downloadBlob(blob, filename), mime, quality);
}

/* ---------- Image loading (shared across all tools) ---------- */
function handleFile(file){
  if(!file || !file.type.startsWith('image/')){
    alert('Please choose an image file (JPG, PNG, or WebP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      workingImage = {
        img, file, name: file.name, type: file.type,
        w: img.naturalWidth, h: img.naturalHeight,
        aspect: img.naturalWidth / img.naturalHeight
      };
      onImageLoaded();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function onImageLoaded(){
  $('work-empty').style.display = 'none';
  $('work-loaded').style.display = 'flex';
  $('work-thumb-img').src = workingImage.img.src;
  $('work-fname').textContent = workingImage.name;
  $('work-fmeta').textContent = `${workingImage.w}×${workingImage.h}px · ${humanKB(workingImage.file.size)} · ${workingImage.type.replace('image/','').toUpperCase()}`;

  $('cw').value = workingImage.w;
  $('ch').value = workingImage.h;
  document.querySelectorAll('.preset-chip').forEach(c=>c.classList.remove('active'));

  ['resize-generate-btn','compress-btn','convert-btn'].forEach(id => $(id).disabled = false);
  updateBatchButtonState();

  resetCropFrame();
  updateCropSectionVisibility();
  renderResizePreview();
}

/* ---------- Geometry: fit-mode crop/pad rectangles ---------- */
function getFitRect(srcW, srcH, dstW, dstH, fit, manualCropRect){
  if(fit === 'stretch'){
    return {sx:0, sy:0, sw:srcW, sh:srcH, dx:0, dy:0, dw:dstW, dh:dstH};
  }
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  if(fit === 'cover'){
    if(manualCropRect){
      // user-positioned crop frame from the interactive selector
      return {sx:manualCropRect.sx, sy:manualCropRect.sy, sw:manualCropRect.sw, sh:manualCropRect.sh, dx:0, dy:0, dw:dstW, dh:dstH};
    }
    let sw, sh, sx, sy;
    if(srcRatio > dstRatio){ sh = srcH; sw = sh * dstRatio; sx = (srcW - sw) / 2; sy = 0; }
    else { sw = srcW; sh = sw / dstRatio; sx = 0; sy = (srcH - sh) / 2; }
    return {sx, sy, sw, sh, dx:0, dy:0, dw:dstW, dh:dstH};
  }
  // contain
  let dw, dh, dx, dy;
  if(srcRatio > dstRatio){ dw = dstW; dh = dw / srcRatio; dx = 0; dy = (dstH - dh) / 2; }
  else { dh = dstH; dw = dh * srcRatio; dy = 0; dx = (dstW - dw) / 2; }
  return {sx:0, sy:0, sw:srcW, sh:srcH, dx, dy, dw, dh};
}

/* Converts the current cropStage display-space frame into source-image
   pixel coordinates. Returns null if there's no active crop stage. */
function getManualCropRect(){
  if(!cropStage || !workingImage) return null;
  const {scale, frameLeft, frameTop, frameW, frameH} = cropStage;
  return {
    sx: frameLeft / scale,
    sy: frameTop / scale,
    sw: frameW / scale,
    sh: frameH / scale,
  };
}

/* ---------- Enhance: CSS filter string + sharpen convolution ---------- */
function buildFilterString(enhance){
  return `brightness(${100+enhance.brightness}%) contrast(${100+enhance.contrast}%) saturate(${100+enhance.saturate}%)`;
}

function applySharpen(ctx, w, h, amount){
  if(amount <= 0 || w*h > 3000*3000) return; // safety cap to keep the tab responsive
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src.length);
  const k = [0,-1,0, -1,5,-1, 0,-1,0];
  for(let y=0; y<h; y++){
    for(let x=0; x<w; x++){
      for(let c=0; c<3; c++){
        let sum = 0, ki = 0;
        for(let ky=-1; ky<=1; ky++){
          for(let kx=-1; kx<=1; kx++){
            const yy = Math.min(h-1, Math.max(0, y+ky));
            const xx = Math.min(w-1, Math.max(0, x+kx));
            sum += src[(yy*w+xx)*4+c] * k[ki++];
          }
        }
        const idx = (y*w+x)*4+c;
        out[idx] = src[idx]*(1-amount) + sum*amount;
      }
      const a = (y*w+x)*4+3;
      out[a] = src[a];
    }
  }
  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
}

/* ---------- Core composite renderer used by Resize + Batch ---------- */
function renderComposite(img, targetW, targetH, fit, bgColor, enhance, upscale, manualCropRect){
  const finalW = Math.max(1, Math.round(targetW * upscale));
  const finalH = Math.max(1, Math.round(targetH * upscale));
  const canvas = document.createElement('canvas');
  canvas.width = finalW; canvas.height = finalH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, finalW, finalH);
  const r = getFitRect(img.naturalWidth, img.naturalHeight, finalW, finalH, fit, manualCropRect);
  ctx.filter = buildFilterString(enhance);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  ctx.filter = 'none';
  applySharpen(ctx, finalW, finalH, enhance.sharpen/100);
  return canvas;
}

/* ---------- Preview panel ---------- */
function showInPreview(canvas, extraMeta){
  const pc = $('preview-canvas');
  pc.width = canvas.width; pc.height = canvas.height;
  pc.getContext('2d').drawImage(canvas, 0, 0);
  pc.style.display = 'block';
  $('preview-placeholder').style.display = 'none';
  $('preview-meta').innerHTML = `<b>${canvas.width}×${canvas.height}px</b>` + (extraMeta ? '<br>' + extraMeta : '');
}

/* ============================================================
   RESIZE & ENHANCE TAB
   ============================================================ */
function getEnhanceSettings(){
  return {
    brightness: +$('brightness').value,
    contrast: +$('contrast').value,
    saturate: +$('saturate').value,
    sharpen: +$('sharpen').value,
  };
}
function getTargetDims(){
  const w = +$('cw').value || (workingImage ? workingImage.w : 1000);
  const h = +$('ch').value || (workingImage ? workingImage.h : 1000);
  return {w, h};
}
function getFitMode(){ return document.querySelector('#fitmode button.active').dataset.fit; }
function getBgColor(){ return $('bg-color').value; }
function getUpscale(){ return +$('upscale').value; }

function renderResizePreview(){
  if(!workingImage) return;
  const {w, h} = getTargetDims();
  const fit = getFitMode();
  const manualCropRect = fit === 'cover' ? getManualCropRect() : null;
  const canvas = renderComposite(workingImage.img, w, h, fit, getBgColor(), getEnhanceSettings(), getUpscale(), manualCropRect);
  lastResizeCanvas = canvas;
  showInPreview(canvas);
  $('resize-download-btn').disabled = false;
}
const scheduleResizeRender = debounce(renderResizePreview, 220);

/* ---------- Interactive crop-frame selector ---------- */
function computeDispSize(srcW, srcH, maxDim){
  let scale = Math.min(maxDim/srcW, maxDim/srcH);
  if(scale > 2) scale = 2; // don't blow up tiny images too much
  return {dispW: Math.round(srcW*scale), dispH: Math.round(srcH*scale), scale};
}

function updateCropSectionVisibility(){
  const show = !!(workingImage && getFitMode() === 'cover');
  $('crop-section').style.display = show ? 'block' : 'none';
}

function resetCropFrame(){
  if(!workingImage) return;
  const {w:targetW, h:targetH} = getTargetDims();
  const ar = (targetW > 0 && targetH > 0) ? targetW/targetH : 1;
  const {dispW, dispH, scale} = computeDispSize(workingImage.w, workingImage.h, 380);

  let frameW, frameH;
  if(dispW/dispH > ar){ frameH = dispH; frameW = frameH*ar; }
  else { frameW = dispW; frameH = frameW/ar; }

  const zoom = +$('crop-zoom').value || 1;
  frameW = Math.min(dispW, frameW/zoom);
  frameH = Math.min(dispH, frameH/zoom);

  cropStage = {
    dispW, dispH, scale,
    frameW, frameH,
    frameLeft: (dispW-frameW)/2,
    frameTop: (dispH-frameH)/2,
  };
  layoutCropStage();
}

function layoutCropStage(){
  if(!cropStage || !workingImage) return;
  const stage = $('crop-stage'), img = $('crop-image'), frame = $('crop-frame');
  stage.style.width = cropStage.dispW + 'px';
  stage.style.height = cropStage.dispH + 'px';
  img.src = workingImage.img.src;
  img.style.width = cropStage.dispW + 'px';
  img.style.height = cropStage.dispH + 'px';
  frame.style.width = cropStage.frameW + 'px';
  frame.style.height = cropStage.frameH + 'px';
  frame.style.left = cropStage.frameLeft + 'px';
  frame.style.top = cropStage.frameTop + 'px';
}

function clampFramePosition(){
  cropStage.frameLeft = Math.min(Math.max(0, cropStage.frameLeft), cropStage.dispW - cropStage.frameW);
  cropStage.frameTop = Math.min(Math.max(0, cropStage.frameTop), cropStage.dispH - cropStage.frameH);
}

function onCropPointerDown(e){
  if(!cropStage) return;
  cropDragging = true;
  $('crop-stage').classList.add('dragging');
  const point = e.touches ? e.touches[0] : e;
  cropDragStart = { x: point.clientX, y: point.clientY, left: cropStage.frameLeft, top: cropStage.frameTop };
  e.preventDefault();
}
function onCropPointerMove(e){
  if(!cropDragging || !cropStage) return;
  const point = e.touches ? e.touches[0] : e;
  const dx = point.clientX - cropDragStart.x;
  const dy = point.clientY - cropDragStart.y;
  cropStage.frameLeft = cropDragStart.left + dx;
  cropStage.frameTop = cropDragStart.top + dy;
  clampFramePosition();
  layoutCropStage();
  scheduleResizeRender();
  e.preventDefault();
}
function onCropPointerUp(){
  cropDragging = false;
  $('crop-stage').classList.remove('dragging');
}

function onCropZoomChange(){
  if(!cropStage || !workingImage) return;
  const {w:targetW, h:targetH} = getTargetDims();
  const ar = (targetW > 0 && targetH > 0) ? targetW/targetH : 1;
  const zoom = +$('crop-zoom').value;
  $('crop-zoom-val').textContent = zoom.toFixed(1) + '×';

  const cx = cropStage.frameLeft + cropStage.frameW/2;
  const cy = cropStage.frameTop + cropStage.frameH/2;

  let baseW, baseH;
  if(cropStage.dispW/cropStage.dispH > ar){ baseH = cropStage.dispH; baseW = baseH*ar; }
  else { baseW = cropStage.dispW; baseH = baseW/ar; }

  cropStage.frameW = Math.min(cropStage.dispW, baseW/zoom);
  cropStage.frameH = Math.min(cropStage.dispH, baseH/zoom);
  cropStage.frameLeft = cx - cropStage.frameW/2;
  cropStage.frameTop = cy - cropStage.frameH/2;
  clampFramePosition();
  layoutCropStage();
  scheduleResizeRender();
}

/* ============================================================
   BATCH EXPORT TAB
   ============================================================ */
function renderBatchChecklist(){
  const list = $('batch-checklist');
  list.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const item = document.createElement('label');
    item.className = 'check-item';
    item.innerHTML = `<input type="checkbox" data-idx="${i}"><span class="cname">${p.cat} — ${p.name}</span><span class="cdim">${p.w}×${p.h}</span>`;
    item.querySelector('input').addEventListener('change', updateBatchButtonState);
    list.appendChild(item);
  });
}
function updateBatchButtonState(){
  const any = Array.from(document.querySelectorAll('#batch-checklist input:checked')).length > 0;
  $('batch-generate-btn').disabled = !(workingImage && any);
}

async function generateBatchZip(){
  const checked = Array.from(document.querySelectorAll('#batch-checklist input:checked')).map(c => PRESETS[+c.dataset.idx]);
  if(!workingImage || checked.length === 0) return;

  const zip = new JSZip();
  const format = $('batch-format').value;
  const quality = +$('out-quality').value / 100;
  const enhance = getEnhanceSettings();
  const fit = getFitMode();
  const bg = getBgColor();
  const upscale = getUpscale();
  const ext = extFromMime(format);

  $('batch-progress').style.display = 'block';
  $('batch-generate-btn').disabled = true;

  for(let i=0; i<checked.length; i++){
    const p = checked[i];
    const canvas = renderComposite(workingImage.img, p.w, p.h, fit, bg, enhance, upscale);
    const blob = await canvasToBlobAsync(canvas, format, quality);
    const safeName = `${p.cat}-${p.name}`.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    zip.file(`${safeName}_${p.w}x${p.h}.${ext}`, blob);
    const pct = Math.round(((i+1) / checked.length) * 100);
    $('batch-progress-fill').style.width = pct + '%';
    $('batch-progress-label').textContent = `Rendering ${i+1} / ${checked.length} — ${p.cat} ${p.name}`;
  }

  $('batch-progress-label').textContent = 'Zipping…';
  const blob = await zip.generateAsync({type:'blob'});
  downloadBlob(blob, 'framewise-batch.zip');
  $('batch-progress-label').textContent = `Done — ${checked.length} images exported.`;
  $('batch-generate-btn').disabled = false;
}

/* ============================================================
   COMPRESS TAB
   ============================================================ */
async function compressToTarget(canvas, mime, targetBytes){
  let lo = 0.02, hi = 1.0, best = null;
  for(let i=0; i<8; i++){
    const mid = (lo + hi) / 2;
    const blob = await canvasToBlobAsync(canvas, mime, mid);
    if(blob.size <= targetBytes){ best = {blob, q:mid}; lo = mid; } else { hi = mid; }
  }
  if(!best) best = {blob: await canvasToBlobAsync(canvas, mime, 0.02), q:0.02};
  return best;
}

async function runCompress(){
  if(!workingImage) return;
  const targetKB = +$('target-kb').value;
  if(!targetKB){ alert('Enter a target size in KB.'); return; }
  const format = $('compress-format').value;
  const status = $('compress-status');
  status.innerHTML = '<div class="notice info">Searching for the best quality…</div>';

  const canvas = renderComposite(workingImage.img, workingImage.w, workingImage.h, 'stretch', '#ffffff', {brightness:0,contrast:0,saturate:0,sharpen:0}, 1);

  if(format === 'image/png'){
    const blob = await canvasToBlobAsync(canvas, 'image/png', 1);
    lastCompressBlob = blob;
    showInPreview(canvas, humanKB(blob.size) + ' (PNG is lossless — size can\'t be targeted)');
    status.innerHTML = `<div class="notice warn">PNG is lossless, so quality can't be reduced. Actual size: ${humanKB(blob.size)}. Switch to JPEG or WebP to hit a target size.</div>`;
    $('compress-download-btn').disabled = false;
    return;
  }

  const {blob, q} = await compressToTarget(canvas, format, targetKB*1024);
  lastCompressBlob = blob;
  showInPreview(canvas, `${humanKB(blob.size)} at quality ${Math.round(q*100)}`);
  const overUnder = blob.size <= targetKB*1024 ? 'Target reached' : 'Couldn\'t get under target even at minimum quality';
  status.innerHTML = `<div class="notice ${blob.size <= targetKB*1024 ? 'info' : 'warn'}">${overUnder} — final size ${humanKB(blob.size)} at quality ${Math.round(q*100)}/100.</div>`;
  $('compress-download-btn').disabled = false;
}

/* ============================================================
   CONVERT FORMAT TAB
   ============================================================ */
async function runConvert(){
  if(!workingImage) return;
  const format = $('convert-format').value;
  const quality = +$('convert-quality').value / 100;
  const bg = $('convert-bg').value;

  const canvas = document.createElement('canvas');
  canvas.width = workingImage.w; canvas.height = workingImage.h;
  const ctx = canvas.getContext('2d');
  if(format === 'image/jpeg'){ ctx.fillStyle = bg; ctx.fillRect(0,0,canvas.width,canvas.height); }
  ctx.drawImage(workingImage.img, 0, 0);

  const blob = await canvasToBlobAsync(canvas, format, quality);
  lastConvertBlob = blob;
  showInPreview(canvas, `Converted to ${format.replace('image/','').toUpperCase()} · ${humanKB(blob.size)}`);
  $('convert-download-btn').disabled = false;
}

/* ============================================================
   UI wiring
   ============================================================ */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel-view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
}

function renderPresetContainer(){
  const container = $('preset-container');
  const cats = {};
  PRESETS.forEach(p => { (cats[p.cat] = cats[p.cat] || []).push(p); });
  container.innerHTML = '';
  Object.keys(cats).forEach(cat => {
    const catEl = document.createElement('div');
    catEl.className = 'preset-cat';
    catEl.textContent = cat;
    container.appendChild(catEl);

    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    cats[cat].forEach(p => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'preset-chip';
      chip.innerHTML = `<div class="pname">${p.name}</div><div class="pdim">${p.w}×${p.h}</div>`;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        $('cw').value = p.w; $('ch').value = p.h;
        if(workingImage){ resetCropFrame(); renderResizePreview(); } else { scheduleResizeRender(); }
      });
      grid.appendChild(chip);
    });
    container.appendChild(grid);
  });
  const note = document.createElement('div');
  note.className = 'notice info';
  note.style.marginTop = '14px';
  note.textContent = '* Passport photo size shown is a common approximate — official requirements vary by country and issuing authority.';
  container.appendChild(note);
}

document.addEventListener('DOMContentLoaded', () => {
  renderPresetContainer();
  renderBatchChecklist();

  /* tabs */
  $('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if(btn) switchTab(btn.dataset.tab);
  });

  /* shared image upload */
  const fileInput = $('global-file');
  $('work-empty').addEventListener('click', () => fileInput.click());
  $('change-photo-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if(fileInput.files[0]) handleFile(fileInput.files[0]); });
  ['dragover'].forEach(ev => $('work-empty').addEventListener(ev, e => { e.preventDefault(); $('work-empty').classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => $('work-empty').addEventListener(ev, () => $('work-empty').classList.remove('drag')));
  $('work-empty').addEventListener('drop', e => { e.preventDefault(); if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

  /* custom dims + aspect lock */
  const dimsChangedDebounced = debounce(() => { if(workingImage) resetCropFrame(); renderResizePreview(); }, 250);
  $('cw').addEventListener('input', () => {
    if($('lock-aspect').checked && workingImage) $('ch').value = Math.round($('cw').value / workingImage.aspect) || '';
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    dimsChangedDebounced();
  });
  $('ch').addEventListener('input', () => {
    if($('lock-aspect').checked && workingImage) $('cw').value = Math.round($('ch').value * workingImage.aspect) || '';
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    dimsChangedDebounced();
  });

  /* fit mode */
  $('fitmode').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if(!btn) return;
    document.querySelectorAll('#fitmode button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateCropSectionVisibility();
    if(btn.dataset.fit === 'cover' && workingImage) resetCropFrame();
    scheduleResizeRender();
  });

  /* crop-frame drag (mouse + touch) */
  $('crop-frame').addEventListener('mousedown', onCropPointerDown);
  $('crop-frame').addEventListener('touchstart', onCropPointerDown, {passive:false});
  document.addEventListener('mousemove', onCropPointerMove);
  document.addEventListener('touchmove', onCropPointerMove, {passive:false});
  document.addEventListener('mouseup', onCropPointerUp);
  document.addEventListener('touchend', onCropPointerUp);
  $('crop-zoom').addEventListener('input', onCropZoomChange);

  /* enhance sliders */
  [['sharpen','sharpen-val'], ['brightness','bright-val'], ['contrast','contrast-val'], ['saturate','saturate-val']].forEach(([id,valId]) => {
    $(id).addEventListener('input', () => { $(valId).textContent = $(id).value; scheduleResizeRender(); });
  });
  $('upscale').addEventListener('change', scheduleResizeRender);
  $('bg-color').addEventListener('input', scheduleResizeRender);
  $('out-format').addEventListener('change', scheduleResizeRender);
  $('out-quality').addEventListener('input', scheduleResizeRender);

  $('auto-enhance-btn').addEventListener('click', () => {
    $('sharpen').value = 30; $('sharpen-val').textContent = 30;
    $('brightness').value = 6; $('bright-val').textContent = 6;
    $('contrast').value = 12; $('contrast-val').textContent = 12;
    $('saturate').value = 10; $('saturate-val').textContent = 10;
    renderResizePreview();
  });

  /* resize tab buttons */
  $('resize-generate-btn').addEventListener('click', renderResizePreview);
  $('resize-download-btn').addEventListener('click', () => {
    if(!lastResizeCanvas) return;
    const format = $('out-format').value;
    const quality = +$('out-quality').value / 100;
    downloadCanvas(lastResizeCanvas, `framewise-resized.${extFromMime(format)}`, format, quality);
  });

  /* batch tab */
  $('select-all-link').addEventListener('click', () => {
    const boxes = document.querySelectorAll('#batch-checklist input');
    const allChecked = Array.from(boxes).every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    updateBatchButtonState();
  });
  $('batch-generate-btn').addEventListener('click', generateBatchZip);

  /* compress tab */
  $('compress-btn').addEventListener('click', runCompress);
  $('compress-download-btn').addEventListener('click', () => {
    if(!lastCompressBlob) return;
    const format = $('compress-format').value;
    downloadBlob(lastCompressBlob, `framewise-compressed.${extFromMime(format)}`);
  });

  /* convert tab */
  $('convert-btn').addEventListener('click', runConvert);
  $('convert-download-btn').addEventListener('click', () => {
    if(!lastConvertBlob) return;
    const format = $('convert-format').value;
    downloadBlob(lastConvertBlob, `framewise-converted.${extFromMime(format)}`);
  });
});
