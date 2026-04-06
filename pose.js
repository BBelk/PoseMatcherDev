// --- Pose estimation via ONNX Runtime Web (RTMO multi-person) ---

const POSE_CONFIG = {
  modelPath: 'models/rtmo-t.onnx',
  inputSize: 416,
  confidenceThreshold: 0.3,             // per-keypoint: hide joints below this
  scoreThreshold: 0.3,                  // per-person: drop detections below this
};

const COCO_KEYPOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

const COCO_SKELETON = [
  [15, 13], [13, 11], [16, 14], [14, 12], [11, 12],
  [5, 11], [6, 12], [5, 6],
  [5, 7], [7, 9], [6, 8], [8, 10],
  [1, 3], [2, 4], [0, 1], [0, 2],
];

const LEFT_INDICES  = new Set([1, 3, 5, 7, 9, 11, 13, 15]);
const RIGHT_INDICES = new Set([2, 4, 6, 8, 10, 12, 14, 16]);

let poseSession = null;
let _prepCanvas = null;
let _prepCtx = null;

// --- Model loading ---

async function loadPoseModel() {
  if (poseSession) return poseSession;

  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
  ort.env.wasm.simd = true;

  poseSession = await ort.InferenceSession.create(POSE_CONFIG.modelPath, {
    executionProviders: ['wasm'],
  });

  console.log('Pose model loaded');
  console.log('  inputs:', poseSession.inputNames);
  console.log('  outputs:', poseSession.outputNames);
  return poseSession;
}

// --- Preprocessing (RTMO: top-left letterbox, pad 114, raw 0-255 float32) ---

function preprocessSource(source) {
  const s = POSE_CONFIG.inputSize;
  const srcW = source.videoWidth || source.naturalWidth;
  const srcH = source.videoHeight || source.naturalHeight;

  if (!_prepCanvas) {
    _prepCanvas = document.createElement('canvas');
    _prepCanvas.width = s;
    _prepCanvas.height = s;
    _prepCtx = _prepCanvas.getContext('2d', { willReadFrequently: true });
  }

  const ctx = _prepCtx;

  // Pad with gray 114 (RTMO/YOLO convention)
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, s, s);

  // Resize maintaining aspect ratio, place at TOP-LEFT (not centered)
  const ratio = Math.min(s / srcW, s / srcH);
  const rw = Math.round(srcW * ratio);
  const rh = Math.round(srcH * ratio);
  ctx.drawImage(source, 0, 0, rw, rh);

  // Store ratio and source dims for coordinate mapping
  POSE_CONFIG._ratio = ratio;
  POSE_CONFIG._srcW = srcW;
  POSE_CONFIG._srcH = srcH;

  const { data } = ctx.getImageData(0, 0, s, s);
  const px = s * s;
  const f = new Float32Array(3 * px);

  // Raw 0-255 float32, no mean/std normalization
  for (let i = 0; i < px; i++) {
    f[i]          = data[i * 4];
    f[px + i]     = data[i * 4 + 1];
    f[2 * px + i] = data[i * 4 + 2];
  }

  return new ort.Tensor('float32', f, [1, 3, s, s]);
}

// --- Output decoding (multi-person) ---

function decodeMultiPose(results, session) {
  const names = session.outputNames;
  const ratio = POSE_CONFIG._ratio;
  const srcW = POSE_CONFIG._srcW;
  const srcH = POSE_CONFIG._srcH;
  const thresh = POSE_CONFIG.scoreThreshold;

  // Log output shapes once
  if (!POSE_CONFIG._logged) {
    POSE_CONFIG._logged = true;
    for (const n of names) {
      console.log('  output "' + n + '": [' + results[n].dims + ']');
    }
  }

  const poses = [];

  if (names.length >= 2) {
    // Two outputs: dets [1,N,5] + keypoints [1,N,17,3]
    const out0 = results[names[0]], out1 = results[names[1]];
    let dets, kps;

    if (out0.dims.length === 3 && out0.dims[2] === 5) {
      dets = out0; kps = out1;
    } else if (out1.dims.length === 3 && out1.dims[2] === 5) {
      dets = out1; kps = out0;
    } else if (out0.dims.length === 4) {
      kps = out0; dets = out1;
    } else {
      kps = out1; dets = out0;
    }

    const N = dets.dims[1];
    const dd = dets.data, kd = kps.data;

    for (let i = 0; i < N; i++) {
      const score = dd[i * 5 + 4];
      if (score < thresh) continue;

      const keypoints = [];
      for (let k = 0; k < 17; k++) {
        const b = i * 17 * 3 + k * 3;
        // Coords are in input space, divide by ratio to get original pixels, then normalize 0-1
        keypoints.push({
          x: (kd[b] / ratio) / srcW,
          y: (kd[b + 1] / ratio) / srcH,
          confidence: kd[b + 2],
          name: COCO_KEYPOINTS[k],
        });
      }
      poses.push({ score, keypoints });
    }

  } else {
    // Single output [1, N, C] where C = 5 + 17*3 = 56
    const out = results[names[0]];
    const N = out.dims[1];
    const C = out.dims[2];
    const d = out.data;

    for (let i = 0; i < N; i++) {
      const rowBase = i * C;
      const score = d[rowBase + 4];
      if (score < thresh) continue;

      const keypoints = [];
      for (let k = 0; k < 17; k++) {
        const b = rowBase + 5 + k * 3;
        keypoints.push({
          x: (d[b] / ratio) / srcW,
          y: (d[b + 1] / ratio) / srcH,
          confidence: d[b + 2],
          name: COCO_KEYPOINTS[k],
        });
      }
      poses.push({ score, keypoints });
    }
  }

  // Sort left-to-right by average x of confident keypoints
  poses.sort((a, b) => avgX(a.keypoints) - avgX(b.keypoints));
  return poses;
}

