import { storedPoses, refSelectedPerson, currentMode } from './state.js';

export function drawNoHumansBanner(ctx) {
  const text = 'No Human Detected';
  const bh = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, ctx.canvas.width, bh);
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = '#ffd84a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, ctx.canvas.width / 2, bh / 2);
}

export function drawCustomPoint(ctx, pt, rect) {
  const cx = rect.offsetX + pt.x * rect.width;
  const cy = rect.offsetY + pt.y * rect.height;
  const r = 9;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 5, cy); ctx.lineTo(cx + r + 5, cy);
  ctx.moveTo(cx, cy - r - 5); ctx.lineTo(cx, cy + r + 5);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6cf';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 5, cy); ctx.lineTo(cx + r + 5, cy);
  ctx.moveTo(cx, cy - r - 5); ctx.lineTo(cx, cy + r + 5);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
}

export function drawOverlayForRef() {
  const box = document.getElementById('reference-box');
  if (!box.classList.contains('has-image')) return;
  const canvas = document.getElementById('ref-canvas');
  const img = document.getElementById('ref-img');
  canvas.width = box.clientWidth;
  canvas.height = box.clientHeight;
  const rect = getDisplayRect(img.naturalWidth, img.naturalHeight, box);
  const ctx = canvas.getContext('2d');
  if (currentMode === 'custom') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCustomPoint(ctx, storedPoses.refCustomPoint, rect);
  } else if (storedPoses.ref && storedPoses.ref.length) {
    drawPoses(canvas, storedPoses.ref, rect, refSelectedPerson);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentMode === 'human' && storedPoses.ref) {
      drawCustomPoint(ctx, storedPoses.refCustomPoint, rect);
      drawNoHumansBanner(ctx);
    }
  }
}

export function drawOverlayForCmp(entry) {
  const canvas = entry.card.querySelector('canvas');
  canvas.width = entry.card.clientWidth;
  canvas.height = entry.card.clientHeight;
  const rect = getDisplayRect(entry.img.naturalWidth, entry.img.naturalHeight, entry.card);
  const ctx = canvas.getContext('2d');
  if (currentMode === 'custom') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCustomPoint(ctx, entry.customPoint, rect);
  } else if (entry.poses && entry.poses.length) {
    drawPoses(canvas, entry.poses, rect, entry.selectedPerson);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentMode === 'human' && entry.poses) {
      drawCustomPoint(ctx, entry.customPoint, rect);
      drawNoHumansBanner(ctx);
    }
  }
}
