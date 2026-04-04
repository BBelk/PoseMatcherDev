// ========== INDEXEDDB PERSISTENCE ==========

const DB_NAME = 'PoseMatcherDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite');
    tx.objectStore('blobs').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbAllKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ========== CLEAR ALL ==========

const clearAllBtn = document.getElementById('clear-all-btn');

function updateClearAllVisibility() {
  const hasRef = document.getElementById('reference-box').classList.contains('has-image');
  const hasCmp = comparisons.some(c => c !== null);
  clearAllBtn.style.display = (hasRef || hasCmp) ? '' : 'none';
}

// ========== EXIF DATE PARSER ==========

async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buf);

    if (view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) break;
      if ((marker & 0xFF00) !== 0xFF00) return null;
      offset += 2 + view.getUint16(offset + 2);
    }

    const app1Start = offset + 4;
    if (view.getUint32(app1Start) !== 0x45786966 || view.getUint16(app1Start + 4) !== 0) return null;

    const tiffStart = app1Start + 6;
    const le = view.getUint16(tiffStart) === 0x4949;

    function u16(o) { return view.getUint16(tiffStart + o, le); }
    function u32(o) { return view.getUint32(tiffStart + o, le); }

    let ifdStart = u32(4);
    let entries = u16(ifdStart);
    let exifOffset = null;
    for (let i = 0; i < entries; i++) {
      const entryOff = ifdStart + 2 + i * 12;
      if (u16(entryOff) === 0x8769) {
        exifOffset = u32(entryOff + 8);
        break;
      }
    }
    if (!exifOffset) return null;

    entries = u16(exifOffset);
    for (let i = 0; i < entries; i++) {
      const entryOff = exifOffset + 2 + i * 12;
      const tag = u16(entryOff);
      if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
        const strOffset = u32(entryOff + 8);
        let str = '';
        for (let j = 0; j < 19; j++) {
          str += String.fromCharCode(view.getUint8(tiffStart + strOffset + j));
        }
        return str.slice(0,4) + '-' + str.slice(5,7) + '-' + str.slice(8,10) + ' ' + str.slice(11);
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ========== SETTINGS ==========

const scoreThreshSlider = document.getElementById('score-thresh');
const scoreThreshVal = document.getElementById('score-thresh-val');
const kpThreshSlider = document.getElementById('kp-thresh');
const kpThreshVal = document.getElementById('kp-thresh-val');

scoreThreshSlider.addEventListener('input', () => {
  POSE_CONFIG.scoreThreshold = parseFloat(scoreThreshSlider.value);
  scoreThreshVal.textContent = scoreThreshSlider.value;
});

kpThreshSlider.addEventListener('input', () => {
  POSE_CONFIG.confidenceThreshold = parseFloat(kpThreshSlider.value);
  kpThreshVal.textContent = kpThreshSlider.value;
});

// ========== POSE STORAGE ==========

const storedPoses = { ref: null };

// ========== REFERENCE IMAGE BOX ==========

(function setupReference() {
  const box = document.getElementById('reference-box');
  const img = document.getElementById('ref-img');
  const fileInput = document.getElementById('ref-file');
  const canvas = document.getElementById('ref-canvas');
  const status = document.getElementById('ref-status');
  const meta = document.getElementById('ref-meta');
  const clearBtn = box.querySelector('.clear-btn');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImage(file);
  });

  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
  box.addEventListener('dragleave', () => { box.classList.remove('dragover'); });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  box.addEventListener('click', (e) => {
    if (e.target.closest('.upload-label') || e.target === fileInput) return;
    if (!box.classList.contains('has-image') && e.target !== clearBtn) fileInput.click();
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearRef();
  });

  function clearRef() {
    img.src = '';
    box.classList.remove('has-image');
    fileInput.value = '';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    status.textContent = '';
    meta.textContent = '';
    storedPoses.ref = null;
    dbDelete('ref');
    updateClearAllVisibility();
  }

  function loadImage(file) {
    readExifDate(file).then(date => { meta.textContent = date || ''; });
    // Persist blob
    file.arrayBuffer().then(buf => dbPut('ref', new Blob([buf], { type: file.type })));
    loadBlob(file);
  }

  function loadBlob(blob) {
    const url = URL.createObjectURL(blob);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      box.classList.add('has-image');
      canvas.width = box.clientWidth;
      canvas.height = box.clientHeight;
      // Populate output dimensions from reference
      document.getElementById('output-width').value = img.naturalWidth;
      document.getElementById('output-height').value = img.naturalHeight;
      updateClearAllVisibility();
      await runDetection();
    };
    img.src = url;
  }

  // Expose for restore and clear all
  window._refClear = clearRef;
  window._refLoadBlob = loadBlob;

  async function runDetection() {
    status.textContent = 'Detecting pose...';
    try {
      const poses = await estimatePoses(img);
      storedPoses.ref = poses;
      const rect = getDisplayRect(img.naturalWidth, img.naturalHeight, box);
      drawPoses(canvas, poses, rect);
      const total = poses.length;
      status.textContent = total + ' person' + (total !== 1 ? 's' : '') + ' detected';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      console.error('Pose detection failed:', err);
      status.textContent = 'Model error — see console';
    }
  }

  window.addEventListener('resize', () => {
    if (!box.classList.contains('has-image')) return;
    canvas.width = box.clientWidth;
    canvas.height = box.clientHeight;
    runDetection();
  });
})();

