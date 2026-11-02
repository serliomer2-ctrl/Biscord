// Ses tabanlı fizik odası: ses kanalının arka planındaki toplar/emojiler, konuşanın karesinden sesi kadar güçlü fırlatılır
import { ctx } from '../ctx.js';
import { store } from '../util.js';

let run = null;
const ITEMS = ['⚽', '🏀', '🎾', '🍩', '🧸', '🎈', '🍕', '⭐', '🥑', '💎', '🐸', '🎲'];

export const bouncerOn = () => store.get('bouncer', false) && !document.documentElement.dataset.lowend;
export function toggleBouncer() { store.set('bouncer', !store.get('bouncer', false)); mountBouncer(); }

export function mountBouncer() {
  const stage = document.querySelector('#stage');
  if (run && (!stage || run.stage !== stage || !bouncerOn())) { run.stop(); run = null; }
  if (run && !run.cv.isConnected) { stage.prepend(run.cv); return; } // sahne yeniden çizildi; fizik durumu korunur
  if (!stage || !bouncerOn() || run) return;
  const cv = document.createElement('canvas');
  cv.className = 'bouncer';
  stage.prepend(cv);
  const g = cv.getContext('2d');
  const bodies = ITEMS.map((e, i) => ({ e, x: 60 + i * 50, y: 40 + (i % 3) * 30, vx: 0, vy: 0, r: 22, a: 0, va: 0 }));
  // konuşan kişilerin avatarları da fiziksel nesne olarak sahneye düşer
  const avatars = new Map();
  let raf;
  const step = () => {
    raf = requestAnimationFrame(step);
    const W = (cv.width = stage.clientWidth);
    const H = (cv.height = stage.clientHeight);
    const sr = stage.getBoundingClientRect();
    // her konuşanın karesinden itiş
    const v = ctx.voice;
    for (const tile of stage.querySelectorAll('.tile[data-uid]')) {
      const uid = tile.dataset.uid;
      const lvl = v?.levels.get(uid) || 0;
      if (!avatars.has(uid)) {
        const img = tile.querySelector('.avatar img')?.src;
        const b = { uid, img: img ? Object.assign(new Image(), { src: img }) : null, letter: (ctx.displayName(uid) || '?')[0], color: getComputedStyle(tile.querySelector('.avatar') || tile).backgroundColor, x: Math.random() * W, y: 20, vx: 0, vy: 0, r: 26, a: 0, va: 0, avatar: true };
        avatars.set(uid, b);
      }
      if (lvl < 0.04) continue;
      const tr = tile.getBoundingClientRect();
      const cx = tr.left - sr.left + tr.width / 2;
      const cy = tr.top - sr.top + tr.height / 2;
      const power = Math.min(3, (lvl - 0.03) * 45);
      for (const b of [...bodies, ...avatars.values()]) {
        if (b.uid === uid) continue;
        const dx = b.x - cx;
        const dy = b.y - cy;
        const d = Math.max(30, Math.hypot(dx, dy));
        if (d > 520) continue;
        const f = (power * 260) / d;
        b.vx += (dx / d) * f;
        b.vy += (dy / d) * f - power * 0.6;
        b.va += (Math.random() - 0.5) * 0.1 * power;
      }
    }
    for (const uid of avatars.keys()) if (!stage.querySelector(`.tile[data-uid="${uid}"]`)) avatars.delete(uid);
    g.clearRect(0, 0, W, H);
    const all = [...bodies, ...avatars.values()];
    for (const b of all) {
      b.vy += 0.45; b.vx *= 0.995; b.x += b.vx; b.y += b.vy; b.a += b.va; b.va *= 0.98;
      if (b.y > H - b.r) { b.y = H - b.r; b.vy *= -0.55; b.vx *= 0.9; }
      if (b.y < b.r) { b.y = b.r; b.vy *= -0.5; }
      if (b.x < b.r) { b.x = b.r; b.vx *= -0.7; }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx *= -0.7; }
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d > 0 && d < min) {
          const nx = dx / d;
          const ny = dy / d;
          const push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) { a.vx += rel * nx * 0.8; a.vy += rel * ny * 0.8; b.vx -= rel * nx * 0.8; b.vy -= rel * ny * 0.8; }
        }
      }
    }
    for (const b of all) {
      g.save(); g.translate(b.x, b.y); g.rotate(b.a);
      if (b.avatar) {
        g.beginPath(); g.arc(0, 0, b.r, 0, 7); g.closePath();
        if (b.img?.complete && b.img.naturalWidth) { g.save(); g.clip(); g.drawImage(b.img, -b.r, -b.r, b.r * 2, b.r * 2); g.restore(); }
        else { g.fillStyle = b.color || '#6c5ce7'; g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.letter.toUpperCase(), 0, 1); }
        if (v?.speaking.has(b.uid)) { g.strokeStyle = '#2fbf71'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, b.r + 2, 0, 7); g.stroke(); }
      } else { g.font = '36px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.e, 0, 2); }
      g.restore();
    }
  };
  step();
  run = { stage, cv, stop: () => { cancelAnimationFrame(raf); cv.remove(); } };
}
