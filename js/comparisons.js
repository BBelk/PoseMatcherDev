import { dbPut, dbDelete } from './db.js';
import { readExifDate } from './exif.js';
import { comparisons, selectedCmpIndex, setSelectedCmpIndex, currentMode, saveCmpMeta } from './state.js';
import { drawOverlayForCmp } from './draw.js';
import { openPersonModal, openCustomPointModal, setModalCmpEntry } from './modal.js';

const compareGrid = document.getElementById('compare-grid');
const cmpFileInput = document.getElementById('cmp-file');
const imagesSection = document.getElementById('images-section');

let cmpIdCounter = 0;
let draggedEntry = null;
let dropTargetEntry = null;
let dropInsertAfter = false;

const dropIndicator = document.createElement('div');
dropIndicator.className = 'drop-indicator';

let updateClearAllVisibility = () => {};

export function setUpdateClearAllVisibility(fn) {
  updateClearAllVisibility = fn;
}

function updateCardNumbers() {
  comparisons.forEach((entry, i) => {
    const badge = entry.card.querySelector('.card-number');
    if (badge) badge.textContent = i + 1;
  });
}

function saveComparisonOrder() {
  const order = comparisons.map(e => e.dbKey);
  localStorage.setItem('cmpOrder', JSON.stringify(order));
}

export function getComparisonOrder() {
  try {
    return JSON.parse(localStorage.getItem('cmpOrder')) || [];
  } catch { return []; }
}

export async function ensureCmpPoses(entry) {
  if (entry.poses) return;
  if (!entry.img || !entry.img.naturalWidth) return;
  try {
    entry.poses = await estimatePoses(entry.img);
    entry.selectedPerson = 0;
    await saveCmpMeta(entry);
  } catch (err) {
    console.error('Comparison pose failed:', err);
  }
}

async function addMultipleComparisons(files) {
  for (const file of files) await addComparison(file);
}

function showDropIndicator(targetCard, insertAfter) {
  const refNode = insertAfter ? targetCard.nextSibling : targetCard;
  if (dropIndicator.parentNode === compareGrid && dropIndicator.nextSibling === refNode) return;
  compareGrid.insertBefore(dropIndicator, refNode);
}

function clearDropIndicators() {
  if (dropIndicator.parentNode) dropIndicator.parentNode.removeChild(dropIndicator);
  dropTargetEntry = null;
}

export async function addComparison(fileOrBlob, dbKey, restoredMeta) {
  const date = fileOrBlob.name ? await readExifDate(fileOrBlob) : null;

  const key = dbKey || ('cmp_' + Date.now() + '_' + (cmpIdCounter++));
  if (!dbKey) {
    const buf = await fileOrBlob.arrayBuffer();
    await dbPut(key, new Blob([buf], { type: fileOrBlob.type }));
  }

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

  const numBadge = document.createElement('div');
  numBadge.className = 'card-number';

  card.append(img, canvas, metaEl, clearBtn, numBadge);
  compareGrid.appendChild(card);

  const entry = { img, poses: null, date, card, dbKey: key, selectedPerson: 0, customPoint: { x: 0.5, y: 0.5 } };
  if (restoredMeta) {
    entry.poses = restoredMeta.poses || null;
    entry.selectedPerson = restoredMeta.selectedPerson || 0;
    entry.customPoint = restoredMeta.customPoint || { x: 0.5, y: 0.5 };
  }
  comparisons.push(entry);

  card.addEventListener('click', (e) => {
    if (e.target === clearBtn) return;
    const idx = comparisons.indexOf(entry);
    if (idx < 0) return;
    selectComparison(idx);

    const hasPoses = entry.poses && entry.poses.length > 0;
    const useCustomModal = currentMode === 'custom' || !hasPoses;

    console.log('Card click:', { currentMode, hasPoses, useCustomModal, posesCount: entry.poses?.length });

    setModalCmpEntry(entry);
    if (useCustomModal) {
      console.log('Opening custom point modal');
      openCustomPointModal(img, entry.customPoint, (pt) => {
        entry.customPoint = pt;
        drawOverlayForCmp(entry);
        saveCmpMeta(entry);
      });
    } else {
      console.log('Opening person modal');
      openPersonModal(img, entry.poses, entry.selectedPerson, (sel) => {
        entry.selectedPerson = sel;
        drawOverlayForCmp(entry);
        saveCmpMeta(entry);
      });
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = comparisons.indexOf(entry);
    if (idx >= 0) removeComparison(idx);
  });

  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    if (e.target === clearBtn) { e.preventDefault(); return; }
    draggedEntry = entry;
    dropTargetEntry = null;
    dropInsertAfter = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.setDragImage(card, card.clientWidth / 2, card.clientHeight / 2);
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedEntry = null;
    dropTargetEntry = null;
    clearDropIndicators();
  });
  card.addEventListener('dragover', (e) => {
    if (!draggedEntry || draggedEntry === entry) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const insertAfter = e.clientX > rect.left + rect.width / 2;
    dropTargetEntry = entry;
    dropInsertAfter = insertAfter;
    showDropIndicator(card, insertAfter);
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    if (!draggedEntry || draggedEntry === entry) return;
    reorderComparison(draggedEntry, entry, dropInsertAfter);
  });

  // Touch support for mobile reordering
  let touchTimeout = null;
  card.addEventListener('touchstart', (e) => {
    if (e.target === clearBtn) return;
    touchTimeout = setTimeout(() => {
      draggedEntry = entry;
      card.classList.add('dragging');
      compareGrid.classList.add('touch-dragging');
    }, 300);
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (!draggedEntry) return;
    e.preventDefault();
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetCard = target?.closest('.cmp-card');
    if (targetCard && targetCard !== card) {
      const targetEntry = comparisons.find(c => c.card === targetCard);
      if (targetEntry) {
        const rect = targetCard.getBoundingClientRect();
        dropInsertAfter = touch.clientX > rect.left + rect.width / 2;
        dropTargetEntry = targetEntry;
        showDropIndicator(targetCard, dropInsertAfter);
      }
    }
  }, { passive: false });
  card.addEventListener('touchend', () => {
    clearTimeout(touchTimeout);
    if (draggedEntry && dropTargetEntry && draggedEntry !== dropTargetEntry) {
      reorderComparison(draggedEntry, dropTargetEntry, dropInsertAfter);
    }
    card.classList.remove('dragging');
    compareGrid.classList.remove('touch-dragging');
    draggedEntry = null;
    dropTargetEntry = null;
    clearDropIndicators();
  });

  await new Promise((resolve) => {
    img.onload = async () => {
      canvas.width = card.clientWidth;
      canvas.height = card.clientHeight;
      if (!entry.poses && currentMode === 'human') {
        try {
          const poses = await estimatePoses(img);
          entry.poses = poses;
          entry.selectedPerson = 0;
          await saveCmpMeta(entry);
        } catch (err) {
          console.error('Comparison pose failed:', err);
        }
      } else if (!restoredMeta) {
        await saveCmpMeta(entry);
      }
      drawOverlayForCmp(entry);
      updateClearAllVisibility();
      updateCardNumbers();
      saveComparisonOrder();
      resolve();
    };
    img.onerror = resolve;
    img.src = URL.createObjectURL(fileOrBlob);
  });

  if (comparisons.length === 1) selectComparison(0);
}