// ========== COMPARISONS (multi-image) ==========

const compareGrid = document.getElementById('compare-grid');
const cmpFileInput = document.getElementById('cmp-file');
const comparisons = []; // { img, poses, date, card }
let selectedCmpIndex = -1;

const compareSection = document.getElementById('filmstrip-section');

async function addMultipleComparisons(files) {
  for (const file of files) await addComparison(file);
}

cmpFileInput.addEventListener('change', (e) => {
  addMultipleComparisons(Array.from(e.target.files));
  cmpFileInput.value = '';
});

compareSection.addEventListener('dragover', (e) => {
  e.preventDefault();
  compareSection.classList.add('dragover');
});

compareSection.addEventListener('dragleave', () => {
  compareSection.classList.remove('dragover');
});

compareSection.addEventListener('drop', (e) => {
  e.preventDefault();
  compareSection.classList.remove('dragover');
  addMultipleComparisons(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
});

let cmpIdCounter = 0;

async function addComparison(fileOrBlob, dbKey) {
  const date = fileOrBlob.name ? await readExifDate(fileOrBlob) : null;

  // Persist with a stable unique key
  const key = dbKey || ('cmp_' + Date.now() + '_' + (cmpIdCounter++));
  if (!dbKey) {
    const buf = await fileOrBlob.arrayBuffer();
    await dbPut(key, new Blob([buf], { type: fileOrBlob.type }));
  }

  const card = document.createElement('div');
  card.className = 'cmp-card';

  const img = document.createElement('img');
  img.alt = 'Comparison';

  const canvas = document.createElement('canvas');
  const metaEl = document.createElement('div');
  metaEl.className = 'img-meta';
  metaEl.textContent = date || '';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.textContent = '\u00d7';
  clearBtn.title = 'Remove';

  card.append(img, canvas, metaEl, clearBtn);
  compareGrid.appendChild(card);

  const index = comparisons.length;
  const entry = { img, poses: null, date, card, dbKey: key };
  comparisons.push(entry);

  card.addEventListener('click', (e) => {
    if (e.target === clearBtn) return;
    selectComparison(index);
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeComparison(index);
  });

  // Wait for image to actually load before continuing
  await new Promise((resolve) => {
    img.onload = async () => {
      canvas.width = card.clientWidth;
      canvas.height = card.clientHeight;
      try {
        const poses = await estimatePoses(img);
        entry.poses = poses;
        const rect = getDisplayRect(img.naturalWidth, img.naturalHeight, card);
        drawPoses(canvas, poses, rect);
      } catch (err) {
        console.error('Comparison pose failed:', err);
      }
      updateClearAllVisibility();
      resolve();
    };
    img.onerror = resolve;
    img.src = URL.createObjectURL(fileOrBlob);
  });

  if (comparisons.filter(c => c).length === 1) selectComparison(index);
}

function selectComparison(index) {
  selectedCmpIndex = index;
  compareGrid.querySelectorAll('.cmp-card').forEach((c, i) => {
    c.classList.toggle('selected', i === index);
  });
}

function removeComparison(index) {
  const entry = comparisons[index];
  if (!entry) return;
  entry.card.remove();
  dbDelete(entry.dbKey);
  comparisons[index] = null;
  updateClearAllVisibility();
  if (selectedCmpIndex === index) {
    selectedCmpIndex = -1;
    for (let i = 0; i < comparisons.length; i++) {
      if (comparisons[i]) { selectComparison(i); break; }
    }
  }
}

function getSelectedComparison() {
  if (selectedCmpIndex < 0) return null;
  return comparisons[selectedCmpIndex] || null;
}

// ========== OUTPUT (generate GIF) ==========

const generateBtn = document.getElementById('generate-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const outputBox = document.getElementById('output-box');
const outputGif = document.getElementById('output-gif');
const refImg = document.getElementById('ref-img');
const overlayStatus = document.getElementById('overlay-status');
const frameDurationInput = document.getElementById('frame-duration');

const alignPartSelect = document.getElementById('align-part');

const MIDPOINT_PAIRS = {
  eyes_mid: [1, 2],
  shoulders_mid: [5, 6],
  hips_mid: [11, 12],
};

// --- Alignment helper ---

function getAlignConfig() {
  const val = alignPartSelect.value;
  if (MIDPOINT_PAIRS[val]) {
    return { type: 'pair', indices: MIDPOINT_PAIRS[val], label: val.replace('_mid', '') };
  }
  return { type: 'single', index: parseInt(val), label: COCO_KEYPOINTS[parseInt(val)] };
}

function computeAlignTransform(refKps, cmpKps, refImgEl, cmpImgEl, w, h) {
  const align = getAlignConfig();
  const thresh = POSE_CONFIG.confidenceThreshold;
  const container = { clientWidth: w, clientHeight: h };
  const refRect = getDisplayRect(refImgEl.naturalWidth, refImgEl.naturalHeight, container);
  const cmpRect = getDisplayRect(cmpImgEl.naturalWidth, cmpImgEl.naturalHeight, container);

  function toCanvas(kp, rect) {
    return { x: rect.offsetX + kp.x * rect.width, y: rect.offsetY + kp.y * rect.height };
  }

  if (align.type === 'pair') {
    const [i1, i2] = align.indices;
    const refOk = refKps[i1].confidence >= thresh && refKps[i2].confidence >= thresh;
    const cmpOk = cmpKps[i1].confidence >= thresh && cmpKps[i2].confidence >= thresh;
    if (!refOk || !cmpOk) return null;

    const refA = toCanvas(refKps[i1], refRect), refB = toCanvas(refKps[i2], refRect);
    const cmpA = toCanvas(cmpKps[i1], cmpRect), cmpB = toCanvas(cmpKps[i2], cmpRect);

    const refCx = (refA.x + refB.x) / 2, refCy = (refA.y + refB.y) / 2;
    const cmpCx = (cmpA.x + cmpB.x) / 2, cmpCy = (cmpA.y + cmpB.y) / 2;
    const refDist = Math.hypot(refB.x - refA.x, refB.y - refA.y);
    const cmpDist = Math.hypot(cmpB.x - cmpA.x, cmpB.y - cmpA.y);
    const refAngle = Math.atan2(refB.y - refA.y, refB.x - refA.x);
    const cmpAngle = Math.atan2(cmpB.y - cmpA.y, cmpB.x - cmpA.x);

    return {
      refCx, refCy, cmpCx, cmpCy,
      scale: refDist / cmpDist,
      rotation: document.getElementById('rotate-toggle').checked ? refAngle - cmpAngle : 0,
      refRect, cmpRect,
    };
  } else {
    const i = align.index;
    if (refKps[i].confidence < thresh || cmpKps[i].confidence < thresh) return null;

    const refP = toCanvas(refKps[i], refRect);
    const cmpP = toCanvas(cmpKps[i], cmpRect);

    return {
      refCx: refP.x, refCy: refP.y,
      cmpCx: cmpP.x, cmpCy: cmpP.y,
      scale: 1,
      rotation: 0,
      refRect, cmpRect,
    };
  }
}

// --- Frame rendering ---

function drawFrameCounter(ctx, num, w) {
  if (!document.getElementById('frame-counter-toggle').checked) return;
  const text = String(num);
  ctx.font = 'bold 14px system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const pad = 5;
  const bw = metrics.width + pad * 2;
  const bh = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(w - bw - 6, 6, bw, bh);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w - bw / 2 - 6, 6 + bh / 2);
}

function renderRefFrame(w, h, frameNum) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rect = getDisplayRect(refImg.naturalWidth, refImg.naturalHeight, { clientWidth: w, clientHeight: h });
  ctx.drawImage(refImg, rect.offsetX, rect.offsetY, rect.width, rect.height);
  drawFrameCounter(ctx, frameNum, w);
  return canvas;
}

