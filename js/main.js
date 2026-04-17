import { dbGet, dbAllKeys, dbClear } from './db.js';
import { storedPoses, comparisons, currentMode, setCurrentMode, selectedCmpIndex } from './state.js';
import { drawOverlayForRef, drawOverlayForCmp } from './draw.js';
import { closeModal, isModalOpen, getModalCmpEntry } from './modal.js';
import { setupReference, setUpdateClearAllVisibility as setRefClearAllCb } from './reference.js';
import { setupComparisons, addComparison, removeComparison, ensureCmpPoses, setUpdateClearAllVisibility as setCmpClearAllCb } from './comparisons.js';
import { setupOutput, clearOutput } from './output.js';

const clearAllBtn = document.getElementById('clear-all-btn');
const optionsDetails = document.getElementById('options-details');
const modeSelect = document.getElementById('mode-select');
const scoreThreshSlider = document.getElementById('score-thresh');
const scoreThreshVal = document.getElementById('score-thresh-val');
const kpThreshSlider = document.getElementById('kp-thresh');
const kpThreshVal = document.getElementById('kp-thresh-val');

let refApi = null;

function updateClearAllVisibility() {
  const hasRef = document.getElementById('reference-box').classList.contains('has-image');
  const hasCmp = comparisons.length > 0;
  clearAllBtn.style.display = (hasRef || hasCmp) ? '' : 'none';
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

  modeSelect.value = currentMode;
  modeSelect.addEventListener('change', async () => {
    setCurrentMode(modeSelect.value);
    if (currentMode === 'human') {
      if (refApi && refApi.ensurePoses) await refApi.ensurePoses();
      for (const entry of comparisons) await ensureCmpPoses(entry);
    }
    drawOverlayForRef();
    for (const entry of comparisons) drawOverlayForCmp(entry);
  });
}

function setupClearAll() {
  clearAllBtn.addEventListener('click', async () => {
    if (refApi) refApi.clear();
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

    if (keySet.has('ref')) {
      const blob = await dbGet('ref');
      const refMeta = keySet.has('ref_meta') ? await dbGet('ref_meta') : null;
      if (blob && refApi) refApi.loadBlob(blob, refMeta);
    }

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
  setRefClearAllCb(updateClearAllVisibility);
  setCmpClearAllCb(updateClearAllVisibility);

  initSettings();
  refApi = setupReference();
  setupComparisons();
  setupOutput();
  setupClearAll();
  setupKeyboardShortcuts();

  restore();
}

init();
