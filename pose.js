// --- Pose estimation via ONNX Runtime Web (RTMO multi-person) ---

const POSE_CONFIG = {
  modelPath: 'models/rtmo-s.onnx',
  inputSize: 640,
  mean: [123.675, 116.28, 103.53],
  std: [58.395, 57.12, 57.375],
  confidenceThreshold: 0.3,
  scoreThreshold: 0.3,
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

  poseSession = await ort.InferenceSession.create(POSE_CONFIG.modelPath, {
    executionProviders: ['wasm'],
  });

  console.log('Pose model loaded');
  console.log('  inputs:', poseSession.inputNames);
  console.log('  outputs:', poseSession.outputNames);
  return poseSession;
}

// --- Preprocessing (letterbox, works with img or video) ---

function preprocessSource(source) {
  const { inputSize: s, mean, std } = POSE_CONFIG;
  const srcW = source.videoWidth || source.naturalWidth;
  const srcH = source.videoHeight || source.naturalHeight;

  if (!_prepCanvas) {
    _prepCanvas = document.createElement('canvas');
    _prepCanvas.width = s;
    _prepCanvas.height = s;
    _prepCtx = _prepCanvas.getContext('2d', { willReadFrequently: true });
  }

  const ctx = _prepCtx;

  // Fill with mean color for padding
  ctx.fillStyle = `rgb(${Math.round(mean[0])},${Math.round(mean[1])},${Math.round(mean[2])})`;
  ctx.fillRect(0, 0, s, s);

  // Letterbox: scale to fit, center
  const scale = Math.min(s / srcW, s / srcH);
  const sw = srcW * scale;
  const sh = srcH * scale;
  const ox = (s - sw) / 2;
  const oy = (s - sh) / 2;
  ctx.drawImage(source, ox, oy, sw, sh);

  // Store for coordinate reversal
  POSE_CONFIG._letterbox = { ox, oy, sw, sh };

  const { data } = ctx.getImageData(0, 0, s, s);
  const px = s * s;
  const f = new Float32Array(3 * px);

  for (let i = 0; i < px; i++) {
    f[i]          = (data[i * 4]     - mean[0]) / std[0];
    f[px + i]     = (data[i * 4 + 1] - mean[1]) / std[1];
    f[2 * px + i] = (data[i * 4 + 2] - mean[2]) / std[2];
  }

  return new ort.Tensor('float32', f, [1, 3, s, s]);
}

// --- Output decoding (multi-person, auto-detects format) ---

function decodeMultiPose(results, session) {
  const names = session.outputNames;
  const lb = POSE_CONFIG._letterbox;
  const thresh = POSE_CONFIG.scoreThreshold;

  // Log output shapes once for debugging
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
        keypoints.push({
          x: (kd[b] - lb.ox) / lb.sw,
          y: (kd[b + 1] - lb.oy) / lb.sh,
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
          x: (d[b] - lb.ox) / lb.sw,
          y: (d[b + 1] - lb.oy) / lb.sh,
          confidence: d[b + 2],
          name: COCO_KEYPOINTS[k],
        });
      }
      poses.push({ score, keypoints });
    }
  }

  poses.sort((a, b) => b.score - a.score);
  return poses;
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

function drawPoses(canvas, poses, displayRect) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const pose of poses) {
    drawSinglePose(ctx, pose.keypoints, displayRect);
  }
}

function drawSinglePose(ctx, keypoints, displayRect) {
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
}
