import { drawCustomPoint } from './draw.js';

const personModal = document.getElementById('person-modal');
const modalCanvas = document.getElementById('modal-canvas');
const modalCloseBtn = document.getElementById('modal-close');

let modalCallback = null;
let modalCmpEntry = null;

export function closeModal() {
  personModal.style.display = 'none';
  modalCallback = null;
  modalCmpEntry = null;
  modalCanvas.onclick = null;
}

export function getModalCmpEntry() {
  return modalCmpEntry;
}

export function setModalCmpEntry(entry) {
  modalCmpEntry = entry;
}

modalCloseBtn.addEventListener('click', closeModal);
personModal.addEventListener('click', (e) => {
  if (e.target === personModal) closeModal();
});

export function openPersonModal(imgEl, poses, currentSelected, onSelect) {
  const multi = poses.length > 1;
  personModal.querySelector('h3').textContent = multi ? 'Select a person' : 'Inspect pose';
  personModal.querySelector('.modal-hint').textContent = multi ? 'Click a bounding box to select' : 'Click outside to close';
  personModal.style.display = '';
  modalCallback = onSelect;

  const maxW = window.innerWidth * 0.85;
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / imgEl.naturalWidth, maxH / imgEl.naturalHeight);
  const cw = Math.round(imgEl.naturalWidth * scale);
  const ch = Math.round(imgEl.naturalHeight * scale);
  modalCanvas.width = cw;
  modalCanvas.height = ch;

  const ctx = modalCanvas.getContext('2d');
  const rect = { offsetX: 0, offsetY: 0, width: cw, height: ch };

  function render(sel) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(imgEl, 0, 0, cw, ch);
    const multi = poses.length > 1;
    for (let i = 0; i < poses.length; i++) {
      drawSinglePose(ctx, poses[i].keypoints, rect, multi ? i : -1, multi && i === sel);
    }
  }

  render(currentSelected);

  const bounds = getPoseBounds(poses, rect);

  modalCanvas.onclick = (e) => {
    const r = modalCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (cw / r.width);
    const my = (e.clientY - r.top) * (ch / r.height);

    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (mx >= b.minX && mx <= b.maxX && my >= b.minY && my <= b.maxY) {
        render(i);
        if (modalCallback) modalCallback(i);
        return;
      }
    }
  };
}

export function openCustomPointModal(imgEl, currentPoint, onSelect) {
  personModal.querySelector('h3').textContent = 'Place custom point';
  personModal.querySelector('.modal-hint').textContent = 'Click anywhere to set the point';
  personModal.style.display = '';

  const maxW = window.innerWidth * 0.85;
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / imgEl.naturalWidth, maxH / imgEl.naturalHeight);
  const cw = Math.round(imgEl.naturalWidth * scale);
  const ch = Math.round(imgEl.naturalHeight * scale);
  modalCanvas.width = cw;
  modalCanvas.height = ch;

  const ctx = modalCanvas.getContext('2d');
  const rect = { offsetX: 0, offsetY: 0, width: cw, height: ch };
  let point = { x: currentPoint.x, y: currentPoint.y };

  function render() {
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(imgEl, 0, 0, cw, ch);
    drawCustomPoint(ctx, point, rect);
  }
  render();

  modalCanvas.onclick = (e) => {
    const r = modalCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (cw / r.width);
    const my = (e.clientY - r.top) * (ch / r.height);
    point = {
      x: Math.max(0, Math.min(1, mx / cw)),
      y: Math.max(0, Math.min(1, my / ch)),
    };
    render();
    onSelect(point);
  };
}

export function isModalOpen() {
  return personModal.style.display !== 'none';
}
