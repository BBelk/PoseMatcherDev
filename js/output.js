import { comparisons, currentMode } from './state.js';
import { dlog, dlogError } from './debug.js';
import { GIFEncoder, quantize, applyPalette } from '../lib/gifenc.js';

const generateBtnDesktop = document.getElementById('generate-btn-desktop');
const generateBtnMobile = document.getElementById('generate-btn-mobile');
const overlayCanvas = document.getElementById('overlay-canvas');
const outputBox = document.getElementById('output-box');
const outputGif = document.getElementById('output-gif');
const outputVideo = document.getElementById('output-video');
const outputFormatSelect = document.getElementById('output-format');
const saveBtn = document.getElementById('save-btn');
const errorBanner = document.getElementById('error-banner');

const loopToggle = document.getElementById('loop-toggle');
const frameCounterToggle = document.getElementById('frame-counter-toggle');
const frameDurationInput = document.getElementById('frame-duration');
const customDurationsPanel = document.getElementById('custom-durations');
const singleDurationRow = document.getElementById('single-duration-row');
const firstFrameDuration = document.getElementById('first-frame-duration');
const middleFrameDuration = document.getElementById('middle-frame-duration');
const lastFrameDuration = document.getElementById('last-frame-duration');
const transitionToggle = document.getElementById('transition-toggle');
const transitionTypeSelect = document.getElementById('transition-type');
const transitionDurationInput = document.getElementById('transition-duration');
const alignPartSelect = document.getElementById('align-part');
const scaleToggle = document.getElementById('scale-toggle');
const scalePairSelect = document.getElementById('scale-pair');
const rotateToggle = document.getElementById('rotate-toggle');
const rotatePairSelect = document.getElementById('rotate-pair');
const mp4QualityRow = document.getElementById('mp4-quality-row');
const mp4QualitySlider = document.getElementById('mp4-quality');
const mp4QualityVal = document.getElementById('mp4-quality-val');

let lastOutputBlob = null;
let lastOutputFormat = 'gif';
let customDurationsActive = localStorage.getItem('customDurationsActive') === 'true';

const PAIR_INDICES = {
  shoulders: [5, 6],
  hips: [11, 12],
  eyes: [1, 2],
};

let ffmpeg = null;

async function loadFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) {
    dlog('info', 'FFmpeg already loaded, reusing');
    return ffmpeg;
  }

  dlog('info', 'Loading FFmpeg WASM...');
  showProgress('Loading FFmpeg...');
  ffmpeg = new FFmpegWASM.FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    if (progress > 0 && progress <= 1) {
      const pct = Math.round(progress * 100);
      showProgress('Encoding: ' + pct + '%');
      if (pct % 25 === 0) {
        dlog('info', 'Encoding progress', { percent: pct });
      }
    }
  });

  const base = new URL('.', location.href).href;
  const loadStart = performance.now();
  try {
    await ffmpeg.load({
      coreURL: base + 'lib/ffmpeg/ffmpeg-core.js',
      wasmURL: base + 'lib/ffmpeg/ffmpeg-core.wasm',
    });
    dlog('info', 'FFmpeg loaded', { ms: Math.round(performance.now() - loadStart) });
  } catch (err) {
    dlogError('FFmpeg load failed', err);
    throw err;
  }

  return ffmpeg;
}

function canvasToUint8(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(async (blob) => {
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', 0.92);
  });
}

function transitionFade(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvasA, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(canvasB, 0, 0);
  ctx.globalAlpha = 1;
  return c;
}

function transitionWipe(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvasA, 0, 0);
  const wipeX = Math.round(alpha * w);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, wipeX, h);
  ctx.clip();
  ctx.drawImage(canvasB, 0, 0);
  ctx.restore();
  return c;
}

function transitionSlide(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const offset = Math.round(alpha * w);
  ctx.drawImage(canvasA, -offset, 0);
  ctx.drawImage(canvasB, w - offset, 0);
  return c;
}

