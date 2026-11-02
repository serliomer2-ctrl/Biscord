// Görsel efektler: glitch/matrix/hype mesajları, ekran sarsıntısı + konfeti, "puf" ile yok olan mesajlar, nadir mesajlar,
// sohbet yerçekimi kaosu, WPM nitro göstergesi, sessizlikte bozulan ekran, profil efektleri ve 8-bit profil müziği
import { ctx } from '../ctx.js';
import { esc, store } from '../util.js';

const low = () => !!document.documentElement.dataset.lowend;
const GLYPHS = 'アイウエオカキクケコｱｲｳｴｵ01$#@%&*+=<>?/\\|ΣΔΩ▓▒░█';

// ---------------------------------------------------------------- glitch / matrix mesajları
export function fxHTML(m) {
  const c = m.components;
  if (c?.type !== 'fx') return '';
  if (c.style === 'hype') return '<span class="hype-tag">💥 HYPE</span>';
  return `<span class="glitch-msg ${c.style === 'matrix' ? 'matrix' : ''}" data-text="${esc(m.content)}" title="Okumak için üzerine gel">${esc(scramble(m.content, 1))}</span>`;
}
function scramble(text, amount) {
  return [...text].map((ch) => (ch === ' ' || Math.random() > amount ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('');
}
setInterval(() => {
  if (low()) return;
  document.querySelectorAll('.glitch-msg').forEach((el) => {
    const t = el.dataset.text;
    if (el.matches(':hover')) { if (el.textContent !== t) el.textContent = t; return; }
    el.textContent = scramble(t, el.classList.contains('matrix') ? 0.85 : 0.55);
  });
}, 110);

// ---------------------------------------------------------------- hype: ekran sarsıntısı + konfeti + alev
export function screenShake(strength = 1) {
  if (low()) return;
  const app = document.getElementById('app');
  if (!app) return;
  app.style.setProperty('--shake', strength * 8 + 'px');
  app.classList.remove('quake');
  void app.offsetWidth;
  app.classList.add('quake');
  setTimeout(() => app.classList.remove('quake'), 1000);
}

export function confetti({ fire = false, count = 160 } = {}) {
  if (low()) return;
  const cv = document.createElement('canvas');
  cv.className = 'fx-canvas';
  cv.width = innerWidth;
  cv.height = innerHeight;
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  const colors = fire ? ['#ff4d00', '#ff9500', '#ffd000', '#ff2a00'] : ['#6c5ce7', '#2fbf71', '#f0b232', '#ec4b4b', '#e056a0', '#3d8bfd', '#fff'];
  const parts = [];
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? 0 : cv.width, y: fire ? cv.height : cv.height * 0.6,
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9), vy: -(8 + Math.random() * 12),
      s: 4 + Math.random() * 6, c: colors[i % colors.length], r: Math.random() * 6, vr: Math.random() * 0.3, life: 1,
    });
  }
  const t0 = performance.now();
  const loop = (t) => {
    g.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      if (fire) p.life -= 0.012;
      g.save(); g.globalAlpha = Math.max(0, p.life); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c;
      if (fire) { g.beginPath(); g.arc(0, 0, p.s, 0, 7); g.fill(); } else g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (t - t0 < 2600) requestAnimationFrame(loop); else cv.remove();
  };
  requestAnimationFrame(loop);
}

export function boom() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(120, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(30, ac.currentTime + 0.8);
    g.gain.setValueAtTime(0.5, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.9);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 1);
    setTimeout(() => ac.close(), 1200);
  } catch { /* ses yok */ }
}

// Canlı gelen mesajlara özel efektler
export function onLiveMessage(m) {
  if (m.components?.type === 'fx' && m.components.style === 'hype') { screenShake(1.4); confetti(); boom(); }
  if (m.rarity) setTimeout(() => document.querySelector(`[data-mid="${m.id}"]`)?.classList.add('rare-pop'), 50);
  ctx.resetIdleGlitch?.();
}

