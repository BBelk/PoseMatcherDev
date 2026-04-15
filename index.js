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
  const hasCmp = comparisons.length > 0;
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

// ========== OPTIONS PANEL PERSISTENCE ==========

const optionsDetails = document.getElementById('options-details');
if (localStorage.getItem('optionsOpen') === 'true') optionsDetails.open = true;
optionsDetails.addEventListener('toggle', () => {
  localStorage.setItem('optionsOpen', optionsDetails.open);
});

// ========== SETTINGS ==========

const scoreThreshSlider = document.getElementById('score-thresh');
const scoreThreshVal = document.getElementById('score-thresh-val');
const kpThreshSlider = document.getElementById('kp-thresh');
const kpThreshVal = document.getElementById('kp-thresh-val');

// Restore thresholds
const _savedScoreThresh = localStorage.getItem('scoreThresh');
if (_savedScoreThresh) { scoreThreshSlider.value = _savedScoreThresh; POSE_CONFIG.scoreThreshold = parseFloat(_savedScoreThresh); scoreThreshVal.textContent = _savedScoreThresh; }
const _savedKpThresh = localStorage.getItem('kpThresh');
if (_savedKpThresh) { kpThreshSlider.value = _savedKpThresh; POSE_CONFIG.confidenceThreshold = parseFloat(_savedKpThresh); kpThreshVal.textContent = _savedKpThresh; }

scoreThreshSlider.addEventListener('input', () => {
  POSE_CONFIG.scoreThreshold = parseFloat(scoreThreshSlider.value);
  scoreThreshVal.textContent = scoreThreshSlider.value;
  localStorage.setItem('scoreThresh', scoreThreshSlider.value);
});

kpThreshSlider.addEventListener('input', () => {
  POSE_CONFIG.confidenceThreshold = parseFloat(kpThreshSlider.value);
  kpThreshVal.textContent = kpThreshSlider.value;
  localStorage.setItem('kpThresh', kpThreshSlider.value);
});

// ========== POSE STORAGE ==========

const storedPoses = { ref: null, refCustomPoint: { x: 0.5, y: 0.5 } };
let refSelectedPerson = 0;

async function saveRefMeta() {
  try {
    await dbPut('ref_meta', {
      poses: storedPoses.ref,
      customPoint: storedPoses.refCustomPoint,
      selectedPerson: refSelectedPerson,
    });
  } catch (err) { console.error('Save ref meta failed:', err); }
}

async function saveCmpMeta(entry) {
  try {
    await dbPut(entry.dbKey + '_meta', {
      poses: entry.poses,
      customPoint: entry.customPoint,
      selectedPerson: entry.selectedPerson,
    });
  } catch (err) { console.error('Save cmp meta failed:', err); }
}

async function ensureCmpPoses(entry) {
  if (entry.poses) return;
  if (!entry.img || !entry.img.naturalWidth) return;
  try {
    entry.poses = await estimatePoses(entry.img);
    entry.selectedPerson = 0;
    await saveCmpMeta(entry);
  } catch (err) {
    console.error('Comparison pose failed:', err);
  }
}

// ========== TRACKING MODE ==========

const modeSelect = document.getElementById('mode-select');
let currentMode = localStorage.getItem('trackingMode') || 'human';
modeSelect.value = currentMode;

modeSelect.addEventListener('change', async () => {
  currentMode = modeSelect.value;
  localStorage.setItem('trackingMode', currentMode);
  if (currentMode === 'human') {
    if (window._refEnsurePoses) await window._refEnsurePoses();
    for (const entry of comparisons) await ensureCmpPoses(entry);
  }
  drawOverlayForRef();
  for (const entry of comparisons) drawOverlayForCmp(entry);
});

// Draws a full-width "No Human Detected" banner across the top of the canvas
function drawNoHumansBanner(ctx) {
  const text = 'No Human Detected';
  const bh = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, ctx.canvas.width, bh);
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = '#ffd84a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, ctx.canvas.width / 2, bh / 2);
}

// Draws a crosshair circle for the custom point
function drawCustomPoint(ctx, pt, rect) {
  const cx = rect.offsetX + pt.x * rect.width;
  const cy = rect.offsetY + pt.y * rect.height;
  const r = 9;
  // Outer black halo
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 5, cy); ctx.lineTo(cx + r + 5, cy);
  ctx.moveTo(cx, cy - r - 5); ctx.lineTo(cx, cy + r + 5);
  ctx.stroke();
  // Inner cyan
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6cf';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 5, cy); ctx.lineTo(cx + r + 5, cy);
  ctx.moveTo(cx, cy - r - 5); ctx.lineTo(cx, cy + r + 5);
  ctx.stroke();
  // White center dot
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
}

function drawOverlayForRef() {
  const box = document.getElementById('reference-box');
  if (!box.classList.contains('has-image')) return;
  const canvas = document.getElementById('ref-canvas');
  const img = document.getElementById('ref-img');
  canvas.width = box.clientWidth;
  canvas.height = box.clientHeight;
  const rect = getDisplayRect(img.naturalWidth, img.naturalHeight, box);
  const ctx = canvas.getContext('2d');
  if (currentMode === 'custom') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCustomPoint(ctx, storedPoses.refCustomPoint, rect);
  } else if (storedPoses.ref && storedPoses.ref.length) {
    drawPoses(canvas, storedPoses.ref, rect, refSelectedPerson);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentMode === 'human' && storedPoses.ref) {
      drawCustomPoint(ctx, storedPoses.refCustomPoint, rect);
      drawNoHumansBanner(ctx);
    }
  }
}

