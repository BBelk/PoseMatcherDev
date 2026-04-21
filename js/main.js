import { dbGet, dbAllKeys, dbClear } from './db.js';
import { comparisons, currentMode, setCurrentMode, selectedCmpIndex } from './state.js';
import { drawOverlayForCmp } from './draw.js';
import { closeModal, isModalOpen, getModalCmpEntry } from './modal.js';
import { setupComparisons, addComparison, removeComparison, ensureCmpPoses, setUpdateClearAllVisibility as setCmpClearAllCb } from './comparisons.js';
import { setupOutput, clearOutput } from './output.js';

const clearAllBtn = document.getElementById('clear-all-btn');
const optionsDetails = document.getElementById('options-details');
const modeSelect = document.getElementById('mode-select');
const scoreThreshSlider = document.getElementById('score-thresh');
const scoreThreshVal = document.getElementById('score-thresh-val');
const kpThreshSlider = document.getElementById('kp-thresh');
const kpThreshVal = document.getElementById('kp-thresh-val');
const restoreDefaultsBtn = document.getElementById('restore-defaults-btn');
const humanPoseOptions = document.getElementById('human-pose-options');
const detectionGroup = document.getElementById('detection-group');
const redetectBtn = document.getElementById('redetect-btn');

let lastDetectionSettings = { score: '0.3', kp: '0.3' };

function updateClearAllVisibility() {
  clearAllBtn.style.display = comparisons.length > 0 ? '' : 'none';
}

function initSettings() {
  if (localStorage.getItem('optionsOpen') === 'true') optionsDetails.open = true;
  optionsDetails.addEventListener('toggle', () => {
    localStorage.setItem('optionsOpen', optionsDetails.open);
  });

  const _savedScoreThresh = localStorage.getItem('scoreThresh');
  if (_savedScoreThresh) {
    scoreThreshSlider.value = _savedScoreThresh;
    POSE_CONFIG.scoreThreshold = parseFloat(_savedScoreThresh);
    scoreThreshVal.textContent = _savedScoreThresh;
  }
  const _savedKpThresh = localStorage.getItem('kpThresh');
  if (_savedKpThresh) {
    kpThreshSlider.value = _savedKpThresh;
    POSE_CONFIG.confidenceThreshold = parseFloat(_savedKpThresh);
    kpThreshVal.textContent = _savedKpThresh;
  }

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

  restoreDefaultsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('align-part').value = '0';
    document.getElementById('scale-toggle').checked = false;
    document.getElementById('rotate-toggle').checked = false;
    document.getElementById('output-width').value = '';
    document.getElementById('output-height').value = '';
    document.getElementById('output-format').value = 'gif';
    document.getElementById('loop-toggle').checked = true;
    document.getElementById('frame-counter-toggle').checked = false;
    document.getElementById('frame-duration').value = '0.5';
    document.getElementById('transition-toggle').checked = false;
    document.getElementById('transition-duration').value = '0.25';
    scoreThreshSlider.value = '0.3';
    scoreThreshVal.textContent = '0.3';
    POSE_CONFIG.scoreThreshold = 0.3;
    kpThreshSlider.value = '0.3';
    kpThreshVal.textContent = '0.3';
    POSE_CONFIG.confidenceThreshold = 0.3;
    localStorage.removeItem('scoreThresh');
    localStorage.removeItem('kpThresh');
    updateRedetectBtn();
  });

  function updateModeVisibility() {
    const isHuman = modeSelect.value === 'human';
    humanPoseOptions.style.display = isHuman ? '' : 'none';
    detectionGroup.style.display = isHuman ? '' : 'none';
  }

  function updateRedetectBtn() {
    const changed = scoreThreshSlider.value !== lastDetectionSettings.score ||
                    kpThreshSlider.value !== lastDetectionSettings.kp;
    redetectBtn.disabled = !changed;
  }

  scoreThreshSlider.addEventListener('input', updateRedetectBtn);
  kpThreshSlider.addEventListener('input', updateRedetectBtn);

  redetectBtn.addEventListener('click', async () => {
    redetectBtn.disabled = true;
    redetectBtn.textContent = 'Detecting...';
    for (const entry of comparisons) {
      entry.poses = null;
      await ensureCmpPoses(entry);
      drawOverlayForCmp(entry);
    }
    lastDetectionSettings = { score: scoreThreshSlider.value, kp: kpThreshSlider.value };
    redetectBtn.textContent = 'Re-detect All';
  });

  modeSelect.value = currentMode;
  updateModeVisibility();

  modeSelect.addEventListener('change', async () => {
    setCurrentMode(modeSelect.value);
    updateModeVisibility();
    if (currentMode === 'human') {
      for (const entry of comparisons) await ensureCmpPoses(entry);
    }
    for (const entry of comparisons) drawOverlayForCmp(entry);
  });
}

function setupClearAll() {
  clearAllBtn.addEventListener('click', async () => {
    for (const c of comparisons) c.card.remove();
    comparisons.length = 0;
    clearOutput();
    await dbClear();
    updateClearAllVisibility();
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isModalOpen()) {
        closeModal();
        e.preventDefault();
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

      if (isModalOpen()) {
        const modalEntry = getModalCmpEntry();
        if (modalEntry) {
          const idx = comparisons.indexOf(modalEntry);
          if (idx >= 0) {
            closeModal();
            removeComparison(idx);
            e.preventDefault();
          }
        }
        return;
      }

      if (selectedCmpIndex >= 0 && selectedCmpIndex < comparisons.length) {
        removeComparison(selectedCmpIndex);
        e.preventDefault();
      }
    }
  });
}

async function restore() {
  try {
    const keys = await dbAllKeys();
    const keySet = new Set(keys.map(String));

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
}

function init() {
  setCmpClearAllCb(updateClearAllVisibility);

  initSettings();
  setupComparisons();
  setupOutput();
  setupClearAll();
  setupKeyboardShortcuts();

  restore();
}

init();
