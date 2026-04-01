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
    img.src = '';
    box.classList.remove('has-image');
    fileInput.value = '';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    status.textContent = '';
    meta.textContent = '';
    storedPoses.ref = null;
  });

  function loadImage(file) {
    readExifDate(file).then(date => { meta.textContent = date || ''; });
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      box.classList.add('has-image');
      canvas.width = box.clientWidth;
      canvas.height = box.clientHeight;
      await runDetection();
    };
    img.src = url;
  }

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

cmpFileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) addComparison(file);
  cmpFileInput.value = '';
});

async function addComparison(file) {
  const date = await readExifDate(file);
  const url = URL.createObjectURL(file);

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
  const entry = { img, poses: null, date, card };
  comparisons.push(entry);

  // Select on click
  card.addEventListener('click', (e) => {
    if (e.target === clearBtn) return;
    selectComparison(index);
  });

  // Remove
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeComparison(index);
  });

  img.onload = async () => {
    URL.revokeObjectURL(url);
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
  };
  img.src = url;

  // Auto-select first
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
  entry.card.remove();
  comparisons[index] = null;
  if (selectedCmpIndex === index) {
    // Select next available
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

// ========== OUTPUT (overlay) ==========

const overlayBtn = document.getElementById('overlay-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const outputBox = document.getElementById('output-box');
const refImg = document.getElementById('ref-img');

const ALIGN_POINTS = {
  head:      [1, 2],
  shoulders: [5, 6],
  hips:      [11, 12],
};

const refAlphaSlider = document.getElementById('ref-alpha');
const refAlphaVal = document.getElementById('ref-alpha-val');
const cmpAlphaSlider = document.getElementById('cmp-alpha');
const cmpAlphaVal = document.getElementById('cmp-alpha-val');

refAlphaSlider.addEventListener('input', () => {
  refAlphaVal.textContent = refAlphaSlider.value;
  renderOverlay();
});

cmpAlphaSlider.addEventListener('input', () => {
  cmpAlphaVal.textContent = cmpAlphaSlider.value;
  renderOverlay();
});

let overlayReady = false;

overlayBtn.addEventListener('click', () => {
  overlayReady = true;
  renderOverlay();
});

const ALIGN_LABELS = { head: 'eyes', shoulders: 'shoulders', hips: 'hips' };
const overlayStatus = document.getElementById('overlay-status');

function renderOverlay() {
  overlayStatus.textContent = '';
  if (!overlayReady) return;

  const cmp = getSelectedComparison();
  if (!refImg.naturalWidth) return;
  if (!cmp || !cmp.img.naturalWidth) { overlayStatus.textContent = 'Select a comparison image'; return; }
  if (!storedPoses.ref || !storedPoses.ref.length) { overlayStatus.textContent = 'No pose in reference'; return; }
  if (!cmp.poses || !cmp.poses.length) { overlayStatus.textContent = 'No pose in comparison'; return; }

  const mode = document.querySelector('input[name="align"]:checked').value;
  const [i1, i2] = ALIGN_POINTS[mode];
  const label = ALIGN_LABELS[mode];
  const thresh = POSE_CONFIG.confidenceThreshold;

  const refKps = storedPoses.ref[0].keypoints;
  const cmpKps = cmp.poses[0].keypoints;

  const refOk = refKps[i1].confidence >= thresh && refKps[i2].confidence >= thresh;
  const cmpOk = cmpKps[i1].confidence >= thresh && cmpKps[i2].confidence >= thresh;

  if (!refOk || !cmpOk) {
    const which = !refOk && !cmpOk ? 'both images' : !refOk ? 'reference' : 'comparison';
    overlayStatus.textContent = 'No ' + label + ' detected in ' + which;
    return;
  }

  const w = outputBox.clientWidth;
  const h = outputBox.clientHeight;
  overlayCanvas.width = w;
  overlayCanvas.height = h;

  const refRect = getDisplayRect(refImg.naturalWidth, refImg.naturalHeight, outputBox);
  const cmpRect = getDisplayRect(cmp.img.naturalWidth, cmp.img.naturalHeight, outputBox);

  function toCanvas(kp, rect) {
    return { x: rect.offsetX + kp.x * rect.width, y: rect.offsetY + kp.y * rect.height };
  }

  const refA = toCanvas(refKps[i1], refRect);
  const refB = toCanvas(refKps[i2], refRect);
  const refCx = (refA.x + refB.x) / 2;
  const refCy = (refA.y + refB.y) / 2;
  const refDist = Math.hypot(refB.x - refA.x, refB.y - refA.y);
  const refAngle = Math.atan2(refB.y - refA.y, refB.x - refA.x);

  const cmpA = toCanvas(cmpKps[i1], cmpRect);
  const cmpB = toCanvas(cmpKps[i2], cmpRect);
  const cmpCx = (cmpA.x + cmpB.x) / 2;
  const cmpCy = (cmpA.y + cmpB.y) / 2;
  const cmpDist = Math.hypot(cmpB.x - cmpA.x, cmpB.y - cmpA.y);
  const cmpAngle = Math.atan2(cmpB.y - cmpA.y, cmpB.x - cmpA.x);

  const scale = refDist / cmpDist;
  const rotation = document.getElementById('rotate-toggle').checked ? refAngle - cmpAngle : 0;

  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  ctx.globalAlpha = parseFloat(refAlphaSlider.value);
  ctx.drawImage(refImg, refRect.offsetX, refRect.offsetY, refRect.width, refRect.height);

  ctx.globalAlpha = parseFloat(cmpAlphaSlider.value);
  ctx.save();
  ctx.translate(refCx, refCy);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.translate(-cmpCx, -cmpCy);
  ctx.drawImage(cmp.img, cmpRect.offsetX, cmpRect.offsetY, cmpRect.width, cmpRect.height);
  ctx.restore();

  ctx.globalAlpha = 1.0;
}
