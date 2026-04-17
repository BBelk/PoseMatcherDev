import { dbPut } from './db.js';

export const storedPoses = { ref: null, refCustomPoint: { x: 0.5, y: 0.5 } };
export let refSelectedPerson = 0;

export function setRefSelectedPerson(idx) {
  refSelectedPerson = idx;
}

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

export async function saveRefMeta() {
  try {
    await dbPut('ref_meta', {
      poses: storedPoses.ref,
      customPoint: storedPoses.refCustomPoint,
      selectedPerson: refSelectedPerson,
    });
  } catch (err) { console.error('Save ref meta failed:', err); }
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
