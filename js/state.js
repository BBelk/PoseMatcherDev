import { dbPut } from './db.js';
import { dlogError } from './debug.js';

export const comparisons = [];
export let selectedCmpIndex = -1;

export function setSelectedCmpIndex(idx) {
  selectedCmpIndex = idx;
}

export let currentMode = localStorage.getItem('trackingMode') || 'human';

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
  } catch (err) { dlogError('Save meta failed', err); }
}