// ---------------------------------------------------------------- kendini imha eden mesajlar
export function expiryHTML(m) {
  if (!m.expires_at) return '';
  if (m.expires_at === -1) return `<span class="burn-tag" title="Biri okuduğunda patlar">🔥 okununca imha</span>`;
  return `<span class="burn-tag" data-expires="${m.expires_at}">💣 ${Math.max(0, Math.ceil((m.expires_at - Date.now()) / 1000))} sn</span>`;
}
setInterval(() => {
  document.querySelectorAll('[data-expires]').forEach((el) => {
    const s = Math.max(0, Math.ceil((+el.dataset.expires - Date.now()) / 1000));
    el.textContent = `💣 ${s} sn`;
    el.closest('.msg')?.classList.toggle('expiring', s <= 3);
  });
}, 250);

// Ekranda görünen "okununca imha" mesajlarını sunucuya bildir
const seenBurn = new Set();
export function checkBurnVisible(box) {
  if (!box || document.hidden) return;
  const r = box.getBoundingClientRect();
  box.querySelectorAll('.msg[data-burn]').forEach((el) => {
    const id = el.dataset.mid;
    if (seenBurn.has(id) || el.dataset.author === ctx.S.me.id) return;
    const e = el.getBoundingClientRect();
    if (e.bottom > r.top && e.top < r.bottom) { seenBurn.add(id); ctx.socket.emit('burn:seen', { message_id: id }); }
  });
}

// Silinen mesajı "puf" duman efektiyle kaldır
export function poof(el, done) {
  if (!el || low()) return done();
  const r = el.getBoundingClientRect();
  el.classList.add('poofing');
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('i');
    p.className = 'smoke';
    p.style.left = r.left + Math.random() * r.width + 'px';
    p.style.top = r.top + Math.random() * r.height + 'px';
    p.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
  setTimeout(done, 450);
}

// ---------------------------------------------------------------- nadir mesaj stilleri
export const RARITY = { gold: '🌟 Altın', rainbow: '🌈 Gökkuşağı', holo: '💎 Holografik' };
export const rarityBadge = (m) => (m.rarity ? `<span class="rare-badge ${m.rarity}" title="%1 şansla düşen nadir mesaj!">${RARITY[m.rarity]}</span>` : '');