function transitionFlash(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (alpha < 0.5) {
    ctx.drawImage(canvasA, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 2) + ')';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.drawImage(canvasB, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,' + ((1 - alpha) * 2) + ')';
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

function transitionBlur(canvasA, canvasB, alpha, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const maxBlur = 20;
  if (alpha < 0.5) {
    const blur = alpha * 2 * maxBlur;
    ctx.filter = 'blur(' + blur + 'px)';
    ctx.drawImage(canvasA, 0, 0);
  } else {
    const blur = (1 - alpha) * 2 * maxBlur;
    ctx.filter = 'blur(' + blur + 'px)';
    ctx.drawImage(canvasB, 0, 0);
  }
  ctx.filter = 'none';
  return c;
}

function blendFrames(canvasA, canvasB, alpha, w, h, type) {
  switch (type) {
    case 'wipe': return transitionWipe(canvasA, canvasB, alpha, w, h);
    case 'slide': return transitionSlide(canvasA, canvasB, alpha, w, h);
    case 'flash': return transitionFlash(canvasA, canvasB, alpha, w, h);
    case 'blur': return transitionBlur(canvasA, canvasB, alpha, w, h);
    default: return transitionFade(canvasA, canvasB, alpha, w, h);
  }
}

function showProgress(msg) {
  const ph = outputBox.querySelector('.placeholder');
  if (ph) {
    ph.textContent = msg;
    ph.style.display = '';
  }
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'block';
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.style.display = 'none';
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

function computeAlignTransform(refKps, cmpKps, refImgEl, cmpImgEl, w, h, refCustomPt, cmpCustomPt) {
  const thresh = POSE_CONFIG.confidenceThreshold;
  const container = { clientWidth: w, clientHeight: h };
  const refRect = getDisplayRect(refImgEl.naturalWidth, refImgEl.naturalHeight, container);
  const cmpRect = getDisplayRect(cmpImgEl.naturalWidth, cmpImgEl.naturalHeight, container);

  function toCanvas(kp, rect) {
    return { x: rect.offsetX + kp.x * rect.width, y: rect.offsetY + kp.y * rect.height };
  }

  if (currentMode === 'custom') {
    return {
      refCx: refRect.offsetX + refCustomPt.x * refRect.width,
      refCy: refRect.offsetY + refCustomPt.y * refRect.height,
      cmpCx: cmpRect.offsetX + cmpCustomPt.x * cmpRect.width,
      cmpCy: cmpRect.offsetY + cmpCustomPt.y * cmpRect.height,
      scale: 1, rotation: 0, refRect, cmpRect,
    };
  }

  const anchorIdx = parseInt(alignPartSelect.value);
  const refHasAnchor = refKps && refKps[anchorIdx] && refKps[anchorIdx].confidence >= thresh;
  const cmpHasAnchor = cmpKps && cmpKps[anchorIdx] && cmpKps[anchorIdx].confidence >= thresh;

  const refAnchor = refHasAnchor ? toCanvas(refKps[anchorIdx], refRect)
    : { x: refRect.offsetX + refCustomPt.x * refRect.width, y: refRect.offsetY + refCustomPt.y * refRect.height };
  const cmpAnchor = cmpHasAnchor ? toCanvas(cmpKps[anchorIdx], cmpRect)
    : { x: cmpRect.offsetX + cmpCustomPt.x * cmpRect.width, y: cmpRect.offsetY + cmpCustomPt.y * cmpRect.height };

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

function renderRefFrame(ref, w, h, frameNum) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  const rect = getDisplayRect(ref.img.naturalWidth, ref.img.naturalHeight, { clientWidth: w, clientHeight: h });
  ctx.drawImage(ref.img, rect.offsetX, rect.offsetY, rect.width, rect.height);
  drawFrameCounter(ctx, frameNum, w);
  return canvas;
}

function renderCmpFrame(ref, cmp, w, h, frameNum) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  const refKps = ref.poses && ref.poses[ref.selectedPerson] ? ref.poses[ref.selectedPerson].keypoints : null;
  const cmpKps = cmp.poses && cmp.poses[cmp.selectedPerson] ? cmp.poses[cmp.selectedPerson].keypoints : null;
  const t = computeAlignTransform(
    refKps, cmpKps,
    ref.img, cmp.img, w, h,
    ref.customPoint, cmp.customPoint
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

async function generateGif(validCmps, w, h, loopGif, useTransitions, tType, tDur, durFirst, durMiddle, durLast) {
  const startTime = performance.now();

  dlog('info', 'Using gifenc for GIF encoding');
  showProgress('Encoding GIF...');

  const gif = GIFEncoder();
  let frameCount = 0;

  const minFrameDur = Math.min(durFirst, durMiddle, durLast);
  let actualTDur = tDur;
  if (actualTDur > minFrameDur) actualTDur = minFrameDur;

  const transitionFps = 10;
  const transitionSteps = Math.max(2, Math.round(actualTDur * transitionFps));
  const stepDurMs = actualTDur > 0 ? Math.round((actualTDur / transitionSteps) * 1000) : 0;
  const doTransitions = useTransitions && validCmps.length > 1;

  function encodeFrame(canvas, delayMs) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, w, h);
    const { data } = imageData;

    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);

    gif.writeFrame(index, w, h, { palette, delay: delayMs });
    frameCount++;
  }

  const ref = validCmps[0];
  let frameNum = 1;
  let prevCanvas = null;

  try {
    for (let i = 0; i < validCmps.length; i++) {
      const isFirst = i === 0;
      const isLast = i === validCmps.length - 1;
      const rawDur = isFirst ? durFirst : isLast ? durLast : durMiddle;
      const holdDur = (doTransitions && actualTDur > 0 && !isLast) ? Math.max(0.01, rawDur - actualTDur) : rawDur;
      const holdMs = Math.round(holdDur * 1000);

      const canvas = isFirst
        ? renderRefFrame(ref, w, h, frameNum++)
        : renderCmpFrame(ref, validCmps[i], w, h, frameNum++);

      if (!canvas) continue;

      encodeFrame(canvas, holdMs);
      showProgress('Encoding ' + (i + 1) + '/' + validCmps.length + '...');

      if (i % 3 === 0 || isLast) {
        dlog('info', 'GIF frame progress', { frame: i + 1, of: validCmps.length, totalFrames: frameCount });
      }

      if (doTransitions && actualTDur > 0 && !isLast) {
        const nextCanvas = renderCmpFrame(ref, validCmps[i + 1], w, h, frameNum);
        if (nextCanvas) {
          for (let k = 1; k < transitionSteps; k++) {
            const alpha = k / transitionSteps;
            const blended = blendFrames(canvas, nextCanvas, alpha, w, h, tType);
            encodeFrame(blended, stepDurMs);
          }
        }
      }

      prevCanvas = canvas;
    }

    if (loopGif && doTransitions && actualTDur > 0 && prevCanvas) {
      dlog('info', 'Adding loop transition frames...');
      const firstCanvas = renderRefFrame(ref, w, h, 1);
      for (let k = 1; k < transitionSteps; k++) {
        const alpha = k / transitionSteps;
        const blended = blendFrames(prevCanvas, firstCanvas, alpha, w, h, tType);
        encodeFrame(blended, stepDurMs);
      }
    }

    gif.finish();

    const bytes = gif.bytes();
    dlog('info', 'GIF encoded', {
      frames: frameCount,
      bytes: bytes.length,
      mb: Math.round(bytes.length / 1024 / 1024 * 100) / 100,
      ms: Math.round(performance.now() - startTime)
    });

    lastOutputBlob = new Blob([bytes], { type: 'image/gif' });
    lastOutputFormat = 'gif';
    outputGif.src = URL.createObjectURL(lastOutputBlob);
    outputGif.style.display = 'block';
    outputVideo.style.display = 'none';

    return { success: true, ms: Math.round(performance.now() - startTime) };
  } catch (err) {
    dlogError('GIF encoding failed', err);
    return { success: false, error: err };
  }
}

async function generateVideo(validCmps, w, h, loopGif, useTransitions, tType, tDur, durFirst, durMiddle, durLast, format) {
  const startTime = performance.now();

  let ff;
  try {
    ff = await loadFFmpeg();
  } catch (err) {
    return { success: false, error: err };
  }

  dlog('info', 'Rendering frames for video...');
  showProgress('Rendering frames...');

  const ref = validCmps[0];
  let frameNum = 1;
  const mainCanvases = [];

  mainCanvases.push(renderRefFrame(ref, w, h, frameNum++));
  for (let i = 1; i < validCmps.length; i++) {
    const c = renderCmpFrame(ref, validCmps[i], w, h, frameNum++);
    if (c) mainCanvases.push(c);
  }

  if (!mainCanvases.length) {
    return { success: false, error: new Error('No frames to encode') };
  }

  dlog('info', 'Main frames rendered', { count: mainCanvases.length });

  const minFrameDur = Math.min(durFirst, durMiddle, durLast);
  let actualTDur = tDur;
  if (actualTDur > minFrameDur) actualTDur = minFrameDur;

  const transitionFps = 10;
  const transitionSteps = Math.max(2, Math.round(actualTDur * transitionFps));
  const stepDur = actualTDur > 0 ? actualTDur / transitionSteps : 0;
  const doTransitions = useTransitions && mainCanvases.length > 1;

  showProgress('Processing frames...');

  let frameIdx = 0;
  let concatList = '';
  let totalBytesWritten = 0;

  async function writeFrame(canvas, duration) {
    const data = await canvasToUint8(canvas);
    totalBytesWritten += data.byteLength;
    const name = 'frame_' + String(frameIdx).padStart(4, '0') + '.jpg';
    await ff.writeFile(name, data);
    concatList += "file '" + name + "'\nduration " + duration + "\n";
    frameIdx++;
  }

  try {
    for (let i = 0; i < mainCanvases.length; i++) {
      const isLast = i === mainCanvases.length - 1;
      const rawDur = i === 0 ? durFirst : isLast ? durLast : durMiddle;
      const holdDur = (doTransitions && actualTDur > 0 && !isLast) ? Math.max(0.01, rawDur - actualTDur) : rawDur;

      await writeFrame(mainCanvases[i], holdDur);
      showProgress('Processing ' + (i + 1) + '/' + mainCanvases.length + '...');

      if (doTransitions && actualTDur > 0 && !isLast) {
        const next = mainCanvases[i + 1];
        for (let k = 1; k < transitionSteps; k++) {
          const alpha = k / transitionSteps;
          const blended = blendFrames(mainCanvases[i], next, alpha, w, h, tType);
          await writeFrame(blended, stepDur);
        }
      }

      if (i % 5 === 0 || isLast) {
        dlog('info', 'Frame progress', {
          frame: i + 1,
          of: mainCanvases.length,
          totalWritten: frameIdx,
          bytesMB: Math.round(totalBytesWritten / 1024 / 1024 * 100) / 100
        });
      }
    }

    if (loopGif && doTransitions && actualTDur > 0 && mainCanvases.length > 1) {
      dlog('info', 'Adding loop transition frames...');
      const last = mainCanvases[mainCanvases.length - 1];
      const first = mainCanvases[0];
      for (let k = 1; k < transitionSteps; k++) {
        const alpha = k / transitionSteps;
        const blended = blendFrames(last, first, alpha, w, h, tType);
        await writeFrame(blended, stepDur);
      }
    }
  } catch (err) {
    dlogError('Frame processing failed', err);
    return { success: false, error: err };
  }

  const totalFrames = frameIdx;
  dlog('info', 'All frames written', { totalFrames, totalMB: Math.round(totalBytesWritten / 1024 / 1024 * 100) / 100 });
  await ff.writeFile('frames.txt', new TextEncoder().encode(concatList));

  const needsEvenDims = ['mp4', 'mov'].includes(format);
  const vf = (needsEvenDims && (w % 2 || h % 2)) ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2' : null;
  const crf = mp4QualitySlider.value;
  const args = ['-f', 'concat', '-safe', '0', '-i', 'frames.txt'];
  if (vf) args.push('-vf', vf);

  let outFile, mimeType;
  if (format === 'mp4') {
    showProgress('Encoding MP4...');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', crf, '-movflags', '+faststart', 'output.mp4');
    outFile = 'output.mp4';
    mimeType = 'video/mp4';
  } else if (format === 'webm') {
    showProgress('Encoding WebM...');
    args.push('-c:v', 'libvpx', '-crf', crf, '-b:v', '1M', '-deadline', 'realtime', 'output.webm');
    outFile = 'output.webm';
    mimeType = 'video/webm';
  } else if (format === 'mov') {
    showProgress('Encoding MOV...');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', crf, 'output.mov');
    outFile = 'output.mov';
    mimeType = 'video/quicktime';
  }

  dlog('info', 'Video ffmpeg args', { args: args.join(' '), crf });

  try {
    await ff.exec(args);
    dlog('info', 'Video encode complete, reading output...');
    const videoData = await ff.readFile(outFile);
    dlog('info', 'Video output size', { bytes: videoData.byteLength, mb: Math.round(videoData.byteLength / 1024 / 1024 * 100) / 100 });
    lastOutputBlob = new Blob([videoData], { type: mimeType });
    lastOutputFormat = format;
    outputVideo.src = URL.createObjectURL(lastOutputBlob);
    outputVideo.loop = loopGif;
    outputVideo.style.display = 'block';
    outputVideo.play();
    outputGif.style.display = 'none';
  } catch (err) {
    dlogError('Video encoding failed', err);
    return { success: false, error: err };
  }

  // Cleanup
  try {
    for (let i = 0; i < totalFrames; i++) {
      await ff.deleteFile('frame_' + String(i).padStart(4, '0') + '.jpg');
    }
    await ff.deleteFile('frames.txt');
    await ff.deleteFile(outFile);
  } catch (_) {}

  return { success: true, ms: Math.round(performance.now() - startTime) };
}

async function generate() {
  const format = outputFormatSelect.value;
  dlog('info', '=== GENERATE STARTED ===', { format });
  clearError();
  resetOutput();

  const validCmps = comparisons.filter(c => c && c.img && c.img.naturalWidth);
  dlog('info', 'Valid images', { count: validCmps.length });
  if (validCmps.length < 2) { showError('Add at least 2 images'); return; }

  const ref = validCmps[0];
  const w = parseInt(document.getElementById('output-width').value) || ref.img.naturalWidth || outputBox.clientWidth;
  const h = parseInt(document.getElementById('output-height').value) || ref.img.naturalHeight || outputBox.clientHeight;
  const loopGif = loopToggle.checked;
  const useTransitions = transitionToggle.checked;
  const tType = transitionTypeSelect.value;
  const tDur = parseFloat(transitionDurationInput.value) || 0;

  dlog('info', 'Output settings', {
    dimensions: `${w}x${h}`,
    pixels: w * h,
    estimatedFrameMB: Math.round((w * h * 4) / 1024 / 1024 * 100) / 100,
    loop: loopGif,
    transitions: useTransitions ? `${tType} ${tDur}s` : 'off',
    format
  });

  const defaultDur = parseFloat(frameDurationInput.value) || 0.5;
  let durFirst, durMiddle, durLast;
  if (customDurationsActive) {
    durFirst = parseFloat(firstFrameDuration.value) || defaultDur;
    durMiddle = parseFloat(middleFrameDuration.value) || defaultDur;
    durLast = parseFloat(lastFrameDuration.value) || defaultDur;
  } else {
    durFirst = durMiddle = durLast = defaultDur;
  }

  const startTime = performance.now();
  let result;

  if (format === 'gif') {
    result = await generateGif(validCmps, w, h, loopGif, useTransitions, tType, tDur, durFirst, durMiddle, durLast);
  } else {
    result = await generateVideo(validCmps, w, h, loopGif, useTransitions, tType, tDur, durFirst, durMiddle, durLast, format);
  }

  if (!result.success) {
    showError('Encoding failed: ' + (result.error?.message || result.error));
    return;
  }

  dlog('info', '=== GENERATE COMPLETE ===', {
    totalMs: Math.round(performance.now() - startTime),
    outputMB: Math.round(lastOutputBlob.size / 1024 / 1024 * 100) / 100
  });

  overlayCanvas.style.display = 'none';
  clearError();
  saveBtn.style.display = '';
  outputBox.classList.remove('empty');
  outputBox.style.aspectRatio = w + ' / ' + h;
  const ph = outputBox.querySelector('.placeholder');
  if (ph) ph.style.display = 'none';
}

export function setupOutput() {
  errorBanner.addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });

  const _savedOutputFormat = localStorage.getItem('outputFormat');
  if (_savedOutputFormat) outputFormatSelect.value = _savedOutputFormat;

  function updateVideoQualityVisibility() {
    const isVideo = ['mp4', 'webm', 'mov'].includes(outputFormatSelect.value);
    mp4QualityRow.style.display = isVideo ? '' : 'none';
  }
  updateVideoQualityVisibility();

  outputFormatSelect.addEventListener('change', () => {
    localStorage.setItem('outputFormat', outputFormatSelect.value);
    updateVideoQualityVisibility();
  });

  const _savedMp4Quality = localStorage.getItem('mp4Quality');
  if (_savedMp4Quality) {
    mp4QualitySlider.value = _savedMp4Quality;
    mp4QualityVal.value = _savedMp4Quality;
  }
  mp4QualitySlider.addEventListener('input', () => {
    mp4QualityVal.value = mp4QualitySlider.value;
    localStorage.setItem('mp4Quality', mp4QualitySlider.value);
  });
  mp4QualityVal.addEventListener('input', () => {
    mp4QualitySlider.value = mp4QualityVal.value;
    localStorage.setItem('mp4Quality', mp4QualityVal.value);
  });

  if (localStorage.getItem('loop') !== null) loopToggle.checked = localStorage.getItem('loop') === 'true';
  if (localStorage.getItem('frameCounter') === 'true') frameCounterToggle.checked = true;
  loopToggle.addEventListener('change', () => localStorage.setItem('loop', loopToggle.checked));
  frameCounterToggle.addEventListener('change', () => localStorage.setItem('frameCounter', frameCounterToggle.checked));

  const _savedFrameDur = localStorage.getItem('frameDuration');
  if (_savedFrameDur) { frameDurationInput.value = _savedFrameDur; firstFrameDuration.value = _savedFrameDur; middleFrameDuration.value = _savedFrameDur; lastFrameDuration.value = _savedFrameDur; }
  const _savedFirstDur = localStorage.getItem('firstFrameDuration');
  const _savedMiddleDur = localStorage.getItem('middleFrameDuration');
  const _savedLastDur = localStorage.getItem('lastFrameDuration');
  if (customDurationsActive) {
    singleDurationRow.style.display = 'none';
    customDurationsPanel.style.display = '';
    if (_savedFirstDur) firstFrameDuration.value = _savedFirstDur;
    if (_savedMiddleDur) middleFrameDuration.value = _savedMiddleDur;
    if (_savedLastDur) lastFrameDuration.value = _savedLastDur;
  }

  frameDurationInput.addEventListener('input', () => {
    firstFrameDuration.value = frameDurationInput.value;
    middleFrameDuration.value = frameDurationInput.value;
    lastFrameDuration.value = frameDurationInput.value;
    localStorage.setItem('frameDuration', frameDurationInput.value);
  });
  firstFrameDuration.addEventListener('change', () => localStorage.setItem('firstFrameDuration', firstFrameDuration.value));
  middleFrameDuration.addEventListener('change', () => localStorage.setItem('middleFrameDuration', middleFrameDuration.value));
  lastFrameDuration.addEventListener('change', () => localStorage.setItem('lastFrameDuration', lastFrameDuration.value));

  document.getElementById('custom-durations-toggle').addEventListener('click', () => {
    customDurationsActive = true;
    localStorage.setItem('customDurationsActive', 'true');
    singleDurationRow.style.display = 'none';
    customDurationsPanel.style.display = '';
  });

  document.getElementById('custom-durations-back').addEventListener('click', () => {
    customDurationsActive = false;
    localStorage.setItem('customDurationsActive', 'false');
    customDurationsPanel.style.display = 'none';
    singleDurationRow.style.display = '';
    firstFrameDuration.value = frameDurationInput.value;
    middleFrameDuration.value = frameDurationInput.value;
    lastFrameDuration.value = frameDurationInput.value;
  });

  if (localStorage.getItem('transitionEnabled') === 'true') transitionToggle.checked = true;
  const _savedTransType = localStorage.getItem('transitionType');
  if (_savedTransType) transitionTypeSelect.value = _savedTransType;
  const _savedTransDur = localStorage.getItem('transitionDuration');
  if (_savedTransDur) transitionDurationInput.value = _savedTransDur;

  const transitionDurationRow = document.getElementById('transition-duration-row');
  function updateTransitionRowVisibility() {
    transitionDurationRow.style.display = transitionToggle.checked ? '' : 'none';
  }
  updateTransitionRowVisibility();

  transitionToggle.addEventListener('change', () => {
    localStorage.setItem('transitionEnabled', transitionToggle.checked);
    updateTransitionRowVisibility();
  });
  transitionTypeSelect.addEventListener('change', () => localStorage.setItem('transitionType', transitionTypeSelect.value));
  transitionDurationInput.addEventListener('change', () => localStorage.setItem('transitionDuration', transitionDurationInput.value));

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

  generateBtnDesktop.addEventListener('click', generate);
  generateBtnMobile.addEventListener('click', generate);

  saveBtn.addEventListener('click', () => {
    if (!lastOutputBlob) return;
    const extMap = { gif: 'gif', mp4: 'mp4', webm: 'webm', mov: 'mov' };
    const ext = extMap[lastOutputFormat] || lastOutputFormat;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(lastOutputBlob);
    a.download = 'posematcher.' + ext;
    a.click();
  });
}

export function clearOutput() {
  lastOutputBlob = null;
  saveBtn.style.display = 'none';
  outputGif.style.display = 'none';
  outputGif.src = '';
  outputVideo.style.display = 'none';
  outputVideo.src = '';
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  clearError();
  outputBox.classList.add('empty');
  outputBox.style.aspectRatio = '';
  const ph = outputBox.querySelector('.placeholder');
  if (ph) {
    ph.textContent = 'Your GIF or video will appear here after you click Generate';
    ph.style.display = '';
  }
}