export function selectComparison(index) {
  setSelectedCmpIndex(index);
  compareGrid.querySelectorAll('.cmp-card').forEach((c, i) => {
    c.classList.toggle('selected', i === index);
  });
}

export function removeComparison(index) {
  const entry = comparisons[index];
  if (!entry) return;
  const wasSelected = (selectedCmpIndex === index);
  entry.card.remove();
  dbDelete(entry.dbKey);
  dbDelete(entry.dbKey + '_meta');
  comparisons.splice(index, 1);
  updateClearAllVisibility();
  updateCardNumbers();
  saveComparisonOrder();
  if (wasSelected) {
    setSelectedCmpIndex(-1);
    if (comparisons.length > 0) {
      selectComparison(Math.min(index, comparisons.length - 1));
    }
  } else if (selectedCmpIndex > index) {
    setSelectedCmpIndex(selectedCmpIndex - 1);
    selectComparison(selectedCmpIndex);
  }
}

function reorderComparison(srcEntry, targetEntry, insertAfter) {
  const srcIdx = comparisons.indexOf(srcEntry);
  let targetIdx = comparisons.indexOf(targetEntry);
  if (srcIdx < 0 || targetIdx < 0 || srcEntry === targetEntry) return;

  const selEntry = (selectedCmpIndex >= 0) ? comparisons[selectedCmpIndex] : null;

  comparisons.splice(srcIdx, 1);
  targetIdx = comparisons.indexOf(targetEntry);
  const insertIdx = insertAfter ? targetIdx + 1 : targetIdx;
  comparisons.splice(insertIdx, 0, srcEntry);

  const refNode = insertAfter ? targetEntry.card.nextSibling : targetEntry.card;
  compareGrid.insertBefore(srcEntry.card, refNode);

  if (selEntry) {
    const newSelIdx = comparisons.indexOf(selEntry);
    setSelectedCmpIndex(-1);
    if (newSelIdx >= 0) selectComparison(newSelIdx);
  }
  updateCardNumbers();
  saveComparisonOrder();
}

export function getSelectedComparison() {
  if (selectedCmpIndex < 0) return null;
  return comparisons[selectedCmpIndex] || null;
}

export function setupComparisons() {
  cmpFileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    cmpFileInput.value = '';
    setTimeout(() => addMultipleComparisons(files), 0);
  });

  imagesSection.addEventListener('dragover', (e) => {
    if (draggedEntry) return;
    e.preventDefault();
    imagesSection.classList.add('dragover');
  });

  imagesSection.addEventListener('dragleave', () => {
    imagesSection.classList.remove('dragover');
  });

  imagesSection.addEventListener('drop', (e) => {
    if (draggedEntry) return;
    e.preventDefault();
    imagesSection.classList.remove('dragover');
    addMultipleComparisons(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  });

  compareGrid.addEventListener('dragover', (e) => {
    if (!draggedEntry) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  compareGrid.addEventListener('drop', (e) => {
    if (!draggedEntry) return;
    e.preventDefault();
    const target = dropTargetEntry;
    const after = dropInsertAfter;
    clearDropIndicators();
    if (target && target !== draggedEntry) {
      reorderComparison(draggedEntry, target, after);
    }
  });
}