function drawOverlayForCmp(entry) {
  const canvas = entry.card.querySelector('canvas');
  canvas.width = entry.card.clientWidth;
  canvas.height = entry.card.clientHeight;
  const rect = getDisplayRect(entry.img.naturalWidth, entry.img.naturalHeight, entry.card);
  const ctx = canvas.getContext('2d');
  if (currentMode === 'custom') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCustomPoint(ctx, entry.customPoint, rect);
  } else if (entry.poses && entry.poses.length) {
    drawPoses(canvas, entry.poses, rect, entry.selectedPerson);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentMode === 'human' && entry.poses) {
      drawCustomPoint(ctx, entry.customPoint, rect);
      drawNoHumansBanner(ctx);
    }
  }
}

// ========== PERSON SELECTION MODAL ==========

const personModal = document.getElementById('person-modal');
const modalCanvas = document.getElementById('modal-canvas');
const modalCloseBtn = document.getElementById('modal-close');

let modalCallback = null; // called with selected index

modalCloseBtn.addEventListener('click', closeModal);
personModal.addEventListener('click', (e) => {
  if (e.target === personModal) closeModal();
});

function closeModal() {
  personModal.style.display = 'none';
  modalCallback = null;
  modalCanvas.onclick = null;
}

function openPersonModal(imgEl, poses, currentSelected, onSelect) {
  if (poses.length <= 1) return;

  personModal.querySelector('h3').textContent = 'Select a person';
  personModal.querySelector('.modal-hint').textContent = 'Click a bounding box to select';
  personModal.style.display = '';
  modalCallback = onSelect;

  // Size canvas to image aspect ratio, fitting in viewport
  const maxW = window.innerWidth * 0.85;
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / imgEl.naturalWidth, maxH / imgEl.naturalHeight);
  const cw = Math.round(imgEl.naturalWidth * scale);
  const ch = Math.round(imgEl.naturalHeight * scale);
  modalCanvas.width = cw;
  modalCanvas.height = ch;

  const ctx = modalCanvas.getContext('2d');
  const rect = { offsetX: 0, offsetY: 0, width: cw, height: ch };

  function render(sel) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(imgEl, 0, 0, cw, ch);
    const multi = poses.length > 1;
    for (let i = 0; i < poses.length; i++) {
      drawSinglePose(ctx, poses[i].keypoints, rect, multi ? i : -1, multi && i === sel);
    }
  }

  render(currentSelected);

  const bounds = getPoseBounds(poses, rect);

  modalCanvas.onclick = (e) => {
    const r = modalCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (cw / r.width);
    const my = (e.clientY - r.top) * (ch / r.height);

    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (mx >= b.minX && mx <= b.maxX && my >= b.minY && my <= b.maxY) {
        render(i);
        if (modalCallback) modalCallback(i);
        return;
      }
    }
  };
}

