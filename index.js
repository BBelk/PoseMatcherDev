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

const storedPoses = { ref: null, cmp: null };

// ========== GENERIC IMAGE BOX SETUP ==========

function setupImageBox(boxId, imgId, fileId, canvasId, statusId, poseKey) {
  const box = document.getElementById(boxId);
  const img = document.getElementById(imgId);
  const fileInput = document.getElementById(fileId);
  const canvas = document.getElementById(canvasId);
  const status = document.getElementById(statusId);
  const clearBtn = box.querySelector('.clear-btn');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImage(file);
  });

  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('dragover');
  });

  box.addEventListener('dragleave', () => {
    box.classList.remove('dragover');
  });

  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  box.addEventListener('click', (e) => {
    if (e.target.closest('.upload-label') || e.target === fileInput) return;
    if (!box.classList.contains('has-image') && e.target !== clearBtn) {
      fileInput.click();
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    img.src = '';
    box.classList.remove('has-image');
    fileInput.value = '';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    status.textContent = '';
    storedPoses[poseKey] = null;
  });

  function loadImage(file) {
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
      storedPoses[poseKey] = poses;
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
}

// ========== OVERLAY ==========

const overlayBtn = document.getElementById('overlay-btn');
const overlayCanvas = document.getElementById('overlay-canvas');
const overlayBox = document.getElementById('overlay-box');
const refImg = document.getElementById('ref-img');
const cmpImg = document.getElementById('cmp-img');

// Anchor keypoint indices per alignment mode
const ALIGN_POINTS = {
  head:      [1, 2],   // left_eye, right_eye
  shoulders: [5, 6],   // left_shoulder, right_shoulder
  hips:      [11, 12], // left_hip, right_hip
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
  if (!refImg.naturalWidth || !cmpImg.naturalWidth) return;
  if (!storedPoses.ref || !storedPoses.ref.length) return;
  if (!storedPoses.cmp || !storedPoses.cmp.length) return;

  const mode = document.querySelector('input[name="align"]:checked').value;
  const [i1, i2] = ALIGN_POINTS[mode];
  const label = ALIGN_LABELS[mode];
  const thresh = POSE_CONFIG.confidenceThreshold;

  const refKps = storedPoses.ref[0].keypoints;
  const cmpKps = storedPoses.cmp[0].keypoints;

  const refOk = refKps[i1].confidence >= thresh && refKps[i2].confidence >= thresh;
  const cmpOk = cmpKps[i1].confidence >= thresh && cmpKps[i2].confidence >= thresh;

  if (!refOk || !cmpOk) {
    const which = !refOk && !cmpOk ? 'both images' : !refOk ? 'reference' : 'comparison';
    overlayStatus.textContent = 'No ' + label + ' detected in ' + which;
    return;
  }

  const w = overlayBox.clientWidth;
  const h = overlayBox.clientHeight;
  overlayCanvas.width = w;
  overlayCanvas.height = h;

  const refRect = getDisplayRect(refImg.naturalWidth, refImg.naturalHeight, overlayBox);
  const cmpRect = getDisplayRect(cmpImg.naturalWidth, cmpImg.naturalHeight, overlayBox);

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
  const rotation = refAngle - cmpAngle;

  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Reference
  ctx.globalAlpha = parseFloat(refAlphaSlider.value);
  ctx.drawImage(refImg, refRect.offsetX, refRect.offsetY, refRect.width, refRect.height);

  // Comparison (transformed)
  ctx.globalAlpha = parseFloat(cmpAlphaSlider.value);
  ctx.save();
  ctx.translate(refCx, refCy);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.translate(-cmpCx, -cmpCy);
  ctx.drawImage(cmpImg, cmpRect.offsetX, cmpRect.offsetY, cmpRect.width, cmpRect.height);
  ctx.restore();

  ctx.globalAlpha = 1.0;
}

// ========== INIT ==========

setupImageBox('reference-box', 'ref-img', 'ref-file', 'ref-canvas', 'ref-status', 'ref');
setupImageBox('compare-box', 'cmp-img', 'cmp-file', 'cmp-canvas', 'cmp-status', 'cmp');
