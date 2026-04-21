import { dbPut } from './db.js';

export const comparisons = [];
export let selectedCmpIndex = -1;

export function setSelectedCmpIndex(idx) {
  selectedCmpIndex = idx;
}

export let currentMode = localStorage.getItem('trackingMode') || 'custom';

export function setCurrentMode(mode) {
  currentMode = mode;
  localStorage.setItem('trackingMode', mode);
}

export async function saveCmpMeta(entry) {
  try {
    await dbPut(entry.dbKey + '_meta', {
      poses: entry.poses,
      customPoint: entry.customPoint,
      selectedPerson: entry.selectedPerson,
    });
  } catch (err) { console.error('Save cmp meta failed:', err); }
}