function avgX(keypoints) {
  const thresh = POSE_CONFIG.confidenceThreshold;
  let sum = 0, count = 0;
  for (const kp of keypoints) {
    if (kp.confidence >= thresh) { sum += kp.x; count++; }
  }
  return count ? sum / count : 0;
}

// --- Run estimation (returns array of poses) ---

async function estimatePoses(source) {
  const session = await loadPoseModel();
  const tensor = preprocessSource(source);

  const feeds = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);

  return decodeMultiPose(results, session);
}

// --- Drawing ---

function getDisplayRect(srcWidth, srcHeight, container) {
  const cw = container.clientWidth, ch = container.clientHeight;
  const scale = Math.min(cw / srcWidth, ch / srcHeight);
  return {
    offsetX: (cw - srcWidth * scale) / 2,
    offsetY: (ch - srcHeight * scale) / 2,
    width: srcWidth * scale,
    height: srcHeight * scale,
  };
}

function edgeColor(i, j) {
  if (LEFT_INDICES.has(i) && LEFT_INDICES.has(j)) return '#00d4ff';
  if (RIGHT_INDICES.has(i) && RIGHT_INDICES.has(j)) return '#ff00d4';
  return '#00ff88';
}

function drawPoses(canvas, poses, displayRect, selectedIdx) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const multi = poses.length > 1;
  const sel = selectedIdx != null ? selectedIdx : 0;

  for (let i = 0; i < poses.length; i++) {
    drawSinglePose(ctx, poses[i].keypoints, displayRect, multi ? i : -1, multi && i === sel);
  }
}

// Returns bounding boxes for each pose in canvas coords (for click detection)
function getPoseBounds(poses, displayRect) {
  const { offsetX, offsetY, width, height } = displayRect;
  const thresh = POSE_CONFIG.confidenceThreshold;
  const pad = 5;

  return poses.map(pose => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const kp of pose.keypoints) {
      if (kp.confidence < thresh) continue;
      const px = offsetX + kp.x * width;
      const py = offsetY + kp.y * height;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  });
}

function drawSinglePose(ctx, keypoints, displayRect, personId, isSelected) {
  const { offsetX, offsetY, width, height } = displayRect;
  const thresh = POSE_CONFIG.confidenceThreshold;

  function pt(kp) {
    return { x: offsetX + kp.x * width, y: offsetY + kp.y * height };
  }

  // Bones
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [i, j] of COCO_SKELETON) {
    if (i >= keypoints.length || j >= keypoints.length) continue;
    const a = keypoints[i], b = keypoints[j];
    if (a.confidence < thresh || b.confidence < thresh) continue;
    const pa = pt(a), pb = pt(b);
    ctx.strokeStyle = edgeColor(i, j);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // Joints
  ctx.lineWidth = 1.5;
  for (const kp of keypoints) {
    if (kp.confidence < thresh) continue;
    const p = pt(kp);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Bounding box + ID label (only when multiple people)
  if (personId >= 0) {
    const pad = 5;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const kp of keypoints) {
      if (kp.confidence < thresh) continue;
      const p = pt(kp);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX < Infinity) {
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      ctx.strokeStyle = isSelected ? '#6cf' : '#fff';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.setLineDash([]);

      // ID label top-right of bounding box
      const label = (isSelected ? 'Selected ' : '') + personId;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const lw = tw + 8;
      const lh = 16;
      ctx.fillStyle = isSelected ? 'rgba(40,80,120,0.9)' : 'rgba(0,0,0,0.8)';
      ctx.fillRect(maxX - lw, minY, lw, lh);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(label, maxX - lw / 2, minY + lh / 2);
    }
  }
}