function openCustomPointModal(imgEl, currentPoint, onSelect) {
  personModal.querySelector('h3').textContent = 'Place custom point';
  personModal.querySelector('.modal-hint').textContent = 'Click anywhere to set the point';
  personModal.style.display = '';

  const maxW = window.innerWidth * 0.85;
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / imgEl.naturalWidth, maxH / imgEl.naturalHeight);
  const cw = Math.round(imgEl.naturalWidth * scale);
  const ch = Math.round(imgEl.naturalHeight * scale);
  modalCanvas.width = cw;
  modalCanvas.height = ch;

  const ctx = modalCanvas.getContext('2d');
  const rect = { offsetX: 0, offsetY: 0, width: cw, height: ch };
  let point = { x: currentPoint.x, y: currentPoint.y };

  function render() {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(imgEl, 0, 0, cw, ch);
    drawCustomPoint(ctx, point, rect);
  }
  render();

  modalCanvas.onclick = (e) => {
    const r = modalCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (cw / r.width);
    const my = (e.clientY - r.top) * (ch / r.height);
    point = {
      x: Math.max(0, Math.min(1, mx / cw)),
      y: Math.max(0, Math.min(1, my / ch)),
    };
    render();
    onSelect(point);
  };
}

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
    if (e.target.closest('.upload-label') || e.target === fileInput || e.target === clearBtn) return;
    if (!box.classList.contains('has-image')) {
      fileInput.click();
    } else if (currentMode === 'custom' || (storedPoses.ref && !storedPoses.ref.length)) {
      openCustomPointModal(img, storedPoses.refCustomPoint, (pt) => {
        storedPoses.refCustomPoint = pt;
        drawOverlayForRef();
        saveRefMeta();
      });
    } else if (storedPoses.ref && storedPoses.ref.length > 1) {
      openPersonModal(img, storedPoses.ref, refSelectedPerson, (idx) => {
        refSelectedPerson = idx;
        drawOverlayForRef();
        saveRefMeta();
      });
    }
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
    storedPoses.refCustomPoint = { x: 0.5, y: 0.5 };
    refSelectedPerson = 0;
    dbDelete('ref');
    dbDelete('ref_meta');
    updateClearAllVisibility();
  }

  function loadImage(file) {
    readExifDate(file).then(date => { meta.textContent = date || ''; });
    // Persist blob
    file.arrayBuffer().then(buf => dbPut('ref', new Blob([buf], { type: file.type })));
    // Fresh upload: discard any prior pose state so detection (or custom default) re-runs
    storedPoses.ref = null;
    storedPoses.refCustomPoint = { x: 0.5, y: 0.5 };
    refSelectedPerson = 0;
    loadBlob(file, null);
  }

  function loadBlob(blob, restoredMeta) {
    const url = URL.createObjectURL(blob);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      box.classList.add('has-image');
      canvas.width = box.clientWidth;
      canvas.height = box.clientHeight;
      // Populate output dimensions from reference, capped to max 800px on longest side
      const maxDim = 800;
      let outW = img.naturalWidth;
      let outH = img.naturalHeight;
      if (outW > maxDim || outH > maxDim) {
        const scale = maxDim / Math.max(outW, outH);
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
      }
      document.getElementById('output-width').value = outW;
      document.getElementById('output-height').value = outH;

      if (restoredMeta) {
        storedPoses.ref = restoredMeta.poses || null;
        storedPoses.refCustomPoint = restoredMeta.customPoint || { x: 0.5, y: 0.5 };
        refSelectedPerson = restoredMeta.selectedPerson || 0;
      }

      updateClearAllVisibility();

      if (!storedPoses.ref && currentMode === 'human') {
        await runDetection();
      } else {
        drawOverlayForRef();
        // Persist (ensures custom point + default selection are saved on fresh uploads)
        if (!restoredMeta) await saveRefMeta();
      }
    };
    img.src = url;
  }

  // Expose for restore, clear all, and lazy pose detection on mode switch
  window._refClear = clearRef;
  window._refLoadBlob = loadBlob;
  window._refEnsurePoses = async () => {
    if (storedPoses.ref) return;
    if (!img.naturalWidth) return;
    await runDetection();
  };

  async function runDetection() {
    status.textContent = 'Detecting pose...';
    try {
      const poses = await estimatePoses(img);
      storedPoses.ref = poses;
      refSelectedPerson = 0; // default to leftmost
      drawOverlayForRef();
      await saveRefMeta();
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
    drawOverlayForRef();
  });
})();

// ========== COMPARISONS (multi-image) ==========

const compareGrid = document.getElementById('compare-grid');
const cmpFileInput = document.getElementById('cmp-file');
const comparisons = []; // { img, poses, date, card }
let selectedCmpIndex = -1;

const compareSection = document.getElementById('compare-section');

async function addMultipleComparisons(files) {
  for (const file of files) await addComparison(file);
}

cmpFileInput.addEventListener('change', (e) => {
  addMultipleComparisons(Array.from(e.target.files));
  cmpFileInput.value = '';
});

compareSection.addEventListener('dragover', (e) => {
  if (draggedEntry) return; // internal card reorder, not file drop
  e.preventDefault();
  compareSection.classList.add('dragover');
});

compareSection.addEventListener('dragleave', () => {
  compareSection.classList.remove('dragover');
});