// ---------------------------------------------------------------- sohbet yerçekimi kaosu (/gravity, /shake)
let chaos = null;
export function runChaos(kind) {
  const box = document.querySelector('#messages');
  if (!box) return;
  if (kind === 'reset') return resetChaos();
  if (kind === 'shake') { box.classList.remove('chat-shake'); void box.offsetWidth; box.classList.add('chat-shake'); setTimeout(() => box.classList.remove('chat-shake'), 1300); return; }
  if (low()) return ctx.toast('Ultra Hafif Mod açıkken fizik kapalı');
  resetChaos();
  const br = box.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'chaos-layer';
  box.parentElement.appendChild(layer);
  const bodies = [];
  [...box.querySelectorAll('.msg, .divider, .chat-start')].forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom < br.top || r.top > br.bottom || r.height < 4) return;
    const clone = el.cloneNode(true);
    clone.classList.add('chaos-body');
    clone.style.width = r.width + 'px';
    layer.appendChild(clone);
    bodies.push({ el: clone, x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height, vx: kind === 'zero' ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 2, vy: kind === 'zero' ? (Math.random() - 0.5) * 6 : 0, a: 0, va: (Math.random() - 0.5) * (kind === 'zero' ? 0.05 : 0.02) });
  });
  box.style.visibility = 'hidden';
  const W = br.width;
  const H = br.height;
  const grav = kind === 'zero' ? 0 : 0.6;
  let drag = null;
  layer.onpointerdown = (e) => {
    const b = bodies.find((x) => x.el === e.target.closest('.chaos-body'));
    if (!b) return;
    const lr = layer.getBoundingClientRect();
    drag = { b, ox: e.clientX - lr.left - b.x, oy: e.clientY - lr.top - b.y, lx: e.clientX, ly: e.clientY };
    layer.setPointerCapture(e.pointerId);
  };
  layer.onpointermove = (e) => {
    if (!drag) return;
    const lr = layer.getBoundingClientRect();
    drag.b.vx = (e.clientX - drag.lx) * 0.9;
    drag.b.vy = (e.clientY - drag.ly) * 0.9;
    drag.lx = e.clientX; drag.ly = e.clientY;
    drag.b.x = e.clientX - lr.left - drag.ox;
    drag.b.y = e.clientY - lr.top - drag.oy;
  };
  layer.onpointerup = () => { drag = null; };
  const btn = document.createElement('button');
  btn.className = 'btn chaos-fix';
  btn.textContent = '🧲 Sohbeti Düzelt';
  btn.onclick = () => resetChaos();
  layer.appendChild(btn);
  let raf;
  const step = () => {
    raf = requestAnimationFrame(step);
    for (const b of bodies) {
      if (drag?.b !== b) {
        b.vy += grav; b.x += b.vx; b.y += b.vy; b.a += b.va;
        if (b.y + b.h > H) { b.y = H - b.h; b.vy *= -0.35; b.vx *= 0.92; b.va *= 0.8; }
        if (b.y < 0) { b.y = 0; b.vy *= -0.6; }
        if (b.x < 0) { b.x = 0; b.vx *= -0.6; }
        if (b.x + b.w > W) { b.x = W - b.w; b.vx *= -0.6; }
      }
    }
    // kutuların üst üste binmesini engelle (basit yığılma)
    if (grav) {
      const sorted = [...bodies].sort((a, b) => b.y - a.y);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = sorted[i];
          const b = sorted[j];
          if (a.x < b.x + b.w * 0.9 && a.x + a.w * 0.9 > b.x && a.y + a.h > b.y && a.y < b.y) { a.y = b.y - a.h; a.vy = Math.min(0, a.vy) * 0.3; }
        }
      }
    }
    for (const b of bodies) b.el.style.transform = `translate(${b.x}px,${b.y}px) rotate(${b.a}rad)`;
  };
  step();
  chaos = { layer, box, raf: () => cancelAnimationFrame(raf) };
  chaos.timer = setTimeout(resetChaos, 90000);
}
export function resetChaos() {
  if (!chaos) return;
  chaos.raf();
  clearTimeout(chaos.timer);
  chaos.layer.remove();
  chaos.box.style.visibility = '';
  chaos = null;
}

// ---------------------------------------------------------------- WPM nitro göstergesi
export function attachWpm(ta, wrap) {
  if (!ta || !wrap || wrap.querySelector('.wpm')) return;
  const el = document.createElement('div');
  el.className = 'wpm';
  el.innerHTML = '<svg viewBox="0 0 60 36"><path d="M6 32 A24 24 0 0 1 54 32" class="wpm-arc"/><line x1="30" y1="32" x2="30" y2="12" class="wpm-needle"/></svg><b>0</b><small>WPM</small>';
  wrap.appendChild(el);
  const stamps = [];
  const needle = el.querySelector('.wpm-needle');
  const label = el.querySelector('b');
  let wpm = 0;
  ta.addEventListener('keydown', (e) => { if (e.key.length === 1) stamps.push(performance.now()); });
  const t = setInterval(() => {
    if (!ta.isConnected) return clearInterval(t);
    const now = performance.now();
    while (stamps.length && now - stamps[0] > 6000) stamps.shift();
    const span = stamps.length > 1 ? Math.max(1500, now - stamps[0]) : 6000;
    wpm = Math.round((stamps.length / 5) / (span / 60000));
    if (!ta.value) wpm = 0;
    label.textContent = wpm;
    needle.style.transform = `rotate(${Math.min(180, (wpm / 140) * 180) - 90}deg)`;
    const comp = ta.closest('.composer');
    comp?.classList.toggle('flame-1', wpm >= 60 && wpm < 80);
    comp?.classList.toggle('flame-2', wpm >= 80 && wpm < 100);
    comp?.classList.toggle('flame-3', wpm >= 100);
    el.classList.toggle('hot', wpm >= 100);
  }, 200);
  return () => wpm;
}
export function nitroLaunch(composer) {
  if (low() || !composer) return;
  composer.classList.add('nitro-launch');
  setTimeout(() => composer.classList.remove('nitro-launch'), 700);
  confetti({ fire: true, count: 90 });
  try {
    const ac = new AudioContext();
    const n = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ac.createBufferSource(); s.buffer = n;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, 0); f.frequency.exponentialRampToValueAtTime(3000, 0.5);
    const g = ac.createGain(); g.gain.value = 0.4;
    s.connect(f).connect(g).connect(ac.destination); s.start();
    setTimeout(() => ac.close(), 900);
  } catch { /* ses yok */ }
}

