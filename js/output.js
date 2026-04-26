import { comparisons, currentMode } from './state.js';
import { dlog, dlogError } from './debug.js';
import { GIFEncoder, quantize, applyPalette, prequantize } from '../lib/gifenc.js';
import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  CanvasSource,
} from '../lib/mediabunny/mediabunny.min.mjs';

const generateBtnDesktop = document.getElementById('generate-btn-desktop');
const generateBtnMobile = document.getElementById('generate-btn-mobile');
const overlayCanvas = document.getElementById('overlay-canvas');
const outputBox = document.getElementById('output-box');
const outputGif = document.getElementById('output-gif');
const outputVideo = document.getElementById('output-video');
const outputFormatSelect = document.getElementById('output-format');
const saveBtn = document.getElementById('save-btn');
const outputSizeLabel = document.getElementById('output-size');
const sectionHeader = document.querySelector('#output-section .section-header');
const errorBanner = document.getElementById('error-banner');

const loopToggle = document.getElementById('loop-toggle');
const frameCounterToggle = document.getElementById('frame-counter-toggle');
const outputWidthInput = document.getElementById('output-width');
const outputHeightInput = document.getElementById('output-height');
const sizeLockBtn = document.getElementById('size-lock-btn');
const gifOptionsRow = document.getElementById('gif-options-row');
const gifLossySlider = document.getElementById('gif-lossy');
const gifLossyVal = document.getElementById('gif-lossy-val');
const gifDiffToggle = document.getElementById('gif-diff-toggle');
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
let sizeLocked = localStorage.getItem('sizeLocked') === 'true';
let isGenerating = false;
let abortGeneration = false;

const PAIR_INDICES = {
  shoulders: [5, 6],
  hips: [11, 12],
  eyes: [1, 2],
};

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

const progressContainer = document.getElementById('progress-container');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');

function computeTransitionParams(tDur, durFirst, durMiddle, durLast, frameCount, loop) {
  const minFrameDur = Math.min(durFirst, durMiddle, durLast);
  const actualTDur = Math.min(tDur, minFrameDur);
  const transitionFps = 10;
  const transitionSteps = Math.max(2, Math.round(actualTDur * transitionFps));
  const stepDur = actualTDur > 0 ? actualTDur / transitionSteps : 0;
  const transFramesPerGap = transitionSteps - 1;
  const loopTransFrames = (loop && actualTDur > 0) ? transitionSteps - 1 : 0;
  const totalFrames = frameCount + (frameCount - 1) * transFramesPerGap + loopTransFrames;
  return { actualTDur, transitionSteps, stepDur, totalFrames };
}

function showProgress(msg, percent = null) {
  if (!progressContainer || !progressBar) return;
  progressContainer.classList.remove('idle');
  progressContainer.style.display = 'flex';
  progressText.textContent = msg;

  if (percent === null) {
    progressBar.classList.add('indeterminate');
    progressBar.style.width = '';
  } else {
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = Math.min(100, Math.max(0, percent)) + '%';
  }
}

function hideProgress() {
  progressContainer.style.display = 'none';
}

