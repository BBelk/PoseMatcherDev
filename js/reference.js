import { dbPut, dbDelete } from './db.js';
import { readExifDate } from './exif.js';
import { storedPoses, refSelectedPerson, setRefSelectedPerson, currentMode, saveRefMeta } from './state.js';
import { drawOverlayForRef } from './draw.js';
import { openPersonModal, openCustomPointModal } from './modal.js';

let updateClearAllVisibility = () => {};

export function setUpdateClearAllVisibility(fn) {
  updateClearAllVisibility = fn;
}

export function setupReference() {
  const box = document.getElementById('reference-box');
  const img = document.getElementById('ref-img');
  const fileInput = document.getElementById('ref-file');
  const canvas = document.getElementById('ref-canvas');
  const status = document.getElementById('ref-status');
  const meta = document.getElementById('ref-meta');
  const clearBtn = box.querySelector('.clear-btn');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImage(file);
  });

  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
  box.addEventListener('dragleave', () => { box.classList.remove('dragover'); });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  box.addEventListener('click', (e) => {
    if (e.target.closest('.upload-label') || e.target === fileInput || e.target === clearBtn) return;
    if (!box.classList.contains('has-image')) {
      fileInput.click();
    } else if (currentMode === 'custom' || (storedPoses.ref && !storedPoses.ref.length)) {
      openCustomPointModal(img, storedPoses.refCustomPoint, (pt) => {
        storedPoses.refCustomPoint = pt;
        drawOverlayForRef();
        saveRefMeta();
      });
    } else if (storedPoses.ref && storedPoses.ref.length > 1) {
      openPersonModal(img, storedPoses.ref, refSelectedPerson, (idx) => {
        setRefSelectedPerson(idx);
        drawOverlayForRef();
        saveRefMeta();
      });
    }
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearRef();
  });

  function clearRef() {
    img.src = '';
    box.classList.remove('has-image');
    fileInput.value = '';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    status.textContent = '';
    meta.textContent = '';
    storedPoses.ref = null;
    storedPoses.refCustomPoint = { x: 0.5, y: 0.5 };
    setRefSelectedPerson(0);
    dbDelete('ref');
    dbDelete('ref_meta');
    updateClearAllVisibility();
  }

  function loadImage(file) {
    readExifDate(file).then(date => { meta.textContent = date || ''; });
    file.arrayBuffer().then(buf => dbPut('ref', new Blob([buf], { type: file.type })));
    storedPoses.ref = null;
    storedPoses.refCustomPoint = { x: 0.5, y: 0.5 };
    setRefSelectedPerson(0);
    loadBlob(file, null);
  }

  function loadBlob(blob, restoredMeta) {
    const url = URL.createObjectURL(blob);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      box.classList.add('has-image');
      canvas.width = box.clientWidth;
      canvas.height = box.clientHeight;
      const maxDim = 800;
      let outW = img.naturalWidth;
      let outH = img.naturalHeight;
      if (outW > maxDim || outH > maxDim) {
        const scale = maxDim / Math.max(outW, outH);
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
      }
      document.getElementById('output-width').value = outW;
      document.getElementById('output-height').value = outH;

      if (restoredMeta) {
        storedPoses.ref = restoredMeta.poses || null;
        storedPoses.refCustomPoint = restoredMeta.customPoint || { x: 0.5, y: 0.5 };
        setRefSelectedPerson(restoredMeta.selectedPerson || 0);
      }

      updateClearAllVisibility();

      if (!storedPoses.ref && currentMode === 'human') {
        await runDetection();
      } else {
        drawOverlayForRef();
        if (!restoredMeta) await saveRefMeta();
      }
    };
    img.src = url;
  }

  async function runDetection() {
    status.textContent = 'Detecting pose...';
    try {
      const poses = await estimatePoses(img);
      storedPoses.ref = poses;
      setRefSelectedPerson(0);
      drawOverlayForRef();
      await saveRefMeta();
      const total = poses.length;
      status.textContent = total + ' person' + (total !== 1 ? 's' : '') + ' detected';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      console.error('Pose detection failed:', err);
      status.textContent = 'Model error — see console';
    }
  }

  window.addEventListener('resize', () => {
    if (!box.classList.contains('has-image')) return;
    drawOverlayForRef();
  });

  return {
    clear: clearRef,
    loadBlob,
    ensurePoses: async () => {
      if (storedPoses.ref) return;
      if (!img.naturalWidth) return;
      await runDetection();
    },
  };
}
