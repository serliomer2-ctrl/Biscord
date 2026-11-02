// Piksel Lobi: 8-bit karakterlerle dolaşılan oda + yakınlık sesi (yaklaştıkça ses açılır) + masada ortak ekran
import { ctx } from '../ctx.js';
import { esc, colorFor } from '../util.js';
import { registerActivity } from './activities.js';

const TW = 24;
const TH = 16;
const TILE = 32;
// masalar: [x, y, w, h] — etrafına oturanlar ortak ekranı görür
const TABLES = [[5, 5, 3, 2], [15, 5, 3, 2], [10, 11, 4, 2]];
const PLANTS = [[1, 1], [22, 1], [1, 14], [22, 14], [12, 1]];
const SOLID = (x, y) => x < 1 || y < 1 || x >= TW - 1 || y >= TH - 1 || TABLES.some(([tx, ty, w, h]) => x >= tx && x < tx + w && y >= ty && y < ty + h) || PLANTS.some(([px, py]) => Math.floor(x) === px && Math.floor(y) === py);
const tableAt = (x, y) => TABLES.findIndex(([tx, ty, w, h]) => x >= tx - 1.3 && x <= tx + w + 1.3 && y >= ty - 1.3 && y <= ty + h + 1.3);

registerActivity('lobby', { name: 'Piksel Lobi', emoji: '🏰', hidden: true }, (el, send) => {
  el.innerHTML = `<div class="lobby"><div class="lobby-main"><canvas id="lb-cv" width="${TW * TILE}" height="${TH * TILE}"></canvas>
      <div class="lobby-help">⬆⬇⬅➡ / WASD ile yürü • yere tıklayarak git • 1-5: emoji • Yakındakileri duyarsın, uzaklaştıkça ses kısılır • Masaya oturunca ortak ekran açılır</div></div>
    <aside class="lobby-side" id="lb-side"></aside></div>`;
  const cv = el.querySelector('#lb-cv');
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const side = el.querySelector('#lb-side');
  const people = new Map(); // uid -> {x,y,dir,tx,ty,emote,emoteAt}
  const keys = {};
  let target = null;
  let lastSent = 0;
  let raf = 0;
  let lastTable = -2;

  const meP = () => people.get(ctx.S.me.id);
  const onKey = (e, down) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }[e.code];
    if (k) { keys[k] = down; target = null; e.preventDefault(); }
    if (down && /^Digit[1-5]$/.test(e.code)) send({ cmd: 'emote', e: ['👋', '😂', '❤️', '🔥', '👍'][+e.code.slice(5) - 1] });
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    target = { x: ((e.clientX - r.left) / r.width) * TW, y: ((e.clientY - r.top) / r.height) * TH };
  });

  // ---- çizim
  const drawRoom = () => {
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < TW; x++) {
        const wall = x === 0 || y === 0 || x === TW - 1 || y === TH - 1;
        g.fillStyle = wall ? '#3b2f4a' : (x + y) % 2 ? '#4a3d2e' : '#524433';
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (wall) { g.fillStyle = '#2a2236'; g.fillRect(x * TILE, y * TILE + TILE - 6, TILE, 6); }
      }
    }
    g.fillStyle = '#6b2737';
    g.fillRect(9 * TILE, 8 * TILE, 6 * TILE, 2 * TILE); // halı
    TABLES.forEach(([x, y, w, h], i) => {
      g.fillStyle = '#7a4f2a'; g.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      g.fillStyle = '#9b6a3c'; g.fillRect(x * TILE + 4, y * TILE + 4, w * TILE - 8, h * TILE - 10);
      g.fillStyle = '#1f2a44'; g.fillRect((x + w / 2 - 0.6) * TILE, (y + 0.3) * TILE, 1.2 * TILE, 0.8 * TILE); // ekran
      g.fillStyle = '#5ad1ff'; g.fillRect((x + w / 2 - 0.5) * TILE, (y + 0.38) * TILE, TILE, 0.6 * TILE);
      g.fillStyle = '#fff'; g.font = 'bold 11px monospace'; g.textAlign = 'center';
      g.fillText(`MASA ${i + 1}`, (x + w / 2) * TILE, (y + h) * TILE - 3);
    });
    PLANTS.forEach(([x, y]) => {
      g.fillStyle = '#7a4f2a'; g.fillRect(x * TILE + 9, y * TILE + 18, 14, 12);
      g.fillStyle = '#2f9e5b'; g.fillRect(x * TILE + 6, y * TILE + 4, 20, 16);
      g.fillStyle = '#3fc072'; g.fillRect(x * TILE + 10, y * TILE + 2, 12, 8);
    });
  };
  const drawPerson = (uid, p) => {
    const px = p.x * TILE;
    const py = p.y * TILE;
    const c = colorFor(uid);
    const speaking = ctx.voice?.speaking.has(uid);
    const bob = speaking ? Math.sin(performance.now() / 90) * 2 : 0;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(px - 9, py + 12, 18, 4); // gölge
    g.fillStyle = c; g.fillRect(px - 8, py - 6 + bob, 16, 16); // gövde
    g.fillStyle = '#f2c79b'; g.fillRect(px - 7, py - 20 + bob, 14, 14); // kafa
    g.fillStyle = '#1b1b1b'; // gözler yöne göre
    const ex = p.dir === 'l' ? -4 : p.dir === 'r' ? 2 : -3;
    if (p.dir !== 'u') { g.fillRect(px + ex, py - 15 + bob, 3, 3); g.fillRect(px + ex + 5, py - 15 + bob, 3, 3); }
    g.fillStyle = c; g.fillRect(px - 8, py - 22 + bob, 16, 4); // saç
    g.fillStyle = '#222'; g.fillRect(px - 7, py + 10, 5, 4); g.fillRect(px + 2, py + 10, 5, 4); // ayaklar
    if (speaking) { g.strokeStyle = '#2fbf71'; g.lineWidth = 2; g.strokeRect(px - 11, py - 25 + bob, 22, 41); }
    g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'center';
    const name = ctx.displayName(uid, ctx.S.view.sid);
    const w = g.measureText(name).width + 8;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(px - w / 2, py - 40, w, 14);
    g.fillStyle = uid === ctx.S.me.id ? '#ffd84d' : '#fff'; g.fillText(name, px, py - 29);
    if (p.emote && performance.now() - p.emoteAt < 2500) { g.font = '20px serif'; g.fillText(p.emote, px, py - 46); }
  };

  // ---- hareket + yakınlık sesi (zamanlayıcıyla: sekme arka plandayken de çalışır)
  const move = () => {
    const m = meP();
    if (m) {
      let dx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
      let dy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
      if (target && !dx && !dy) {
        const tx = target.x - m.x;
        const ty = target.y - m.y;
        const d = Math.hypot(tx, ty);
        if (d < 0.15) target = null; else { dx = tx / d; dy = ty / d; }
      }
      if (dx || dy) {
        const len = Math.hypot(dx, dy) || 1;
        const sp = 0.09;
        const nx = m.x + (dx / len) * sp;
        const ny = m.y + (dy / len) * sp;
        if (!SOLID(nx, m.y)) m.x = nx;
        if (!SOLID(m.x, ny)) m.y = ny;
        m.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u';
        if (performance.now() - lastSent > 100) { lastSent = performance.now(); send({ cmd: 'move', x: m.x, y: m.y, dir: m.dir }); }
      }
    }
    // diğerlerini yumuşak hareket ettir
    for (const [uid, p] of people) {
      if (uid === ctx.S.me.id || p.tx == null) continue;
      p.x += (p.tx - p.x) * 0.25;
      p.y += (p.ty - p.y) * 0.25;
    }
    applyProximity();
  };
  const moveTimer = setInterval(move, 33);
  const draw = () => {
    raf = requestAnimationFrame(draw);
    drawRoom();
    [...people].sort((a, b) => a[1].y - b[1].y).forEach(([uid, p]) => drawPerson(uid, p));
  };
  raf = requestAnimationFrame(draw);

  let proxT = 0;
  function applyProximity() {
    if (performance.now() - proxT < 200) return;
    proxT = performance.now();
    const m = meP();
    if (!m || !ctx.voice) return;
    for (const [uid, p] of people) {
      if (uid === ctx.S.me.id) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      ctx.voice.setProximity(uid, Math.max(0, Math.min(1, 1 - (d - 2) / 7)));
    }
    const t = tableAt(m.x, m.y);
    if (t !== lastTable) { lastTable = t; drawSide(); }
  }

  function drawSide() {
    const m = meP();
    const t = m ? tableAt(m.x, m.y) : -1;
    const near = [...people].filter(([uid]) => uid !== ctx.S.me.id).map(([uid, p]) => ({ uid, d: m ? Math.hypot(p.x - m.x, p.y - m.y) : 99 })).sort((a, b) => a.d - b.d);
    let html = `<h4>👥 Odada ${people.size} kişi</h4>${near.map(({ uid, d }) => `<div class="lb-person"><b>${esc(ctx.displayName(uid, ctx.S.view.sid))}</b><span class="muted">${d < 2.5 ? '🔊 yakın' : d < 9 ? '🔉 duyuluyor' : '🔇 uzak'}</span></div>`).join('') || '<p class="muted">Yalnızsın… arkadaşlarını davet et!</p>'}`;
    if (t >= 0) {
      const atTable = [...people].filter(([, p]) => tableAt(p.x, p.y) === t).map(([uid]) => uid);
      const sharer = atTable.find((uid) => ctx.voice?.videoFor(uid));
      html += `<h4>🪑 Masa ${t + 1}</h4><div class="lb-screen">${sharer ? '<video autoplay playsinline muted id="lb-vid"></video>' : '<p class="muted">Ortak ekran boş — ekranını paylaşınca masadaki herkes görür.</p>'}</div>
        <button class="btn sm" id="lb-share">${ctx.voice?.videoKind === 'screen' ? '⏹ Paylaşımı durdur' : '🖥 Ekranımı paylaş'}</button>`;
      side.innerHTML = html;
      const v = side.querySelector('#lb-vid');
      if (v) { v.srcObject = ctx.voice.videoFor(sharer); v.play().catch(() => {}); v.ondblclick = () => v.requestFullscreen?.(); }
      side.querySelector('#lb-share').onclick = () => ctx.voice?.toggleScreen().then(() => setTimeout(drawSide, 400));
    } else side.innerHTML = html;
  }

  return {
    update(s) {
      people.clear();
      for (const [uid, p] of Object.entries(s.pos)) people.set(uid, { ...p, tx: p.x, ty: p.y });
      drawSide();
    },
    op(o) {
      if (o.cmd === 'move') {
        const p = people.get(o.uid);
        if (!p) { people.set(o.uid, { x: o.x, y: o.y, tx: o.x, ty: o.y, dir: o.dir }); drawSide(); return; }
        if (o.uid === ctx.S.me.id) return;
        Object.assign(p, { tx: o.x, ty: o.y, dir: o.dir });
      } else if (o.cmd === 'gone') { people.delete(o.uid); ctx.voice?.setProximity(o.uid, 1); drawSide(); }
      else if (o.cmd === 'emote') { const p = people.get(o.uid); if (p) { p.emote = o.e; p.emoteAt = performance.now(); } }
    },
    refresh: drawSide,
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(moveTimer);
      removeEventListener('keydown', kd);
      removeEventListener('keyup', ku);
      for (const uid of people.keys()) ctx.voice?.setProximity(uid, 1);
    },
  };
});
