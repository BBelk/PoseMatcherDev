import { dbGet, dbAllKeys, dbClear } from './db.js';
import { comparisons, currentMode, setCurrentMode, selectedCmpIndex } from './state.js';
import { drawOverlayForCmp } from './draw.js';
import { closeModal, isModalOpen, getModalCmpEntry } from './modal.js';
import { setupComparisons, addComparison, removeComparison, ensureCmpPoses, setUpdateClearAllVisibility as setCmpClearAllCb, getComparisonOrder } from './comparisons.js';
import { setupOutput, clearOutput } from './output.js';
import { getDebugSessions, clearDebugLogs, formatLogsForCopy, dlog, dlogError } from './debug.js';

const clearAllBtn = document.getElementById('clear-all-btn');
const optionsDetails = document.getElementById('options-details');
const modeCustomRadio = document.getElementById('mode-custom');
const modeHumanRadio = document.getElementById('mode-human');
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
    scoreThreshVal.value = _savedScoreThresh;
  }
  const _savedKpThresh = localStorage.getItem('kpThresh');
  if (_savedKpThresh) {
    kpThreshSlider.value = _savedKpThresh;
    POSE_CONFIG.confidenceThreshold = parseFloat(_savedKpThresh);
    kpThreshVal.value = _savedKpThresh;
  }

  scoreThreshSlider.addEventListener('input', () => {
    POSE_CONFIG.scoreThreshold = parseFloat(scoreThreshSlider.value);
    scoreThreshVal.value = scoreThreshSlider.value;
    localStorage.setItem('scoreThresh', scoreThreshSlider.value);
  });
  scoreThreshVal.addEventListener('input', () => {
    const val = Math.max(0.01, Math.min(1, parseFloat(scoreThreshVal.value) || 0.3));
    scoreThreshSlider.value = val;
    POSE_CONFIG.scoreThreshold = val;
    localStorage.setItem('scoreThresh', val);
  });

  kpThreshSlider.addEventListener('input', () => {
    POSE_CONFIG.confidenceThreshold = parseFloat(kpThreshSlider.value);
    kpThreshVal.value = kpThreshSlider.value;
    localStorage.setItem('kpThresh', kpThreshSlider.value);
  });
  kpThreshVal.addEventListener('input', () => {
    const val = Math.max(0.01, Math.min(1, parseFloat(kpThreshVal.value) || 0.3));
    kpThreshSlider.value = val;
    POSE_CONFIG.confidenceThreshold = val;
    localStorage.setItem('kpThresh', val);
  });

  restoreDefaultsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Reset all UI elements
    document.getElementById('align-part').value = '0';
    document.getElementById('scale-toggle').checked = false;
    document.getElementById('scale-pair').value = 'shoulders';
    document.getElementById('rotate-toggle').checked = false;
    document.getElementById('rotate-pair').value = 'shoulders';
    const outputWidth = document.getElementById('output-width');
    const outputHeight = document.getElementById('output-height');
    const outputFormat = document.getElementById('output-format');
    outputWidth.value = '';
    outputWidth.placeholder = 'W';
    outputHeight.value = '';
    outputHeight.placeholder = 'H';
    outputFormat.value = 'gif';
    outputFormat.dispatchEvent(new Event('change'));
    document.getElementById('mp4-quality').value = '23';
    document.getElementById('mp4-quality-val').value = '23';
    document.getElementById('loop-toggle').checked = true;
    document.getElementById('frame-counter-toggle').checked = false;
    document.getElementById('frame-duration').value = '0.5';
    document.getElementById('first-frame-duration').value = '0.5';
    document.getElementById('middle-frame-duration').value = '0.5';
    document.getElementById('last-frame-duration').value = '0.5';
    document.getElementById('transition-toggle').checked = false;
    document.getElementById('transition-type').value = 'fade';
    document.getElementById('transition-duration').value = '0.25';
    scoreThreshSlider.value = '0.3';
    scoreThreshVal.value = '0.3';
    POSE_CONFIG.scoreThreshold = 0.3;
    kpThreshSlider.value = '0.3';
    kpThreshVal.value = '0.3';
    POSE_CONFIG.confidenceThreshold = 0.3;
    // Clear all localStorage settings
    localStorage.removeItem('scoreThresh');
    localStorage.removeItem('kpThresh');
    localStorage.removeItem('alignPart');
    localStorage.removeItem('scaleEnabled');
    localStorage.removeItem('scalePair');
    localStorage.removeItem('rotateEnabled');
    localStorage.removeItem('rotatePair');
    localStorage.removeItem('outputWidth');
    localStorage.removeItem('outputHeight');
    localStorage.removeItem('outputFormat');
    localStorage.removeItem('mp4Quality');
    localStorage.removeItem('loop');
    localStorage.removeItem('frameCounter');
    localStorage.removeItem('frameDuration');
    localStorage.removeItem('firstFrameDuration');
    localStorage.removeItem('middleFrameDuration');
    localStorage.removeItem('lastFrameDuration');
    localStorage.removeItem('customDurationsActive');
    localStorage.removeItem('transitionEnabled');
    localStorage.removeItem('transitionType');
    localStorage.removeItem('transitionDuration');
    updateRedetectBtn();
  });

  function updateModeVisibility() {
    const isHuman = modeHumanRadio.checked;
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

  if (currentMode === 'human') {
    modeHumanRadio.checked = true;
  } else {
    modeCustomRadio.checked = true;
  }
  updateModeVisibility();

  async function handleModeChange() {
    const newMode = modeHumanRadio.checked ? 'human' : 'custom';
    setCurrentMode(newMode);
    updateModeVisibility();
    if (currentMode === 'human') {
      for (const entry of comparisons) await ensureCmpPoses(entry);
    }
    for (const entry of comparisons) drawOverlayForCmp(entry);
  }

  modeCustomRadio.addEventListener('change', handleModeChange);
  modeHumanRadio.addEventListener('change', handleModeChange);
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
    const savedOrder = getComparisonOrder();

    const cmpKeys = keys.filter(k => {
      const s = String(k);
      return s.startsWith('cmp_') && !s.endsWith('_meta');
    }).sort((a, b) => {
      const ai = savedOrder.indexOf(String(a));
      const bi = savedOrder.indexOf(String(b));
      if (ai === -1 && bi === -1) return String(a).localeCompare(String(b));
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    for (const key of cmpKeys) {
      const blob = await dbGet(key);
      const meta = keySet.has(key + '_meta') ? await dbGet(key + '_meta') : null;
      if (blob) await addComparison(blob, key, meta);
    }
  } catch (err) {
    dlogError('Restore failed', err);
  }
}

function setupDebugPanel() {
  const toggle = document.getElementById('debug-toggle');
  const panel = document.getElementById('debug-panel');
  const content = document.getElementById('debug-content');

  // Only show debug toggle if ?debug or /debug in URL
  const hasDebugParam = location.search.includes('debug') || location.pathname.includes('debug');
  if (!hasDebugParam) {
    toggle.style.display = 'none';
    return;
  }
  const copyBtn = document.getElementById('debug-copy');
  const clearBtn = document.getElementById('debug-clear');
  const closeBtn = document.getElementById('debug-close');

  function renderSessions() {
    const sessions = getDebugSessions();
    content.innerHTML = '';

    if (!sessions.length) {
      content.innerHTML = '<p style="color:#666;padding:0.5rem">No logs yet</p>';
      return;
    }

    // Check if any crashed sessions
    const hasCrash = sessions.some(s => s.status === 'crashed');
    toggle.classList.toggle('has-crash', hasCrash);

    // Show sessions in reverse order (newest first)
    for (let i = sessions.length - 1; i >= 0; i--) {
      const session = sessions[i];
      const div = document.createElement('div');
      div.className = 'debug-session ' + session.status;

      const statusText = session.status === 'crashed' ? '💥 CRASHED' :
                         session.status === 'running' ? '🔄 Current' : '✓ Ended';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'debug-session-header';
      headerDiv.innerHTML = `<span>${new Date(session.start).toLocaleString()}</span><span>${statusText}</span>`;

      const logsDiv = document.createElement('div');
      logsDiv.className = 'debug-session-logs';
      logsDiv.style.display = i === sessions.length - 1 ? '' : 'none';

      for (const log of session.logs) {
        const logEl = document.createElement('div');
        logEl.className = 'debug-log ' + log.level;
        const time = (log.t / 1000).toFixed(2) + 's';
        let html = `<span class="time">${time}</span><span class="level">${log.level.toUpperCase()}</span> <span class="msg">${escapeHtml(log.msg)}</span>`;
        if (log.data) {
          html += `<div class="data">${escapeHtml(JSON.stringify(log.data))}</div>`;
        }
        logEl.innerHTML = html;
        logsDiv.appendChild(logEl);
      }

      headerDiv.addEventListener('click', () => {
        logsDiv.style.display = logsDiv.style.display === 'none' ? '' : 'none';
      });

      div.appendChild(headerDiv);
      div.appendChild(logsDiv);
      content.appendChild(div);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  toggle.addEventListener('click', () => {
    const isVisible = panel.style.display !== 'none';
    if (isVisible) {
      panel.style.display = 'none';
    } else {
      renderSessions();
      panel.style.display = '';
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  copyBtn.addEventListener('click', () => {
    const text = formatLogsForCopy();
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });

  clearBtn.addEventListener('click', () => {
    clearDebugLogs();
    renderSessions();
  });

  // Check for crashed sessions on load and pulse the button
  const sessions = getDebugSessions();
  const hasCrash = sessions.some(s => s.status === 'crashed');
  toggle.classList.toggle('has-crash', hasCrash);
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let newTheme;
    if (current === 'light') {
      newTheme = 'dark';
    } else if (current === 'dark') {
      newTheme = 'light';
    } else {
      newTheme = prefersDark ? 'light' : 'dark';
    }

    root.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

function setupMobileSteppers() {
  if (window.innerWidth > 640) return;

  const inputs = document.querySelectorAll('.setting-compact input[type="number"], .inline-sub input[type="number"]');
  inputs.forEach(input => {
    if (input.closest('.stepper-wrap')) return;

    const wrap = document.createElement('span');
    wrap.className = 'stepper-wrap';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'stepper-btn';
    minusBtn.textContent = '−';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'stepper-btn';
    plusBtn.textContent = '+';

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(minusBtn);
    wrap.appendChild(input);
    wrap.appendChild(plusBtn);

    const step = parseFloat(input.step) || 1;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);

    minusBtn.addEventListener('click', () => {
      let val = parseFloat(input.value) || 0;
      val = Math.max(isNaN(min) ? -Infinity : min, val - step);
      input.value = parseFloat(val.toFixed(10));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    plusBtn.addEventListener('click', () => {
      let val = parseFloat(input.value) || 0;
      val = Math.min(isNaN(max) ? Infinity : max, val + step);
      input.value = parseFloat(val.toFixed(10));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function init() {
  setCmpClearAllCb(updateClearAllVisibility);

  initSettings();
  setupComparisons();
  setupOutput();
  setupClearAll();
  setupKeyboardShortcuts();
  setupDebugPanel();
  setupThemeToggle();
  setupMobileSteppers();

  restore();

  dlog('info', 'App initialized');
}

init();