// ---------------------------------------------------------------- sessizlikte bozulan ekran
let lastActivity = Date.now();
export function resetIdleGlitch() {
  lastActivity = Date.now();
  document.documentElement.classList.remove('decay-1', 'decay-2', 'decay-3');
}
setInterval(() => {
  if (!store.get('idleGlitch', true) || low()) return;
  const idle = (Date.now() - lastActivity) / 60000;
  const lvl = idle > 12 ? 3 : idle > 7 ? 2 : idle > 3 ? 1 : 0;
  const root = document.documentElement;
  for (let i = 1; i <= 3; i++) root.classList.toggle('decay-' + i, lvl === i);
}, 5000);

// ---------------------------------------------------------------- profil çerçeveleri ve 8-bit müzik
export const FRAMES = { none: 'Yok', glitch: '⚡ Glitch', neon: '💡 Neon', fire: '🔥 Alev', rainbow: '🌈 Gökkuşağı', matrix: '🟩 Matrix' };
export const TUNES = { none: 'Müzik yok', adventure: '🗡️ Macera', dungeon: '🏰 Zindan', arcade: '🕹️ Atari', chill: '🌙 Sakin' };
export function profileFrameClass(u) {
  const fx = u?.profile_fx;
  return fx && fx.frame !== 'none' ? `pf pf-${fx.frame} ${fx.scanlines ? 'pf-scan' : ''}` : '';
}

const SONGS = {
  adventure: { bpm: 150, lead: 'square', notes: [72, 76, 79, 76, 77, 81, 84, 81, 79, 76, 72, 74, 76, 79, 76, 0], bass: [48, 48, 55, 55, 53, 53, 55, 55] },
  dungeon: { bpm: 110, lead: 'triangle', notes: [69, 0, 72, 71, 69, 0, 64, 0, 65, 0, 67, 65, 64, 62, 64, 0], bass: [45, 45, 41, 41, 43, 43, 40, 40] },
  arcade: { bpm: 170, lead: 'square', notes: [76, 76, 0, 76, 0, 72, 76, 0, 79, 0, 0, 0, 67, 0, 0, 0], bass: [48, 52, 55, 52, 43, 47, 50, 47] },
  chill: { bpm: 90, lead: 'sine', notes: [76, 0, 79, 0, 83, 0, 79, 0, 74, 0, 77, 0, 81, 0, 77, 0], bass: [52, 52, 50, 50, 48, 48, 50, 50] },
};
let tune = null;
export function playChiptune(name) {
  stopChiptune();
  const s = SONGS[name];
  if (!s || store.get('profileMusic', true) === false) return;
  const ac = new AudioContext();
  const master = ac.createGain();
  master.gain.value = 0.08;
  master.connect(ac.destination);
  const step = 60 / s.bpm / 2;
  const note = (midi, t, dur, type, vol) => {
    if (!midi) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const t0 = ac.currentTime + 0.05;
  for (let loop = 0; loop < 2; loop++) {
    s.notes.forEach((n, i) => note(n, t0 + (loop * 16 + i) * step, step * 0.9, s.lead, 0.6));
    s.bass.forEach((n, i) => note(n, t0 + (loop * 16 + i * 2) * step, step * 1.8, 'triangle', 0.8));
  }
  tune = ac;
  setTimeout(() => { if (tune === ac) stopChiptune(); }, (32 * step + 0.5) * 1000);
}
export function stopChiptune() { if (tune) { tune.close().catch(() => {}); tune = null; } }