function showIdle(msg) {
  progressContainer.classList.add('idle');
  progressContainer.style.display = 'flex';
  progressText.textContent = msg;
  progressBar.classList.remove('indeterminate');
  progressBar.style.width = '0%';
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
  try {
    if (outputGif.src && outputGif.src.startsWith('blob:')) URL.revokeObjectURL(outputGif.src);
    if (outputVideo.src && outputVideo.src.startsWith('blob:')) URL.revokeObjectURL(outputVideo.src);
  } catch (e) {}

  outputVideo.pause();
  outputGif.removeAttribute('src');
  outputVideo.removeAttribute('src');
  outputGif.style.display = 'none';
  outputVideo.style.display = 'none';
  overlayCanvas.style.display = 'none';

  outputBox.classList.add('empty');
  outputBox.style.aspectRatio = '';
  saveBtn.style.display = 'none';
  sectionHeader.classList.add('generate-only');
  lastOutputBlob = null;

  showProgress('Preparing...');
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

  dlog('info', 'Using gifenc for GIF encoding with global palette + frame diff');
  showProgress('Building color palette...', 5);

  // Build global palette by sampling from source images (reserve 255 colors, index 0 = transparent)
  const sampleSize = 128;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  const samplesPerImage = sampleSize * sampleSize * 4;
  const allSamples = new Uint8Array(validCmps.length * samplesPerImage);

  for (let i = 0; i < validCmps.length; i++) {
    const img = validCmps[i].img;
    sampleCtx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const imageData = sampleCtx.getImageData(0, 0, sampleSize, sampleSize);
    allSamples.set(imageData.data, i * samplesPerImage);
  }

  // Quantize to 255 colors, prepend transparent color at index 0
  const basePalette = quantize(allSamples, 255);
  const globalPalette = [[0, 0, 0], ...basePalette]; // Index 0 = transparent
  const TRANSPARENT_INDEX = 0;
  const DIFF_THRESHOLD = 32; // Pixels within this RGB distance are "same"

  dlog('info', 'Global palette built', { colors: globalPalette.length, sampledImages: validCmps.length });

  const gif = GIFEncoder();
  let frameCount = 0;
  let prevFrameData = null;

  const doTransitions = useTransitions && validCmps.length > 1;
  const tParams = doTransitions ? computeTransitionParams(tDur, durFirst, durMiddle, durLast, validCmps.length, loopGif) : null;
  const { actualTDur = 0, transitionSteps = 0, stepDur = 0, totalFrames: totalEstimatedFrames = validCmps.length } = tParams || {};
  const stepDurMs = Math.round(stepDur * 1000);

  const compressionVal = parseInt(gifLossySlider.value) || 0;
  const LOSSY_ROUND = Math.round((compressionVal / 100) * 30);
  const USE_FRAME_DIFF = gifDiffToggle.checked;

  function encodeFrame(canvas, delayMs) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, w, h);
    const { data } = imageData;
    const isFirstFrame = frameCount === 0;

    // Lossy: round pixel values to create more repeated sequences for LZW
    if (LOSSY_ROUND > 0) {
      prequantize(data, { roundRGB: LOSSY_ROUND });
    }

    const index = applyPalette(data, globalPalette);

    // Frame differencing: mark unchanged pixels as transparent
    let usedDiff = false;
    if (USE_FRAME_DIFF && !isFirstFrame && prevFrameData) {
      usedDiff = true;
      const pixelCount = w * h;
      let unchangedCount = 0;
      for (let i = 0; i < pixelCount; i++) {
        const ri = i * 4;
        const dr = Math.abs(data[ri] - prevFrameData[ri]);
        const dg = Math.abs(data[ri + 1] - prevFrameData[ri + 1]);
        const db = Math.abs(data[ri + 2] - prevFrameData[ri + 2]);
        if (dr + dg + db < DIFF_THRESHOLD) {
          index[i] = TRANSPARENT_INDEX;
          unchangedCount++;
        }
      }
      dlog('info', 'Frame diff', { unchanged: Math.round(unchangedCount / pixelCount * 100) + '%' });
    }

    // Store current frame for next diff (copy the data)
    if (USE_FRAME_DIFF) {
      prevFrameData = new Uint8Array(data);
    }

    const frameOpts = {
      palette: globalPalette,
      delay: delayMs,
      dispose: usedDiff ? 1 : 0, // 1 = keep previous frame (required for transparency)
    };
    if (usedDiff) {
      frameOpts.transparent = true;
      frameOpts.transparentIndex = TRANSPARENT_INDEX;
    }

    gif.writeFrame(index, w, h, frameOpts);
    frameCount++;

    const pct = 10 + Math.round((frameCount / totalEstimatedFrames) * 90);
    showProgress(`Encoding frame ${frameCount}/${totalEstimatedFrames}`, pct);
  }

  const ref = validCmps[0];
  let frameNum = 1;
  let prevCanvas = null;

  const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

  try {
    for (let i = 0; i < validCmps.length; i++) {
      if (abortGeneration) return { success: false, error: 'Aborted' };

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

      // Yield to browser so progress bar can update
      await yieldToBrowser();

      if (i % 3 === 0 || isLast) {
        dlog('info', 'GIF frame progress', { frame: i + 1, of: validCmps.length, totalFrames: frameCount });
      }

      if (doTransitions && actualTDur > 0 && !isLast) {
        const nextCanvas = renderCmpFrame(ref, validCmps[i + 1], w, h, frameNum);
        if (nextCanvas) {
          for (let k = 1; k < transitionSteps; k++) {
            if (abortGeneration) return { success: false, error: 'Aborted' };
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
        if (abortGeneration) return { success: false, error: 'Aborted' };
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

  dlog('info', 'Using mediabunny for video encoding', { format });
  showProgress('Initializing encoder...', 5);

  const ref = validCmps[0];

  const doTransitions = useTransitions && validCmps.length > 1;
  const tParams = doTransitions ? computeTransitionParams(tDur, durFirst, durMiddle, durLast, validCmps.length, loopGif) : null;
  const { actualTDur = 0, transitionSteps = 0, stepDur = 0, totalFrames: totalEstimatedFrames = validCmps.length } = tParams || {};

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = w;
  frameCanvas.height = h;

  const qualityVal = parseInt(mp4QualitySlider.value) || 70;
  const crf = Math.round(35 - (qualityVal / 100) * 17);
  const qualityMultiplier = (51 - crf) / 33;
  const baseBitrate = Math.round(w * h * 4 * qualityMultiplier);
  const bitrate = format === 'webm' ? Math.round(baseBitrate * 2.5) : baseBitrate;

  let outputFormat, mimeType;
  if (format === 'webm') {
    outputFormat = new WebMOutputFormat();
    mimeType = 'video/webm';
  } else {
    outputFormat = new Mp4OutputFormat();
    mimeType = format === 'mov' ? 'video/quicktime' : 'video/mp4';
  }

  const target = new BufferTarget();
  const output = new Output({ format: outputFormat, target });

  const videoSource = new CanvasSource(frameCanvas, {
    codec: format === 'webm' ? 'vp9' : 'avc',
    bitrate,
  });
  output.addVideoTrack(videoSource);

  let frameIdx = 0;
  let timestamp = 0;

  async function addFrame(canvas, duration) {
    const ctx = frameCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0);

    await videoSource.add(timestamp, duration);
    timestamp += duration;
    frameIdx++;

    const pct = 10 + Math.round((frameIdx / totalEstimatedFrames) * 80);
    showProgress(`Encoding frame ${frameIdx}/${totalEstimatedFrames}`, pct);
  }

  try {
    await output.start();
    dlog('info', 'Encoder started', { bitrate, codec: format === 'webm' ? 'vp9' : 'avc' });

    let frameNum = 1;
    let prevCanvas = null;

    for (let i = 0; i < validCmps.length; i++) {
      if (abortGeneration) {
        await output.finalize();
        return { success: false, error: 'Aborted' };
      }

      const isFirst = i === 0;
      const isLast = i === validCmps.length - 1;
      const rawDur = isFirst ? durFirst : isLast ? durLast : durMiddle;
      const holdDur = (doTransitions && actualTDur > 0 && !isLast) ? Math.max(0.01, rawDur - actualTDur) : rawDur;

      const canvas = isFirst
        ? renderRefFrame(ref, w, h, frameNum++)
        : renderCmpFrame(ref, validCmps[i], w, h, frameNum++);

      if (!canvas) continue;

      await addFrame(canvas, holdDur);

      if (doTransitions && actualTDur > 0 && !isLast) {
        const nextCanvas = renderCmpFrame(ref, validCmps[i + 1], w, h, frameNum);
        if (nextCanvas) {
          for (let k = 1; k < transitionSteps; k++) {
            if (abortGeneration) {
              await output.finalize();
              return { success: false, error: 'Aborted' };
            }
            const alpha = k / transitionSteps;
            const blended = blendFrames(canvas, nextCanvas, alpha, w, h, tType);
            await addFrame(blended, stepDur);
          }
        }
      }

      prevCanvas = canvas;

      if (i % 5 === 0 || isLast) {
        dlog('info', 'Frame progress', { frame: i + 1, of: validCmps.length, totalEncoded: frameIdx });
      }
    }

    if (loopGif && doTransitions && actualTDur > 0 && prevCanvas) {
      dlog('info', 'Adding loop transition frames...');
      const firstCanvas = renderRefFrame(ref, w, h, 1);
      for (let k = 1; k < transitionSteps; k++) {
        if (abortGeneration) {
          await output.finalize();
          return { success: false, error: 'Aborted' };
        }
        const alpha = k / transitionSteps;
        const blended = blendFrames(prevCanvas, firstCanvas, alpha, w, h, tType);
        await addFrame(blended, stepDur);
      }
    }

    showProgress('Finalizing video...', 95);
    await output.finalize();

    const videoData = target.buffer;
    dlog('info', 'Video encoded', {
      frames: frameIdx,
      bytes: videoData.byteLength,
      mb: Math.round(videoData.byteLength / 1024 / 1024 * 100) / 100,
      ms: Math.round(performance.now() - startTime)
    });

    lastOutputBlob = new Blob([videoData], { type: mimeType });
    lastOutputFormat = format;
    outputVideo.src = URL.createObjectURL(lastOutputBlob);
    outputVideo.loop = loopGif;
    outputVideo.style.display = 'block';
    outputVideo.play();
    outputGif.style.display = 'none';

    return { success: true, ms: Math.round(performance.now() - startTime) };
  } catch (err) {
    dlogError('Video encoding failed', err);
    return { success: false, error: err };
  }
}

async function generate() {
  // Abort any in-progress generation
  if (isGenerating) {
    dlog('info', 'Aborting previous generation');
    abortGeneration = true;
    // Wait a tick for abort to propagate
    await new Promise(r => setTimeout(r, 50));
  }

  abortGeneration = false;
  isGenerating = true;

  const format = outputFormatSelect.value;
  dlog('info', '=== GENERATE STARTED ===', { format });
  clearError();
  resetOutput();

  // Let browser repaint to show progress and hide old output
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const validCmps = comparisons.filter(c => c && c.img && c.img.naturalWidth);
  dlog('info', 'Valid images', { count: validCmps.length });
  if (validCmps.length < 2) {
    showError('Add at least 2 images');
    isGenerating = false;
    showIdle('Output will appear here');
    return;
  }

  const ref = validCmps[0];
  const widthInput = document.getElementById('output-width');
  const heightInput = document.getElementById('output-height');
  let w = parseInt(widthInput.value);
  let h = parseInt(heightInput.value);

  const natW = ref.img.naturalWidth;
  const natH = ref.img.naturalHeight;
  const aspectRatio = natW / natH;

  if (!w && !h) {
    const maxSize = format === 'gif' ? 640 : 1080;
    if (natW >= natH) {
      w = Math.min(natW, maxSize);
      h = Math.round(w / aspectRatio);
    } else {
      h = Math.min(natH, maxSize);
      w = Math.round(h * aspectRatio);
    }
    widthInput.placeholder = w;
    heightInput.placeholder = h;
  } else if (w && !h) {
    h = Math.round(w / aspectRatio);
  } else if (!w && h) {
    w = Math.round(h * aspectRatio);
  }
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
    isGenerating = false;
    if (result.error === 'Aborted') {
      dlog('info', 'Generation aborted');
      showIdle('Output will appear here');
    } else {
      showError('Encoding failed: ' + (result.error?.message || result.error));
      showIdle('Output will appear here');
    }
    return;
  }

  dlog('info', '=== GENERATE COMPLETE ===', {
    totalMs: Math.round(performance.now() - startTime),
    outputMB: Math.round(lastOutputBlob.size / 1024 / 1024 * 100) / 100
  });

  isGenerating = false;
  hideProgress();
  overlayCanvas.style.display = 'none';
  clearError();
  saveBtn.style.display = '';
  sectionHeader.classList.remove('generate-only');

  const sizeBytes = lastOutputBlob.size;
  const sizeText = sizeBytes >= 1024 * 1024
    ? (sizeBytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.round(sizeBytes / 1024) + ' KB';
  outputSizeLabel.textContent = `${w}x${h} · ${sizeText}`;
  outputSizeLabel.style.display = '';

  outputBox.classList.remove('empty');
  outputBox.style.aspectRatio = w + ' / ' + h;
  outputBox.style.maxHeight = h + 'px';

  outputBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function setupOutput() {
  errorBanner.addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });

  const _savedOutputFormat = localStorage.getItem('outputFormat');
  if (_savedOutputFormat) outputFormatSelect.value = _savedOutputFormat;

  const _savedWidth = localStorage.getItem('outputWidth');
  const _savedHeight = localStorage.getItem('outputHeight');
  if (_savedWidth) outputWidthInput.value = _savedWidth;
  if (_savedHeight) outputHeightInput.value = _savedHeight;
  outputWidthInput.addEventListener('change', () => localStorage.setItem('outputWidth', outputWidthInput.value));
  outputWidthInput.addEventListener('input', () => localStorage.setItem('outputWidth', outputWidthInput.value));
  outputHeightInput.addEventListener('change', () => localStorage.setItem('outputHeight', outputHeightInput.value));
  outputHeightInput.addEventListener('input', () => localStorage.setItem('outputHeight', outputHeightInput.value));

  const sizeHint = document.getElementById('size-hint');
  function updateLockButton() {
    sizeLockBtn.textContent = sizeLocked ? '\u{1F512}' : '\u{1F513}';
    sizeLockBtn.classList.toggle('locked', sizeLocked);
    sizeLockBtn.title = sizeLocked ? 'Unlock size' : 'Lock size';
    sizeHint.textContent = sizeLocked ? 'Size locked' : 'Auto-sized from first image';
  }
  updateLockButton();

  sizeLockBtn.addEventListener('click', () => {
    if (!sizeLocked) {
      const w = outputWidthInput.value.trim();
      const h = outputHeightInput.value.trim();
      if (!w && !h) return;
    }
    sizeLocked = !sizeLocked;
    localStorage.setItem('sizeLocked', sizeLocked);
    updateLockButton();
  });

  const gifOptimizeRow = document.getElementById('gif-optimize-row');
  function updateFormatOptionsVisibility() {
    const format = outputFormatSelect.value;
    const isVideo = ['mp4', 'webm', 'mov'].includes(format);
    const isGif = format === 'gif';
    mp4QualityRow.style.display = isVideo ? '' : 'none';
    gifOptionsRow.style.display = isGif ? '' : 'none';
    gifOptimizeRow.style.display = isGif ? '' : 'none';
  }
  updateFormatOptionsVisibility();

  outputFormatSelect.addEventListener('change', () => {
    localStorage.setItem('outputFormat', outputFormatSelect.value);
    updateFormatOptionsVisibility();
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
    const val = Math.max(0, Math.min(100, parseInt(mp4QualityVal.value) || 70));
    mp4QualityVal.value = val;
    mp4QualitySlider.value = val;
    localStorage.setItem('mp4Quality', val);
  });

  const _savedGifLossy = localStorage.getItem('gifLossy');
  if (_savedGifLossy) {
    gifLossySlider.value = _savedGifLossy;
    gifLossyVal.value = _savedGifLossy;
  }
  gifLossySlider.addEventListener('input', () => {
    gifLossyVal.value = gifLossySlider.value;
    localStorage.setItem('gifLossy', gifLossySlider.value);
  });
  gifLossyVal.addEventListener('input', () => {
    const val = Math.max(0, Math.min(100, parseInt(gifLossyVal.value) || 0));
    gifLossyVal.value = val;
    gifLossySlider.value = val;
    localStorage.setItem('gifLossy', val);
  });

  if (localStorage.getItem('gifDiff') !== null) {
    gifDiffToggle.checked = localStorage.getItem('gifDiff') === 'true';
  }
  gifDiffToggle.addEventListener('change', () => localStorage.setItem('gifDiff', gifDiffToggle.checked));

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
  firstFrameDuration.addEventListener('input', () => localStorage.setItem('firstFrameDuration', firstFrameDuration.value));
  middleFrameDuration.addEventListener('change', () => localStorage.setItem('middleFrameDuration', middleFrameDuration.value));
  middleFrameDuration.addEventListener('input', () => localStorage.setItem('middleFrameDuration', middleFrameDuration.value));
  lastFrameDuration.addEventListener('change', () => localStorage.setItem('lastFrameDuration', lastFrameDuration.value));
  lastFrameDuration.addEventListener('input', () => localStorage.setItem('lastFrameDuration', lastFrameDuration.value));

  const customDurationsToggle = document.getElementById('custom-durations-toggle');
  customDurationsToggle.checked = customDurationsActive;
  customDurationsToggle.addEventListener('change', () => {
    customDurationsActive = customDurationsToggle.checked;
    localStorage.setItem('customDurationsActive', customDurationsActive);
    if (customDurationsActive) {
      singleDurationRow.style.display = 'none';
      customDurationsPanel.style.display = '';
      const savedFirst = localStorage.getItem('firstFrameDuration');
      const savedMiddle = localStorage.getItem('middleFrameDuration');
      const savedLast = localStorage.getItem('lastFrameDuration');
      if (savedFirst) firstFrameDuration.value = savedFirst;
      if (savedMiddle) middleFrameDuration.value = savedMiddle;
      if (savedLast) lastFrameDuration.value = savedLast;
    } else {
      customDurationsPanel.style.display = 'none';
      singleDurationRow.style.display = '';
      firstFrameDuration.value = frameDurationInput.value;
      middleFrameDuration.value = frameDurationInput.value;
      lastFrameDuration.value = frameDurationInput.value;
    }
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
  transitionDurationInput.addEventListener('input', () => localStorage.setItem('transitionDuration', transitionDurationInput.value));

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

  saveBtn.addEventListener('click', async () => {
    if (!lastOutputBlob) return;
    const extMap = { gif: 'gif', mp4: 'mp4', webm: 'webm', mov: 'mov' };
    const mimeMap = { gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
    const ext = extMap[lastOutputFormat] || lastOutputFormat;
    const mime = mimeMap[lastOutputFormat] || 'application/octet-stream';
    const suffix = Math.random().toString(36).slice(2, 6);
    const filename = `posematcher_${suffix}.${ext}`;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile && navigator.share && navigator.canShare) {
      const file = new File([lastOutputBlob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(lastOutputBlob);
    a.download = filename;
    a.click();
  });
}

export function clearOutput() {
  lastOutputBlob = null;
  saveBtn.style.display = 'none';
  sectionHeader.classList.add('generate-only');
  outputSizeLabel.style.display = 'none';
  outputGif.style.display = 'none';
  outputGif.src = '';
  outputVideo.style.display = 'none';
  outputVideo.src = '';
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  clearError();
  outputBox.classList.add('empty');
  outputBox.style.aspectRatio = '';
  outputBox.style.maxHeight = '';
  showIdle('Output will appear here');
}

export function updateOutputSize(refImg) {
  if (sizeLocked) return;
  if (!refImg) return;

  const natW = refImg.naturalWidth;
  const natH = refImg.naturalHeight;
  if (!natW || !natH) return;

  const format = outputFormatSelect.value;
  const maxSize = format === 'gif' ? 640 : 1080;
  const aspectRatio = natW / natH;

  let w, h;
  if (natW >= natH) {
    w = Math.min(natW, maxSize);
    h = Math.round(w / aspectRatio);
  } else {
    h = Math.min(natH, maxSize);
    w = Math.round(h * aspectRatio);
  }

  outputWidthInput.value = w;
  outputHeightInput.value = h;
  localStorage.setItem('outputWidth', w);
  localStorage.setItem('outputHeight', h);
}

export function resetSizeLock() {
  sizeLocked = false;
  localStorage.removeItem('sizeLocked');
  sizeLockBtn.textContent = '\u{1F513}';
  sizeLockBtn.classList.remove('locked');
  sizeLockBtn.title = 'Lock size';
  document.getElementById('size-hint').textContent = 'Auto-sized from first image';
}

export function resetCustomDurations() {
  customDurationsActive = false;
}
