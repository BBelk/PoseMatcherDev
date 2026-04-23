import { currentMode } from './state.js';

export function drawNoHumansBanner(ctx) {
  const text = 'No Human Detected';
  const bh = 15;
  const y = ctx.canvas.height - bh;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, y, ctx.canvas.width, bh);
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.fillStyle = '#ffd84a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, ctx.canvas.width / 2, y + bh / 2);
}

export function drawCustomPoint(ctx, pt, rect) {
  const cx = rect.offsetX + pt.x * rect.width;
  const cy = rect.offsetY + pt.y * rect.height;
  const r = 5;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 3, cy); ctx.lineTo(cx + r + 3, cy);
  ctx.moveTo(cx, cy - r - 3); ctx.lineTo(cx, cy + r + 3);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#6cf';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 3, cy); ctx.lineTo(cx + r + 3, cy);
  ctx.moveTo(cx, cy - r - 3); ctx.lineTo(cx, cy + r + 3);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();
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