function renderCmpFrame(cmp, w, h, frameNum) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const t = computeAlignTransform(
    storedPoses.ref[0].keypoints, cmp.poses[0].keypoints,
    refImg, cmp.img, w, h
  );
  if (!t) return null;

  ctx.save();
  ctx.translate(t.refCx, t.refCy);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.translate(-t.cmpCx, -t.cmpCy);
  ctx.drawImage(cmp.img, t.cmpRect.offsetX, t.cmpRect.offsetY, t.cmpRect.width, t.cmpRect.height);
  ctx.restore();

  drawFrameCounter(ctx, frameNum, w);
  return canvas;
}

// --- FFmpeg loading (local files, no CORS issues) ---

let ffmpeg = null;

async function loadFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;

  overlayStatus.textContent = 'Loading FFmpeg...';
  ffmpeg = new FFmpegWASM.FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    if (progress > 0) overlayStatus.textContent = 'Encoding: ' + Math.round(progress * 100) + '%';
  });

  await ffmpeg.load({
    coreURL: '/lib/ffmpeg/ffmpeg-core.js',
    wasmURL: '/lib/ffmpeg/ffmpeg-core.wasm',
  });

  return ffmpeg;
}

function canvasToUint8(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(async (blob) => {
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

// --- Generate GIF ---

generateBtn.addEventListener('click', generateGif);

async function generateGif() {
  overlayStatus.textContent = '';

  if (!refImg.naturalWidth) { overlayStatus.textContent = 'Upload a reference image'; return; }
  if (!storedPoses.ref || !storedPoses.ref.length) { overlayStatus.textContent = 'No pose in reference'; return; }

  const validCmps = comparisons.filter(c => c && c.poses && c.poses.length);
  if (!validCmps.length) { overlayStatus.textContent = 'Add comparison images'; return; }

  const align = getAlignConfig();
  const thresh = POSE_CONFIG.confidenceThreshold;
  const indices = align.type === 'pair' ? align.indices : [align.index];

  for (let i = 0; i < validCmps.length; i++) {
    const kps = validCmps[i].poses[0].keypoints;
    for (const idx of indices) {
      if (kps[idx].confidence < thresh) {
        overlayStatus.textContent = 'No ' + align.label + ' detected in comparison ' + (i + 1);
        return;
      }
    }
  }

  const w = parseInt(document.getElementById('output-width').value) || refImg.naturalWidth || outputBox.clientWidth;
  const h = parseInt(document.getElementById('output-height').value) || refImg.naturalHeight || outputBox.clientHeight;
  const frameDuration = parseFloat(frameDurationInput.value);
  const fps = 1 / frameDuration;

  overlayStatus.textContent = 'Rendering frames...';

  // Render all frames to PNG
  let frameNum = 1;
  const frames = [];
  frames.push(await canvasToUint8(renderRefFrame(w, h, frameNum++)));
  for (const cmp of validCmps) {
    const canvas = renderCmpFrame(cmp, w, h, frameNum++);
    if (canvas) frames.push(await canvasToUint8(canvas));
  }

  // Load ffmpeg
  const ff = await loadFFmpeg();

  // Write frames to virtual FS
  overlayStatus.textContent = 'Writing frames...';
  for (let i = 0; i < frames.length; i++) {
    await ff.writeFile('frame_' + String(i).padStart(3, '0') + '.png', frames[i]);
  }

  // Generate GIF with palette for quality
  overlayStatus.textContent = 'Encoding GIF...';
  await ff.exec([
    '-framerate', String(fps),
    '-i', 'frame_%03d.png',
    '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    '-loop', '0',
    'output.gif',
  ]);

  // Read result and display
  const gifData = await ff.readFile('output.gif');
  const gifBlob = new Blob([gifData], { type: 'image/gif' });
  outputGif.src = URL.createObjectURL(gifBlob);
  outputGif.style.display = 'block';
  overlayCanvas.style.display = 'none';
  overlayStatus.textContent = '';

  // Cleanup virtual FS
  for (let i = 0; i < frames.length; i++) {
    await ff.deleteFile('frame_' + String(i).padStart(3, '0') + '.png');
  }
  await ff.deleteFile('output.gif');
}

// ========== CLEAR ALL ==========

clearAllBtn.addEventListener('click', async () => {
  // Clear reference
  window._refClear();
  // Clear all comparisons
  for (let i = comparisons.length - 1; i >= 0; i--) {
    if (comparisons[i]) {
      comparisons[i].card.remove();
      comparisons[i] = null;
    }
  }
  selectedCmpIndex = -1;
  // Clear output
  outputGif.style.display = 'none';
  outputGif.src = '';
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayStatus.textContent = '';
  // Clear DB
  await dbClear();
  updateClearAllVisibility();
});

// ========== RESTORE ON LOAD ==========

(async function restore() {
  try {
    const keys = await dbAllKeys();
    // Restore reference
    if (keys.includes('ref')) {
      const blob = await dbGet('ref');
      if (blob) window._refLoadBlob(blob);
    }
    // Restore comparisons (sorted by key for consistent order)
    const cmpKeys = keys.filter(k => String(k).startsWith('cmp_')).sort();
    for (const key of cmpKeys) {
      const blob = await dbGet(key);
      if (blob) await addComparison(blob, key);
    }
  } catch (err) {
    console.error('Restore failed:', err);
  }
})();