compareSection.addEventListener('drop', (e) => {
  if (draggedEntry) return; // ignore internal card drops
  e.preventDefault();
  compareSection.classList.remove('dragover');
  addMultipleComparisons(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
});

let cmpIdCounter = 0;
let draggedEntry = null;
let dropTargetEntry = null;
let dropInsertAfter = false;

const dropIndicator = document.createElement('div');
dropIndicator.className = 'drop-indicator';

// Grid-level handlers so drops over the indicator (or empty grid space) still work
compareGrid.addEventListener('dragover', (e) => {
  if (!draggedEntry) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

compareGrid.addEventListener('drop', (e) => {
  if (!draggedEntry) return;
  e.preventDefault();
  // Capture state before clearDropIndicators nulls it out
  const target = dropTargetEntry;
  const after = dropInsertAfter;
  clearDropIndicators();
  if (target && target !== draggedEntry) {
    reorderComparison(draggedEntry, target, after);
  }
});

function showDropIndicator(targetCard, insertAfter) {
  const refNode = insertAfter ? targetCard.nextSibling : targetCard;
  if (dropIndicator.parentNode === compareGrid && dropIndicator.nextSibling === refNode) return;
  compareGrid.insertBefore(dropIndicator, refNode);
}

function clearDropIndicators() {
  if (dropIndicator.parentNode) dropIndicator.parentNode.removeChild(dropIndicator);
  dropTargetEntry = null;
}

async function addComparison(fileOrBlob, dbKey, restoredMeta) {
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

  const entry = { img, poses: null, date, card, dbKey: key, selectedPerson: 0, customPoint: { x: 0.5, y: 0.5 } };
  if (restoredMeta) {
    entry.poses = restoredMeta.poses || null;
    entry.selectedPerson = restoredMeta.selectedPerson || 0;
    entry.customPoint = restoredMeta.customPoint || { x: 0.5, y: 0.5 };
  }
  comparisons.push(entry);

  card.addEventListener('click', (e) => {
    if (e.target === clearBtn) return;
    const idx = comparisons.indexOf(entry);
    if (idx < 0) return;
    selectComparison(idx);
    if (currentMode === 'custom' || (entry.poses && !entry.poses.length)) {
      openCustomPointModal(img, entry.customPoint, (pt) => {
        entry.customPoint = pt;
        drawOverlayForCmp(entry);
        saveCmpMeta(entry);
      });
    } else if (entry.poses && entry.poses.length > 1) {
      // Open person modal if multiple people
      openPersonModal(img, entry.poses, entry.selectedPerson, (sel) => {
        entry.selectedPerson = sel;
        drawOverlayForCmp(entry);
        saveCmpMeta(entry);
      });
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = comparisons.indexOf(entry);
    if (idx >= 0) removeComparison(idx);
  });

  // --- Drag-to-reorder ---
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    if (e.target === clearBtn) { e.preventDefault(); return; }
    draggedEntry = entry;
    dropTargetEntry = null;
    dropInsertAfter = false;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set
    e.dataTransfer.setData('text/plain', '');
    // Explicit drag ghost using the card, captured before .dragging opacity is applied
    e.dataTransfer.setDragImage(card, card.clientWidth / 2, card.clientHeight / 2);
    // Apply dragging class on next tick so it doesn't affect the drag image snapshot
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedEntry = null;
    dropTargetEntry = null;
    clearDropIndicators();
  });
  card.addEventListener('dragover', (e) => {
    if (!draggedEntry || draggedEntry === entry) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const insertAfter = e.clientX > rect.left + rect.width / 2;
    dropTargetEntry = entry;
    dropInsertAfter = insertAfter;
    showDropIndicator(card, insertAfter);
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    if (!draggedEntry || draggedEntry === entry) return;
    reorderComparison(draggedEntry, entry, dropInsertAfter);
  });

  // Wait for image to actually load before continuing
  await new Promise((resolve) => {
    img.onload = async () => {
      canvas.width = card.clientWidth;
      canvas.height = card.clientHeight;
      if (!entry.poses && currentMode === 'human') {
        try {
          const poses = await estimatePoses(img);
          entry.poses = poses;
          entry.selectedPerson = 0;
          await saveCmpMeta(entry);
        } catch (err) {
          console.error('Comparison pose failed:', err);
        }
      } else if (!restoredMeta) {
        // Fresh upload in custom mode — persist default custom point
        await saveCmpMeta(entry);
      }
      drawOverlayForCmp(entry);
      updateClearAllVisibility();
      resolve();
    };
    img.onerror = resolve;
    img.src = URL.createObjectURL(fileOrBlob);
  });

  if (comparisons.length === 1) selectComparison(0);
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
  const wasSelected = (selectedCmpIndex === index);
  entry.card.remove();
  dbDelete(entry.dbKey);
  dbDelete(entry.dbKey + '_meta');
  comparisons.splice(index, 1);
  updateClearAllVisibility();
  if (wasSelected) {
    selectedCmpIndex = -1;
    if (comparisons.length > 0) {
      selectComparison(Math.min(index, comparisons.length - 1));
    }
  } else if (selectedCmpIndex > index) {
    selectedCmpIndex--;
    selectComparison(selectedCmpIndex);
  }
}

function reorderComparison(srcEntry, targetEntry, insertAfter) {
  const srcIdx = comparisons.indexOf(srcEntry);
  let targetIdx = comparisons.indexOf(targetEntry);
  if (srcIdx < 0 || targetIdx < 0 || srcEntry === targetEntry) return;

  // Track selected entry so we can restore its index after reorder
  const selEntry = (selectedCmpIndex >= 0) ? comparisons[selectedCmpIndex] : null;

  // Remove src from array, then reinsert relative to target
  comparisons.splice(srcIdx, 1);
  targetIdx = comparisons.indexOf(targetEntry);
  const insertIdx = insertAfter ? targetIdx + 1 : targetIdx;
  comparisons.splice(insertIdx, 0, srcEntry);

  // Sync DOM: insertBefore target (or target.nextSibling for after)
  const refNode = insertAfter ? targetEntry.card.nextSibling : targetEntry.card;
  compareGrid.insertBefore(srcEntry.card, refNode);

  // Restore selection by entry
  if (selEntry) {
    const newSelIdx = comparisons.indexOf(selEntry);
    selectedCmpIndex = -1;
    if (newSelIdx >= 0) selectComparison(newSelIdx);
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
const outputVideo = document.getElementById('output-video');
const outputFormatSelect = document.getElementById('output-format');
const saveBtn = document.getElementById('save-btn');
const _savedOutputFormat = localStorage.getItem('outputFormat');
if (_savedOutputFormat) outputFormatSelect.value = _savedOutputFormat;
outputFormatSelect.addEventListener('change', () => localStorage.setItem('outputFormat', outputFormatSelect.value));
let lastOutputBlob = null;
let lastOutputFormat = 'gif';
const refImg = document.getElementById('ref-img');
const errorBanner = document.getElementById('error-banner');

errorBanner.addEventListener('click', () => {
  errorBanner.style.display = 'none';
});

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'block';
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.style.display = 'none';
}
// Restore output toggles
const includeRefToggle = document.getElementById('include-ref-toggle');
const loopToggle = document.getElementById('loop-toggle');
const frameCounterToggle = document.getElementById('frame-counter-toggle');
if (localStorage.getItem('includeRef') !== null) includeRefToggle.checked = localStorage.getItem('includeRef') === 'true';
if (localStorage.getItem('loop') !== null) loopToggle.checked = localStorage.getItem('loop') === 'true';
if (localStorage.getItem('frameCounter') === 'true') frameCounterToggle.checked = true;
includeRefToggle.addEventListener('change', () => localStorage.setItem('includeRef', includeRefToggle.checked));
loopToggle.addEventListener('change', () => localStorage.setItem('loop', loopToggle.checked));
frameCounterToggle.addEventListener('change', () => localStorage.setItem('frameCounter', frameCounterToggle.checked));

const frameDurationInput = document.getElementById('frame-duration');
const customDurationsPanel = document.getElementById('custom-durations');
const singleDurationRow = document.getElementById('single-duration-row');
const firstFrameDuration = document.getElementById('first-frame-duration');
const middleFrameDuration = document.getElementById('middle-frame-duration');
const lastFrameDuration = document.getElementById('last-frame-duration');
let customDurationsActive = false;

// Restore frame durations
const _savedFrameDur = localStorage.getItem('frameDuration');
if (_savedFrameDur) { frameDurationInput.value = _savedFrameDur; firstFrameDuration.value = _savedFrameDur; middleFrameDuration.value = _savedFrameDur; lastFrameDuration.value = _savedFrameDur; }
const _savedFirstDur = localStorage.getItem('firstFrameDuration');
const _savedMiddleDur = localStorage.getItem('middleFrameDuration');
const _savedLastDur = localStorage.getItem('lastFrameDuration');
if (localStorage.getItem('customDurationsActive') === 'true') {
  customDurationsActive = true;
  singleDurationRow.style.display = 'none';
  customDurationsPanel.style.display = '';
  if (_savedFirstDur) firstFrameDuration.value = _savedFirstDur;
  if (_savedMiddleDur) middleFrameDuration.value = _savedMiddleDur;
  if (_savedLastDur) lastFrameDuration.value = _savedLastDur;
}

// Sync default duration into custom fields when changed
frameDurationInput.addEventListener('input', () => {
  firstFrameDuration.value = frameDurationInput.value;
  middleFrameDuration.value = frameDurationInput.value;
  lastFrameDuration.value = frameDurationInput.value;
  localStorage.setItem('frameDuration', frameDurationInput.value);
});
firstFrameDuration.addEventListener('change', () => localStorage.setItem('firstFrameDuration', firstFrameDuration.value));
middleFrameDuration.addEventListener('change', () => localStorage.setItem('middleFrameDuration', middleFrameDuration.value));
lastFrameDuration.addEventListener('change', () => localStorage.setItem('lastFrameDuration', lastFrameDuration.value));

// "customize" link opens per-frame controls
document.getElementById('custom-durations-toggle').addEventListener('click', () => {
  customDurationsActive = true;
  localStorage.setItem('customDurationsActive', 'true');
  singleDurationRow.style.display = 'none';
  customDurationsPanel.style.display = '';
});

// "use single" link goes back
document.getElementById('custom-durations-back').addEventListener('click', () => {
  customDurationsActive = false;
  localStorage.setItem('customDurationsActive', 'false');
  customDurationsPanel.style.display = 'none';
  singleDurationRow.style.display = '';
  firstFrameDuration.value = frameDurationInput.value;
  middleFrameDuration.value = frameDurationInput.value;
  lastFrameDuration.value = frameDurationInput.value;
});

// --- Transitions ---
const transitionToggle = document.getElementById('transition-toggle');
const transitionTypeSelect = document.getElementById('transition-type');
const transitionDurationInput = document.getElementById('transition-duration');
const transitionDurationRow = document.getElementById('transition-duration-row');

// Restore from localStorage
if (localStorage.getItem('transitionEnabled') === 'true') transitionToggle.checked = true;
const _savedTransType = localStorage.getItem('transitionType');
if (_savedTransType) transitionTypeSelect.value = _savedTransType;
const _savedTransDur = localStorage.getItem('transitionDuration');
if (_savedTransDur) transitionDurationInput.value = _savedTransDur;

function updateTransitionRowVisibility() {
  transitionDurationRow.style.display = transitionToggle.checked ? '' : 'none';
}
updateTransitionRowVisibility();

transitionToggle.addEventListener('change', () => {
  localStorage.setItem('transitionEnabled', transitionToggle.checked);
  updateTransitionRowVisibility();
});
transitionTypeSelect.addEventListener('change', () => {
  localStorage.setItem('transitionType', transitionTypeSelect.value);
});
transitionDurationInput.addEventListener('change', () => {
  localStorage.setItem('transitionDuration', transitionDurationInput.value);
});

const alignPartSelect = document.getElementById('align-part');
const scaleToggle = document.getElementById('scale-toggle');
const scalePairSelect = document.getElementById('scale-pair');
const rotateToggle = document.getElementById('rotate-toggle');
const rotatePairSelect = document.getElementById('rotate-pair');

// Restore alignment settings
const _savedAlignPart = localStorage.getItem('alignPart');
if (_savedAlignPart) alignPartSelect.value = _savedAlignPart;
if (localStorage.getItem('scaleEnabled') !== null) scaleToggle.checked = localStorage.getItem('scaleEnabled') === 'true';
const _savedScalePair = localStorage.getItem('scalePair');
if (_savedScalePair) scalePairSelect.value = _savedScalePair;
if (localStorage.getItem('rotateEnabled') !== null) rotateToggle.checked = localStorage.getItem('rotateEnabled') === 'true';
const _savedRotatePair = localStorage.getItem('rotatePair');
if (_savedRotatePair) rotatePairSelect.value = _savedRotatePair;

alignPartSelect.addEventListener('change', () => localStorage.setItem('alignPart', alignPartSelect.value));
scaleToggle.addEventListener('change', () => localStorage.setItem('scaleEnabled', scaleToggle.checked));
scalePairSelect.addEventListener('change', () => localStorage.setItem('scalePair', scalePairSelect.value));
rotateToggle.addEventListener('change', () => localStorage.setItem('rotateEnabled', rotateToggle.checked));
rotatePairSelect.addEventListener('change', () => localStorage.setItem('rotatePair', rotatePairSelect.value));

const PAIR_INDICES = {
  shoulders: [5, 6],
  hips: [11, 12],
  eyes: [1, 2],
};

// --- Alignment helper ---

function computeAlignTransform(refKps, cmpKps, refImgEl, cmpImgEl, w, h, refCustomPt, cmpCustomPt) {
  const thresh = POSE_CONFIG.confidenceThreshold;
  const container = { clientWidth: w, clientHeight: h };
  const refRect = getDisplayRect(refImgEl.naturalWidth, refImgEl.naturalHeight, container);
  const cmpRect = getDisplayRect(cmpImgEl.naturalWidth, cmpImgEl.naturalHeight, container);

  function toCanvas(kp, rect) {
    return { x: rect.offsetX + kp.x * rect.width, y: rect.offsetY + kp.y * rect.height };
  }

  // Custom point mode: translation-only alignment using the placed points
  if (currentMode === 'custom') {
    return {
      refCx: refRect.offsetX + refCustomPt.x * refRect.width,
      refCy: refRect.offsetY + refCustomPt.y * refRect.height,
      cmpCx: cmpRect.offsetX + cmpCustomPt.x * cmpRect.width,
      cmpCy: cmpRect.offsetY + cmpCustomPt.y * cmpRect.height,
      scale: 1, rotation: 0, refRect, cmpRect,
    };
  }

  // Position anchor — fall back to each image's custom point if the keypoint is missing
  const anchorIdx = parseInt(alignPartSelect.value);
  const refHasAnchor = refKps && refKps[anchorIdx] && refKps[anchorIdx].confidence >= thresh;
  const cmpHasAnchor = cmpKps && cmpKps[anchorIdx] && cmpKps[anchorIdx].confidence >= thresh;

  const refAnchor = refHasAnchor ? toCanvas(refKps[anchorIdx], refRect)
    : { x: refRect.offsetX + refCustomPt.x * refRect.width, y: refRect.offsetY + refCustomPt.y * refRect.height };
  const cmpAnchor = cmpHasAnchor ? toCanvas(cmpKps[anchorIdx], cmpRect)
    : { x: cmpRect.offsetX + cmpCustomPt.x * cmpRect.width, y: cmpRect.offsetY + cmpCustomPt.y * cmpRect.height };

  // Scale/rotation only work when BOTH images have the relevant keypoint pair
  let scale = 1;
  if (scaleToggle.checked && refKps && cmpKps) {
    const [i1, i2] = PAIR_INDICES[scalePairSelect.value];
    const refOk = refKps[i1].confidence >= thresh && refKps[i2].confidence >= thresh;
    const cmpOk = cmpKps[i1].confidence >= thresh && cmpKps[i2].confidence >= thresh;
    if (refOk && cmpOk) {
      const refA = toCanvas(refKps[i1], refRect), refB = toCanvas(refKps[i2], refRect);
      const cmpA = toCanvas(cmpKps[i1], cmpRect), cmpB = toCanvas(cmpKps[i2], cmpRect);
      const refDist = Math.hypot(refB.x - refA.x, refB.y - refA.y);
      const cmpDist = Math.hypot(cmpB.x - cmpA.x, cmpB.y - cmpA.y);
      if (cmpDist > 0) scale = refDist / cmpDist;
    }
  }

  let rotation = 0;
  if (rotateToggle.checked && refKps && cmpKps) {
    const [i1, i2] = PAIR_INDICES[rotatePairSelect.value];
    const refOk = refKps[i1].confidence >= thresh && refKps[i2].confidence >= thresh;
    const cmpOk = cmpKps[i1].confidence >= thresh && cmpKps[i2].confidence >= thresh;
    if (refOk && cmpOk) {
      const refA = toCanvas(refKps[i1], refRect), refB = toCanvas(refKps[i2], refRect);
      const cmpA = toCanvas(cmpKps[i1], cmpRect), cmpB = toCanvas(cmpKps[i2], cmpRect);
      const refAngle = Math.atan2(refB.y - refA.y, refB.x - refA.x);
      const cmpAngle = Math.atan2(cmpB.y - cmpA.y, cmpB.x - cmpA.x);
      rotation = refAngle - cmpAngle;
    }
  }

  return {
    refCx: refAnchor.x, refCy: refAnchor.y,
    cmpCx: cmpAnchor.x, cmpCy: cmpAnchor.y,
    scale, rotation, refRect, cmpRect,
  };
}

// --- Frame rendering ---

function drawFrameCounter(ctx, num, w) {
  if (!frameCounterToggle.checked) return;
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
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
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
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  const refKps = storedPoses.ref && storedPoses.ref[refSelectedPerson] ? storedPoses.ref[refSelectedPerson].keypoints : null;
  const cmpKps = cmp.poses && cmp.poses[cmp.selectedPerson] ? cmp.poses[cmp.selectedPerson].keypoints : null;
  const t = computeAlignTransform(
    refKps, cmpKps,
    refImg, cmp.img, w, h,
    storedPoses.refCustomPoint, cmp.customPoint
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

  showProgress('Loading FFmpeg...');
  ffmpeg = new FFmpegWASM.FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    if (progress > 0) showProgress('Encoding: ' + Math.round(progress * 100) + '%');
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

// Alpha-blend two canvases into a new canvas: result = A*(1-alpha) + B*alpha
function blendFrames(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvasA, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(canvasB, 0, 0);
  ctx.globalAlpha = 1;
  return c;
}

// --- Generate GIF ---

generateBtn.addEventListener('click', generate);

function showProgress(msg) {
  const ph = outputBox.querySelector('.placeholder');
  if (ph) {
    ph.textContent = msg;
    ph.style.display = '';
  }
}

function resetOutput() {
  outputGif.style.display = 'none';
  outputGif.src = '';
  outputVideo.style.display = 'none';
  outputVideo.src = '';
  overlayCanvas.style.display = 'none';
  outputBox.classList.add('empty');
  showProgress('Preparing...');
  lastOutputBlob = null;
  saveBtn.style.display = 'none';
}

async function generate() {
  clearError();
  resetOutput();

  if (!refImg.naturalWidth) { showError('Upload a reference image'); return; }

  // Any comparison with a loaded image is valid — missing poses fall back to the custom point
  const validCmps = comparisons.filter(c => c && c.img && c.img.naturalWidth);
  if (!validCmps.length) { showError('Add comparison images'); return; }

  const w = parseInt(document.getElementById('output-width').value) || refImg.naturalWidth || outputBox.clientWidth;
  const h = parseInt(document.getElementById('output-height').value) || refImg.naturalHeight || outputBox.clientHeight;
  const includeRef = includeRefToggle.checked;
  const loopGif = loopToggle.checked;

  // Determine per-frame durations
  const defaultDur = parseFloat(frameDurationInput.value) || 0.5;
  let durFirst, durMiddle, durLast;
  if (customDurationsActive) {
    durFirst = parseFloat(firstFrameDuration.value) || defaultDur;
    durMiddle = parseFloat(middleFrameDuration.value) || defaultDur;
    durLast = parseFloat(lastFrameDuration.value) || defaultDur;
  } else {
    durFirst = durMiddle = durLast = defaultDur;
  }

  showProgress('Rendering frames...');

  // Render main frames (one per included source) as canvases
  let frameNum = 1;
  const mainCanvases = [];
  if (includeRef) mainCanvases.push(renderRefFrame(w, h, frameNum++));
  for (const cmp of validCmps) {
    const c = renderCmpFrame(cmp, w, h, frameNum++);
    if (c) mainCanvases.push(c);
  }

  if (!mainCanvases.length) { showError('No frames to encode'); return; }

  // Build full frame list with per-frame durations, inserting transition blends if enabled
  const useTransitions = transitionToggle.checked && mainCanvases.length > 1;
  const tType = transitionTypeSelect.value;
  let tDur = parseFloat(transitionDurationInput.value) || 0;
  // Cap transition at the shortest frame duration so it never exceeds a hold
  const minFrameDur = Math.min(durFirst, durMiddle, durLast);
  if (tDur > minFrameDur) tDur = minFrameDur;

  const transitionFps = 20;
  const transitionSteps = Math.max(2, Math.round(tDur * transitionFps));
  const stepDur = tDur > 0 ? tDur / transitionSteps : 0;

  const frameCanvases = [];
  const frameDurs = [];

  for (let i = 0; i < mainCanvases.length; i++) {
    const isLast = i === mainCanvases.length - 1;
    const rawDur = i === 0 ? durFirst : isLast ? durLast : durMiddle;
    // Eat transition time from outgoing frame's hold (last frame keeps full dur)
    const holdDur = (useTransitions && tDur > 0 && !isLast) ? Math.max(0.01, rawDur - tDur) : rawDur;

    frameCanvases.push(mainCanvases[i]);
    frameDurs.push(holdDur);

    if (useTransitions && tDur > 0 && !isLast) {
      const next = mainCanvases[i + 1];
      for (let k = 1; k < transitionSteps; k++) {
        const alpha = k / transitionSteps;
        frameCanvases.push(blendFrames(mainCanvases[i], next, alpha, w, h));
        frameDurs.push(stepDur);
      }
    }
  }

  // Loop-back transition: fade from last frame back to first, ending on first frame
  const format = outputFormatSelect.value;
  if (loopGif && useTransitions && tDur > 0 && mainCanvases.length > 1) {
    // Eat transition time from last frame's hold
    frameDurs[frameDurs.length - 1] = Math.max(0.01, frameDurs[frameDurs.length - 1] - tDur);
    const last = mainCanvases[mainCanvases.length - 1];
    const first = mainCanvases[0];
    for (let k = 1; k < transitionSteps; k++) {
      const alpha = k / transitionSteps;
      frameCanvases.push(blendFrames(last, first, alpha, w, h));
      frameDurs.push(stepDur);
    }
    // Land on the first frame
    frameCanvases.push(first);
    frameDurs.push(0.01);
  }

  // Encode all frame canvases to PNG
  const frames = [];
  for (const c of frameCanvases) frames.push(await canvasToUint8(c));

  // Load ffmpeg
  const ff = await loadFFmpeg();

  // Write frames to virtual FS
  showProgress('Writing frames...');
  for (let i = 0; i < frames.length; i++) {
    await ff.writeFile('frame_' + String(i).padStart(3, '0') + '.png', frames[i]);
  }

  // Build concat demuxer file with per-frame durations
  const lastIdx = frames.length - 1;
  let concatList = '';
  for (let i = 0; i < frames.length; i++) {
    concatList += "file 'frame_" + String(i).padStart(3, '0') + ".png'\n";
    concatList += 'duration ' + frameDurs[i] + '\n';
  }
  // Concat demuxer needs the last file repeated without duration to avoid truncation
  concatList += "file 'frame_" + String(lastIdx).padStart(3, '0') + ".png'\n";
  await ff.writeFile('frames.txt', new TextEncoder().encode(concatList));

  if (format === 'mp4') {
    // Encode MP4 with H.264
    showProgress('Encoding MP4...');
    // Ensure even dimensions (required by libx264)
    const vf = (w % 2 || h % 2)
      ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
      : null;
    const args = ['-f', 'concat', '-safe', '0', '-i', 'frames.txt'];
    if (vf) args.push('-vf', vf);
    args.push(
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
      '-movflags', '+faststart',
      'output.mp4',
    );
    await ff.exec(args);

    const mp4Data = await ff.readFile('output.mp4');
    const mp4Blob = new Blob([mp4Data], { type: 'video/mp4' });
    lastOutputBlob = mp4Blob;
    lastOutputFormat = 'mp4';
    outputVideo.src = URL.createObjectURL(mp4Blob);
    outputVideo.loop = loopGif;
    outputVideo.style.display = 'block';
    outputVideo.play();
    outputGif.style.display = 'none';
  } else {
    // Generate GIF with palette for quality
    showProgress('Encoding GIF...');
    await ff.exec([
      '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
      '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-loop', loopGif ? '0' : '-1',
      'output.gif',
    ]);

    const gifData = await ff.readFile('output.gif');
    const gifBlob = new Blob([gifData], { type: 'image/gif' });
    lastOutputBlob = gifBlob;
    lastOutputFormat = 'gif';
    outputGif.src = URL.createObjectURL(gifBlob);
    outputGif.style.display = 'block';
    outputVideo.style.display = 'none';
  }

  overlayCanvas.style.display = 'none';
  clearError();
  saveBtn.style.display = '';
  // Expand output box and hide placeholder
  outputBox.classList.remove('empty');
  const ph = outputBox.querySelector('.placeholder');
  if (ph) ph.style.display = 'none';

  // Cleanup virtual FS
  for (let i = 0; i < frames.length; i++) {
    await ff.deleteFile('frame_' + String(i).padStart(3, '0') + '.png');
  }
  await ff.deleteFile('frames.txt');
  try { await ff.deleteFile('output.gif'); } catch (_) {}
  try { await ff.deleteFile('output.mp4'); } catch (_) {}
}

saveBtn.addEventListener('click', () => {
  if (!lastOutputBlob) return;
  const ext = lastOutputFormat === 'mp4' ? 'mp4' : 'gif';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(lastOutputBlob);
  a.download = 'posematcher.' + ext;
  a.click();
});

// ========== CLEAR ALL ==========

clearAllBtn.addEventListener('click', async () => {
  // Clear reference
  window._refClear();
  // Clear all comparisons
  for (const c of comparisons) c.card.remove();
  comparisons.length = 0;
  selectedCmpIndex = -1;
  // Clear output
  lastOutputBlob = null;
  saveBtn.style.display = 'none';
  outputGif.style.display = 'none';
  outputGif.src = '';
  outputVideo.style.display = 'none';
  outputVideo.src = '';
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  clearError();
  outputBox.classList.add('empty');
  const ph2 = outputBox.querySelector('.placeholder');
  if (ph2) ph2.style.display = '';
  // Clear DB
  await dbClear();
  updateClearAllVisibility();
});

// ========== RESTORE ON LOAD ==========

(async function restore() {
  try {
    const keys = await dbAllKeys();
    const keySet = new Set(keys.map(String));
    // Restore reference
    if (keySet.has('ref')) {
      const blob = await dbGet('ref');
      const refMeta = keySet.has('ref_meta') ? await dbGet('ref_meta') : null;
      if (blob) window._refLoadBlob(blob, refMeta);
    }
    // Restore comparisons (sorted by key for consistent order, excluding _meta entries)
    const cmpKeys = keys.filter(k => {
      const s = String(k);
      return s.startsWith('cmp_') && !s.endsWith('_meta');
    }).sort();
    for (const key of cmpKeys) {
      const blob = await dbGet(key);
      const meta = keySet.has(key + '_meta') ? await dbGet(key + '_meta') : null;
      if (blob) await addComparison(blob, key, meta);
    }
  } catch (err) {
    console.error('Restore failed:', err);
  }
})();
