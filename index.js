const referenceBox = document.getElementById('reference-box');
const referenceImg = document.getElementById('reference-img');
const fileInput = document.getElementById('file-input');
const clearBtn = document.getElementById('clear-btn');
const poseCanvas = document.getElementById('pose-canvas');
const poseStatus = document.getElementById('pose-status');

const cameraBox = document.getElementById('camera-box');
const liveVideo = document.getElementById('live-video');
const liveCanvas = document.getElementById('live-canvas');
const cameraStatus = document.getElementById('camera-status');
const cameraBtn = document.getElementById('camera-btn');

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

// ========== REFERENCE IMAGE ==========

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadReferenceImage(file);
});

referenceBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  referenceBox.classList.add('dragover');
});

referenceBox.addEventListener('dragleave', () => {
  referenceBox.classList.remove('dragover');
});

referenceBox.addEventListener('drop', (e) => {
  e.preventDefault();
  referenceBox.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadReferenceImage(file);
});

referenceBox.addEventListener('click', (e) => {
  if (e.target.closest('#upload-label') || e.target === fileInput) return;
  if (!referenceBox.classList.contains('has-image') && e.target !== clearBtn) {
    fileInput.click();
  }
});

clearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  referenceImg.src = '';
  referenceBox.classList.remove('has-image');
  fileInput.value = '';
  poseCanvas.getContext('2d').clearRect(0, 0, poseCanvas.width, poseCanvas.height);
  poseStatus.textContent = '';
});

function loadReferenceImage(file) {
  const url = URL.createObjectURL(file);
  referenceImg.onload = async () => {
    URL.revokeObjectURL(url);
    referenceBox.classList.add('has-image');
    sizeRefCanvas();
    await runRefPoseDetection();
  };
  referenceImg.src = url;
}

function sizeRefCanvas() {
  poseCanvas.width = referenceBox.clientWidth;
  poseCanvas.height = referenceBox.clientHeight;
}

async function runRefPoseDetection() {
  poseStatus.textContent = 'Detecting pose...';
  try {
    const poses = await estimatePoses(referenceImg);
    const rect = getDisplayRect(referenceImg.naturalWidth, referenceImg.naturalHeight, referenceBox);
    drawPoses(poseCanvas, poses, rect);

    const total = poses.length;
    poseStatus.textContent = total + ' person' + (total !== 1 ? 's' : '') + ' detected';
    setTimeout(() => { poseStatus.textContent = ''; }, 2000);
  } catch (err) {
    console.error('Pose detection failed:', err);
    poseStatus.textContent = 'Model error — see console';
  }
}

window.addEventListener('resize', () => {
  if (referenceBox.classList.contains('has-image')) {
    sizeRefCanvas();
    runRefPoseDetection();
  }
});

// ========== LIVE CAMERA ==========

let cameraStream = null;
let cameraRunning = false;
let inferring = false;

cameraBtn.addEventListener('click', () => {
  if (cameraRunning) {
    stopCamera();
  } else {
    startCamera();
  }
});

async function startCamera() {
  cameraStatus.textContent = 'Starting camera...';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    liveVideo.srcObject = cameraStream;
    await liveVideo.play();

    cameraBox.classList.add('active');
    cameraBtn.classList.add('active');
    cameraBtn.textContent = 'Stop Camera';
    cameraRunning = true;
    cameraStatus.textContent = '';

    cameraLoop();
  } catch (err) {
    console.error('Camera error:', err);
    cameraStatus.textContent = 'Camera access denied';
  }
}

function stopCamera() {
  cameraRunning = false;
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  liveVideo.srcObject = null;
  cameraBox.classList.remove('active');
  cameraBtn.classList.remove('active');
  cameraBtn.textContent = 'Start Camera';
  liveCanvas.getContext('2d').clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  cameraStatus.textContent = '';
}

function cameraLoop() {
  if (!cameraRunning) return;

  if (!inferring && liveVideo.readyState >= 2) {
    inferring = true;

    liveCanvas.width = cameraBox.clientWidth;
    liveCanvas.height = cameraBox.clientHeight;

    estimatePoses(liveVideo).then(poses => {
      // Flip x to match the mirrored video display
      for (const pose of poses) {
        for (const kp of pose.keypoints) kp.x = 1 - kp.x;
      }
      const rect = getDisplayRect(liveVideo.videoWidth, liveVideo.videoHeight, cameraBox);
      drawPoses(liveCanvas, poses, rect);
      cameraStatus.textContent = poses.length + ' person' + (poses.length !== 1 ? 's' : '');
      inferring = false;
    }).catch(err => {
      console.error('Live pose error:', err);
      cameraStatus.textContent = 'Error: ' + err.message;
      inferring = false;
    });
  }

  requestAnimationFrame(cameraLoop);
}
