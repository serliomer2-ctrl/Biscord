// Ortak etkinlikler: Çizim Tahtası, Sanal Masaüstü, Ortak Kod Editörü, Beat Yapıcı, Hacker Düellosu
import { ctx } from '../ctx.js';
import { esc, avatar, colorFor } from '../util.js';
import { registerActivity } from './activities.js';
import { runCode } from './coderun.js';

const me = () => ctx.S.me.id;
const nameOf = (uid) => esc(ctx.displayName(uid, ctx.S.view.sid !== '@me' ? ctx.S.view.sid : null));
const rid = () => Math.random().toString(36).slice(2, 12);
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]');

// ================================================================ Çizim Tahtası
registerActivity('whiteboard', { name: 'Çizim Tahtası', emoji: '🎨', desc: 'Herkes aynı anda çizer: taktik, karalama, meme.', players: 'Sınırsız' }, (el, send) => {
  const COLORS = ['#ffffff', '#111111', '#ec4b4b', '#f0b232', '#2fbf71', '#3d8bfd', '#a78bfa', '#e056a0', '#14b8a6', '#f97316'];
  let color = '#ffffff';
  let size = 4;
  let tool = 'pen';
  let strokes = [];
  const live = new Map(); // başkalarının o an çizdiği parçalar
  el.innerHTML = `<div class="wb">
    <div class="wb-tools">
      ${['pen', 'erase', 'text'].map((t) => `<button data-tool="${t}" class="${t === tool ? 'on' : ''}">${{ pen: '✏️ Kalem', erase: '🧽 Silgi', text: '🔤 Yazı' }[t]}</button>`).join('')}
      <span class="wb-sep"></span>${COLORS.map((c) => `<button class="wb-color ${c === color ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
      <input type="color" id="wb-c" value="#ff00ff" title="Özel renk">
      <input type="range" id="wb-s" min="1" max="30" value="${size}" title="Kalınlık">
      <span class="grow"></span>
      <button data-act="undo">↶ Geri Al</button><button data-act="clear">🗑 Temizle</button><button data-act="save">💾 PNG</button>
    </div>
    <canvas id="wb-cv"></canvas></div>`;
  const cv = el.querySelector('#wb-cv');
  const g = cv.getContext('2d');
  const W = 1600;
  const H = 900;
  cv.width = W;
  cv.height = H;
  const drawStroke = (s, ctx2 = g) => {
    if (s.tool === 'text') {
      ctx2.fillStyle = s.color;
      ctx2.font = `700 ${s.size * 6}px Inter, sans-serif`;
      ctx2.fillText(s.text || '', s.pts[0][0] * W, s.pts[0][1] * H);
      return;
    }
    ctx2.save();
    ctx2.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx2.strokeStyle = s.color;
    ctx2.lineWidth = s.size * (s.tool === 'erase' ? 4 : 1.5);
    ctx2.lineCap = ctx2.lineJoin = 'round';
    ctx2.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx2.lineTo(x * W, y * H) : ctx2.moveTo(x * W, y * H)));
    if (s.pts.length === 1) ctx2.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H);
    ctx2.stroke();
    ctx2.restore();
  };
  const redraw = () => {
    g.clearRect(0, 0, W, H);
    strokes.forEach((s) => drawStroke(s));
    for (const l of live.values()) drawStroke(l);
  };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  let cur = null;
  let flushed = 0;
  cv.onpointerdown = (e) => {
    const p = pos(e);
    if (tool === 'text') {
      ctx.promptDialog('Yazı ekle', 'Metin', '', { ok: 'Ekle', max: 120 }).then((t) => { if (t) send({ cmd: 'stroke', s: { id: rid(), tool: 'text', color, size, text: t, pts: [p] } }); });
      return;
    }
    cv.setPointerCapture(e.pointerId);
    cur = { id: rid(), tool, color, size, pts: [p] };
    flushed = 0;
  };
  cv.onpointermove = (e) => {
    if (!cur) return;
    cur.pts.push(pos(e));
    drawStroke({ ...cur, pts: cur.pts.slice(-2) });
    if (cur.pts.length - flushed >= 4) { send({ cmd: 'seg', id: cur.id, color, size, tool, pts: cur.pts.slice(Math.max(0, flushed - 1)) }); flushed = cur.pts.length; }
  };
  cv.onpointerup = () => { if (cur) { send({ cmd: 'stroke', s: cur }); cur = null; } };
  el.querySelector('.wb-tools').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) { tool = b.dataset.tool; el.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.color) { color = b.dataset.color; el.querySelectorAll('.wb-color').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.act === 'undo') send({ cmd: 'undo' });
    if (b.dataset.act === 'clear') ctx.confirmDialog('Tahtayı temizle', 'Herkesin çizimi silinecek.', 'Temizle').then((ok) => ok && send({ cmd: 'clear' }));
    if (b.dataset.act === 'save') {
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const o = out.getContext('2d');
      o.fillStyle = '#1c1d22'; o.fillRect(0, 0, W, H); o.drawImage(cv, 0, 0);
      const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'biscord-cizim.png'; a.click();
    }
  };
  el.querySelector('#wb-c').oninput = (e) => { color = e.target.value; };
  el.querySelector('#wb-s').oninput = (e) => { size = +e.target.value; };
  return {
    update(s) { strokes = s.strokes; redraw(); },
    op(o) {
      if (o.cmd === 'seg' && o.uid !== me()) {
        const l = live.get(o.id) || { ...o, pts: [] };
        l.pts.push(...o.pts);
        live.set(o.id, l);
        drawStroke({ ...o });
      } else if (o.cmd === 'stroke') { live.delete(o.s.id); strokes.push(o.s); if (o.s.uid !== me()) drawStroke(o.s); }
      else if (o.cmd === 'remove') { strokes = strokes.filter((s) => s.id !== o.id); redraw(); }
      else if (o.cmd === 'clear') { strokes = []; live.clear(); redraw(); }
    },
    destroy() {},
  };
});

// ================================================================ Sanal Masaüstü
registerActivity('desktop', { name: 'Sanal Masaüstü', emoji: '🖥️', desc: 'Retro ortak masaüstü: not, resim, kısayol ve mini programlar.', players: 'Sınırsız' }, (el, send) => {
  let items = new Map();
  let theme = 'win95';
  const APPS = { calc: ['🧮', 'Hesap Makinesi'], clock: ['🕒', 'Saat'], notepad: ['📝', 'Not Defteri'], music: ['🎵', 'Müzik Çalar'], trash: ['🗑️', 'Geri Dönüşüm'] };
  el.innerHTML = `<div class="vd" id="vd"><div class="vd-area" id="vd-area"></div>
    <div class="vd-bar"><button class="vd-start" id="vd-start">🪟 Başlat</button><span class="grow"></span><span id="vd-clock"></span></div></div>`;
  const root = el.querySelector('#vd');
  const area = el.querySelector('#vd-area');
  const clockEl = el.querySelector('#vd-clock');
  const tick = setInterval(() => {
    const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    clockEl.textContent = t;
    area.querySelectorAll('.vd-clock-face').forEach((c) => { c.textContent = new Date().toLocaleTimeString('tr-TR'); });
  }, 1000);
  const itemHTML = (it) => {
    const style = `left:${it.x * 100}%;top:${it.y * 100}%;z-index:${it.z}`;
    if (it.type === 'note') return `<div class="vd-item vd-note" data-id="${it.id}" style="${style};background:${esc(it.color)}"><div class="vd-title">📌 Not<i data-del>✕</i></div><textarea>${esc(it.text)}</textarea><small>${nameOf(it.by)}</small></div>`;
    if (it.type === 'image') return `<div class="vd-item vd-win" data-id="${it.id}" style="${style}"><div class="vd-title">🖼️ Resim<i data-del>✕</i></div><img src="${esc(it.url)}" alt="" draggable="false"></div>`;
    if (it.type === 'link') return `<div class="vd-item vd-icon" data-id="${it.id}" style="${style}"><span>🔗</span><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text || it.url.replace(/^https:\/\//, '').slice(0, 24))}</a><i data-del>✕</i></div>`;
    const [ic, nm] = APPS[it.app] || ['❔', 'Program'];
    let body = '';
    if (it.app === 'calc') body = '<input class="vd-calc" placeholder="12*(3+4)"><div class="vd-calc-out">= 0</div>';
    if (it.app === 'clock') body = '<div class="vd-clock-face"></div>';
    if (it.app === 'notepad') body = `<textarea class="vd-notepad">${esc(it.text)}</textarea>`;
    if (it.app === 'music') body = '<button class="vd-btn" data-music>▶ Chiptune çal</button>';
    if (it.app === 'trash') return `<div class="vd-item vd-icon vd-trash" data-id="${it.id}" style="${style}"><span>${ic}</span><a>${nm}</a></div>`;
    return `<div class="vd-item vd-win" data-id="${it.id}" style="${style}"><div class="vd-title">${ic} ${nm}<i data-del>✕</i></div>${body}</div>`;
  };
  const render = () => {
    root.className = `vd vd-${theme}`;
    area.innerHTML = [...items.values()].map(itemHTML).join('');
  };
  // sürükle
  let drag = null;
  let lastSent = 0;
  area.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.vd-item');
    if (!node || e.target.closest('textarea, input, button, a, [data-del]')) return;
    const r = area.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    drag = { node, id: node.dataset.id, dx: e.clientX - nr.left, dy: e.clientY - nr.top, r };
    node.setPointerCapture(e.pointerId);
    node.style.zIndex = 9999;
  });
  area.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(0.95, (e.clientX - drag.r.left - drag.dx) / drag.r.width));
    const y = Math.max(0, Math.min(0.92, (e.clientY - drag.r.top - drag.dy) / drag.r.height));
    drag.node.style.left = x * 100 + '%';
    drag.node.style.top = y * 100 + '%';
    drag.x = x; drag.y = y;
    if (performance.now() - lastSent > 60) { lastSent = performance.now(); send({ cmd: 'move', id: drag.id, x, y }); }
  });
  area.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.x !== undefined) send({ cmd: 'move', id: drag.id, x: drag.x, y: drag.y });
    // çöp kutusuna bırakıldıysa sil
    const trash = [...area.querySelectorAll('.vd-trash')].find((t) => { const r = t.getBoundingClientRect(); return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom; });
    if (trash && trash.dataset.id !== drag.id) send({ cmd: 'del', id: drag.id });
    drag = null;
  });
  let editT;
  area.addEventListener('input', (e) => {
    const node = e.target.closest('.vd-item');
    if (!node) return;
    if (e.target.classList.contains('vd-calc')) {
      const expr = e.target.value;
      let r = '?';
      if (/^[\d+\-*/().,%\s]*$/.test(expr)) { try { r = Function(`"use strict";return (${expr.replace(/,/g, '.') || 0})`)(); } catch { r = '?'; } }
      node.querySelector('.vd-calc-out').textContent = '= ' + r;
      return;
    }
    if (e.target.tagName === 'TEXTAREA') {
      clearTimeout(editT);
      editT = setTimeout(() => send({ cmd: 'edit', id: node.dataset.id, text: e.target.value }), 250);
    }
  });
  area.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) send({ cmd: 'del', id: del.closest('.vd-item').dataset.id });
    if (e.target.closest('[data-music]')) ctx.playChiptune?.('arcade');
  });
  // dosya/resim bırak
  area.addEventListener('dragover', (e) => e.preventDefault());
  area.addEventListener('drop', async (e) => {
    e.preventDefault();
    const r = area.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const f = e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) {
      const fd = new FormData();
      fd.append('file', f);
      try { const { url } = await ctx.api.post('/uploads/image', fd); send({ cmd: 'add', type: 'image', url, x, y }); } catch (err) { ctx.fail(err); }
    } else {
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (/^https:\/\//.test(url)) send({ cmd: 'add', type: /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) ? 'image' : 'link', url, x, y });
    }
  });
  el.querySelector('#vd-start').onclick = (e) => ctx.menuAt(e.currentTarget, [
    { label: '📌 Yapışkan Not', action: () => send({ cmd: 'add', type: 'note', x: 0.1 + Math.random() * 0.5, y: 0.1 + Math.random() * 0.4, color: ['#fff59d', '#b2f5ea', '#fbcfe8', '#c7d2fe'][Math.floor(Math.random() * 4)] }) },
    { label: '🖼️ Resim (bağlantı)', action: async () => { const u = await ctx.promptDialog('Resim ekle', 'Resim bağlantısı (https://…) — ya da resmi masaüstüne sürükle', '', { max: 1000 }); if (u) send({ cmd: 'add', type: 'image', url: u, x: 0.3, y: 0.2 }); } },
    { label: '🔗 Kısayol', action: async () => { const u = await ctx.promptDialog('Kısayol ekle', 'Bağlantı (https://…)', '', { max: 1000 }); if (u) send({ cmd: 'add', type: 'link', url: u, x: 0.05, y: 0.6 }); } },
    '-',
    ...Object.entries(APPS).map(([k, [ic, nm]]) => ({ label: `${ic} ${nm}`, action: () => send({ cmd: 'add', type: 'app', app: k, x: 0.2 + Math.random() * 0.4, y: 0.15 + Math.random() * 0.3 }) })),
    '-',
    { label: '🎨 Tema: Windows 95', action: () => send({ cmd: 'theme', theme: 'win95' }) },
    { label: '🎨 Tema: XP', action: () => send({ cmd: 'theme', theme: 'xp' }) },
    { label: '🎨 Tema: Cyberpunk', action: () => send({ cmd: 'theme', theme: 'cyber' }) },
  ], { above: true });
  return {
    update(s) { theme = s.theme; items = new Map(s.items.map((i) => [i.id, i])); render(); },
    op(o) {
      if (o.cmd === 'add') { items.set(o.item.id, o.item); area.insertAdjacentHTML('beforeend', itemHTML(o.item)); }
      else if (o.cmd === 'move') {
        const it = items.get(o.id);
        if (!it) return;
        Object.assign(it, { x: o.x, y: o.y, z: o.z });
        if (drag?.id === o.id && o.uid === me()) return;
        const n = area.querySelector(`[data-id="${o.id}"]`);
        if (n) { n.style.left = o.x * 100 + '%'; n.style.top = o.y * 100 + '%'; n.style.zIndex = o.z; }
      } else if (o.cmd === 'edit') {
        const it = items.get(o.id);
        if (!it) return;
        it.text = o.text;
        const ta = area.querySelector(`[data-id="${o.id}"] textarea`);
        if (ta && o.uid !== me() && document.activeElement !== ta) ta.value = o.text;
      } else if (o.cmd === 'del') { items.delete(o.id); area.querySelector(`[data-id="${o.id}"]`)?.remove(); }
      else if (o.cmd === 'theme') { theme = o.theme; root.className = `vd vd-${theme}`; }
    },
    destroy() { clearInterval(tick); },
  };
});

// ================================================================ Ortak Kod Editörü (canlı imleçler + paylaşılan terminal)
// Sunucudaki dönüşümle birebir aynı olmalı (server/activities.js → transform)
function transform(a, b, aFirst = false) {
  if (!a || !b) return a;
  if (a.t === 'ins') {
    if (b.t === 'ins') return b.p < a.p || (b.p === a.p && !aFirst) ? { ...a, p: a.p + b.s.length } : a;
    if (a.p <= b.p) return a;
    if (a.p >= b.p + b.n) return { ...a, p: a.p - b.n };
    return null;
  }
  if (b.t === 'ins') {
    if (b.p >= a.p + a.n) return a;
    if (b.p <= a.p) return { ...a, p: a.p + b.s.length };
    return { ...a, n: a.n + b.s.length };
  }
  const aEnd = a.p + a.n;
  const bEnd = b.p + b.n;
  if (bEnd <= a.p) return { ...a, p: a.p - b.n };
  if (b.p >= aEnd) return a;
  const n = a.n - (Math.min(aEnd, bEnd) - Math.max(a.p, b.p));
  return n <= 0 ? null : { ...a, p: Math.min(a.p, b.p), n };
}
const applyOp = (doc, o) => (!o ? doc : o.t === 'ins' ? doc.slice(0, o.p) + o.s + doc.slice(o.p) : doc.slice(0, o.p) + doc.slice(o.p + o.n));
const shiftPos = (p, o) => (!o ? p : o.t === 'ins' ? (o.p <= p ? p + o.s.length : p) : p <= o.p ? p : p >= o.p + o.n ? p - o.n : o.p);

registerActivity('code', { name: 'Ortak Kod', emoji: '👨‍💻', desc: 'Aynı dosyada birlikte kodlayın: canlı imleçler ve ortak terminal.', players: '1-20 kişi' }, (el, send) => {
  el.innerHTML = `<div class="cc">
    <div class="cc-bar"><select class="input" id="cc-lang" style="width:auto"><option value="js">JavaScript</option><option value="py">Python</option></select>
      <span class="muted" id="cc-who"></span><span class="grow"></span><button class="btn green sm" id="cc-run">▶ Çalıştır (herkese)</button></div>
    <div class="cc-editor"><pre class="cc-mirror" id="cc-mirror" aria-hidden="true"></pre><textarea id="cc-ta" spellcheck="false"></textarea></div>
    <div class="code-out cc-term" id="cc-term"><div class="ln meta">Terminal — ▶ Çalıştır'a basınca çıktı herkese görünür</div></div></div>`;
  const ta = el.querySelector('#cc-ta');
  const mirror = el.querySelector('#cc-mirror');
  const term = el.querySelector('#cc-term');
  let doc = '';
  let version = 0;
  let pending = null; // gönderilmiş, onay bekleyen
  let buffer = [];    // henüz gönderilmemiş
  let seq = 0;
  const cursors = new Map(); // uid -> pos
  const flush = () => {
    if (pending || !buffer.length) return;
    pending = { op: buffer.shift(), seq: ++seq };
    send({ cmd: 'op', op: pending.op, base: version, seq: pending.seq });
  };
  const drawMirror = () => {
    const marks = [...cursors].filter(([u, p]) => u !== me() && p != null && p >= 0).sort((a, b) => a[1] - b[1]);
    let html = '';
    let last = 0;
    for (const [u, p] of marks) {
      const pos = Math.min(p, doc.length);
      html += esc(doc.slice(last, pos)) + `<span class="cc-cur" style="--c:${colorFor(u)}"><b>${nameOf(u)}</b></span>`;
      last = pos;
    }
    mirror.innerHTML = html + esc(doc.slice(last)) + '\n';
    mirror.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; mirror.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.querySelector('#cc-run').click();
  });
  ta.addEventListener('input', () => {
    const nw = ta.value;
    // fark: ortak başlangıç ve son
    let a = 0;
    while (a < doc.length && a < nw.length && doc[a] === nw[a]) a++;
    let b = 0;
    while (b < doc.length - a && b < nw.length - a && doc[doc.length - 1 - b] === nw[nw.length - 1 - b]) b++;
    const delN = doc.length - a - b;
    const ins = nw.slice(a, nw.length - b);
    if (delN > 0) buffer.push({ t: 'del', p: a, n: delN });
    if (ins) buffer.push({ t: 'ins', p: a, s: ins });
    doc = nw;
    drawMirror();
    flush();
    send({ cmd: 'cursor', pos: ta.selectionStart });
  });
  let curT = 0;
  ta.addEventListener('keyup', () => { if (performance.now() - curT > 120) { curT = performance.now(); send({ cmd: 'cursor', pos: ta.selectionStart }); } });
  ta.addEventListener('click', () => send({ cmd: 'cursor', pos: ta.selectionStart }));
  el.querySelector('#cc-lang').onchange = (e) => send({ cmd: 'lang', lang: e.target.value });
  el.querySelector('#cc-run').onclick = async () => {
    send({ cmd: 'run' });
    const lines = [];
    await runCode(el.querySelector('#cc-lang').value, doc, (l) => lines.push({ type: l.type, text: l.text }));
    send({ cmd: 'out', lines });
  };
  const setDoc = (text) => {
    const s = ta.selectionStart;
    const e2 = ta.selectionEnd;
    doc = text;
    if (ta.value !== text) { ta.value = text; ta.setSelectionRange(s, e2); }
    drawMirror();
  };
  return {
    update(s) { pending = null; buffer = []; version = s.version; el.querySelector('#cc-lang').value = s.lang; setDoc(s.doc); },
    op(o) {
      if (o.cmd === 'op') {
        if (o.uid === me() && pending && o.ack === pending.seq) { version = o.version; pending = null; flush(); return; }
        // başkasının işlemi: bekleyen ve tampondaki işlemlerime göre dönüştür
        let sop = o.op;
        if (pending) { const p2 = transform(pending.op, sop, false); sop = transform(sop, pending.op, true); pending.op = p2 || { t: 'ins', p: 0, s: '' }; }
        buffer = buffer.map((bop) => { const nb = transform(bop, sop, false); sop = transform(sop, bop, true); return nb; }).filter(Boolean);
        version = o.version;
        const selS = shiftPos(ta.selectionStart, sop);
        const selE = shiftPos(ta.selectionEnd, sop);
        doc = applyOp(doc, sop);
        ta.value = doc;
        ta.setSelectionRange(selS, selE);
        for (const [u, p] of cursors) cursors.set(u, shiftPos(p, sop));
        drawMirror();
      } else if (o.cmd === 'resync' && o.uid === me()) { pending = null; buffer = []; version = o.version; setDoc(o.doc); }
      else if (o.cmd === 'cursor') { cursors.set(o.uid, o.pos); drawMirror(); el.querySelector('#cc-who').textContent = `${[...cursors.keys()].filter((u) => u !== me()).length + 1} kişi düzenliyor`; }
      else if (o.cmd === 'lang') el.querySelector('#cc-lang').value = o.lang;
      else if (o.cmd === 'run') term.insertAdjacentHTML('beforeend', `<div class="ln meta">$ ${nameOf(o.uid)} kodu çalıştırdı (${o.lang === 'py' ? 'Python' : 'JavaScript'})…</div>`);
      else if (o.cmd === 'out') {
        for (const l of o.lines) term.insertAdjacentHTML('beforeend', `<div class="ln ${esc(l.type)}">${esc(l.text)}</div>`);
        term.scrollTop = term.scrollHeight;
      }
    },
    destroy() {},
  };
});

// ================================================================ Beat Yapıcı
const TRACK_NAMES = ['Kick', 'Snare', 'Hi-hat', 'Clap', 'Tom', 'Bas', 'Synth', '8-bit'];
let beatCtx = null;
function playInstrument(ac, track, t, kit) {
  const out = ac.destination;
  const env = (node, peak, dur) => { const g = ac.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); node.connect(g).connect(out); return g; };
  const osc = (type, f, dur, peak, f2) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); env(o, peak, dur); o.start(t); o.stop(t + dur + 0.02); };
  const noise = (dur, peak, type, freq) => {
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = b;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    s.connect(f); env(f, peak, dur); s.start(t);
  };
  const bit = kit === '8bit';
  const rock = kit === 'rock';
  switch (track) {
    case 0: osc(bit ? 'square' : 'sine', rock ? 120 : 150, rock ? 0.25 : 0.4, 0.9, 40); break;
    case 1: bit ? osc('square', 220, 0.12, 0.3, 110) : (noise(0.18, rock ? 0.6 : 0.4, 'highpass', 1500), osc('triangle', 190, 0.1, 0.3)); break;
    case 2: bit ? osc('square', 6000, 0.03, 0.08) : noise(0.05, 0.25, 'highpass', 8000); break;
    case 3: noise(0.15, 0.4, 'bandpass', 1200); break;
    case 4: osc(bit ? 'square' : 'sine', 180, 0.25, 0.6, 90); break;
    case 5: osc(bit ? 'square' : 'sawtooth', 55, 0.3, 0.35); break;
    case 6: osc(bit ? 'square' : 'sawtooth', 440, 0.18, 0.18); break;
    case 7: osc('square', 880, 0.08, 0.15, 1760); break;
  }
}

registerActivity('beats', { name: 'Beat Yapıcı', emoji: '🥁', desc: 'Herkes aynı anda vuruş ekler; birlikte beat yapın.', players: 'Sınırsız' }, (el, send) => {
  let st = null;
  let offset = 0;
  let timer = null;
  let nextStep = 0;
  let nextTime = 0;
  el.innerHTML = `<div class="bt"><div class="bt-bar">
      <button class="btn green sm" id="bt-play">▶ Çal</button>
      <label>BPM <input type="range" id="bt-bpm" min="60" max="200"><b id="bt-bpm-v"></b></label>
      <select class="input" id="bt-kit" style="width:auto"><option value="808">🔊 808</option><option value="8bit">👾 8-bit</option><option value="rock">🎸 Rock</option></select>
      <span class="grow"></span><button class="btn ghost sm" id="bt-clear">Temizle</button></div>
    <div class="bt-grid" id="bt-grid"></div></div>`;
  const grid = el.querySelector('#bt-grid');
  const draw = () => {
    grid.innerHTML = st.grid.map((row, t) => `<div class="bt-row"><span class="bt-name">${TRACK_NAMES[t]}</span>${row.map((v, s) => `<button class="bt-cell ${v ? 'on' : ''} ${s % 4 === 0 ? 'beat' : ''}" data-t="${t}" data-s="${s}"></button>`).join('')}</div>`).join('');
    el.querySelector('#bt-play').textContent = st.playing ? '⏹ Durdur' : '▶ Çal';
    el.querySelector('#bt-bpm').value = st.bpm;
    el.querySelector('#bt-bpm-v').textContent = st.bpm;
    el.querySelector('#bt-kit').value = st.kit;
  };
  grid.onclick = (e) => {
    const c = e.target.closest('.bt-cell');
    if (!c) return;
    beatCtx ||= new AudioContext();
    if (!c.classList.contains('on')) playInstrument(beatCtx, +c.dataset.t, beatCtx.currentTime, st.kit);
    send({ cmd: 'toggle', t: +c.dataset.t, s: +c.dataset.s });
  };
  el.querySelector('#bt-play').onclick = () => { beatCtx ||= new AudioContext(); beatCtx.resume(); send({ cmd: st.playing ? 'stop' : 'play' }); };
  el.querySelector('#bt-bpm').onchange = (e) => send({ cmd: 'bpm', bpm: +e.target.value });
  el.querySelector('#bt-kit').onchange = (e) => send({ cmd: 'kit', kit: e.target.value });
  el.querySelector('#bt-clear').onclick = () => send({ cmd: 'clear' });
  // zamanlayıcı: sunucu saatine göre hizalı adımlar
  const schedule = () => {
    if (!st?.playing || !beatCtx) return;
    const stepDur = 60 / st.bpm / 4;
    const serverNow = Date.now() + offset;
    const elapsed = (serverNow - st.start_at) / 1000;
    if (nextTime === 0) {
      nextStep = Math.max(0, Math.ceil(elapsed / stepDur));
      nextTime = beatCtx.currentTime + (nextStep * stepDur - elapsed);
    }
    while (nextTime < beatCtx.currentTime + 0.12) {
      const s = nextStep % 16;
      st.grid.forEach((row, t) => { if (row[s]) playInstrument(beatCtx, t, Math.max(beatCtx.currentTime, nextTime), st.kit); });
      const ms = Math.max(0, (nextTime - beatCtx.currentTime) * 1000);
      setTimeout(() => { grid.querySelectorAll('.bt-cell.now').forEach((x) => x.classList.remove('now')); grid.querySelectorAll(`[data-s="${s}"]`).forEach((x) => x.classList.add('now')); }, ms);
      nextStep++;
      nextTime += stepDur;
    }
  };
  timer = setInterval(schedule, 25);
  const transport = (o) => {
    offset = o.server_now - Date.now();
    Object.assign(st, { bpm: o.bpm, playing: o.playing, start_at: o.start_at, kit: o.kit });
    nextTime = 0;
    if (st.playing) { beatCtx ||= new AudioContext(); beatCtx.resume(); }
    draw();
  };
  return {
    update(s) { st = s; transport(s); },
    op(o) {
      if (o.cmd === 'cell') { st.grid[o.t][o.s] = o.v; grid.querySelector(`[data-t="${o.t}"][data-s="${o.s}"]`)?.classList.toggle('on', o.v); }
      if (o.cmd === 'transport') transport(o);
    },
    destroy() { clearInterval(timer); },
  };
});

// ================================================================ Hacker Düellosu
registerActivity('hackduel', { name: 'Hacker Düellosu', emoji: '💻', desc: 'Komutları rakibinden hızlı yaz, sunucusunu çökert!', players: '2 oyuncu + izleyiciler' }, (el, send) => {
  let st = null;
  const prog = {};
  el.innerHTML = '<div class="hd" id="hd"></div>';
  const box = el.querySelector('#hd');
  const draw = () => {
    const [a, b] = st.players;
    const bar = (u) => u ? `<div class="hd-p ${u === me() ? 'me' : ''}">${avatar(ctx.user(u), 28)}<b>${nameOf(u)}</b>
      <div class="hd-hp"><i style="width:${st.hp[u]}%"></i></div><small>SUNUCU: ${st.hp[u]}%</small>
      <div class="hd-prog"><i style="width:${st.line ? Math.min(100, ((prog[u] || 0) / st.line.length) * 100) : 0}%"></i></div></div>` : '<div class="hd-p empty">Rakip bekleniyor…</div>';
    const playing = st.players.includes(me());
    let center = '';
    if (st.phase === 'lobby' || st.phase === 'end') {
      center = `${st.phase === 'end' ? `<h2>${st.winner === me() ? '🏆 KAZANDIN! Rakibin sunucusu çöktü.' : st.winner ? `💀 ${nameOf(st.winner)} kazandı` : 'Düello bitti'}</h2>` : '<h2>&gt; HACKER DÜELLOSU_</h2><p>Ekrana gelen komutu rakibinden önce birebir yaz. Her doğru komut rakibin sunucusuna %25 hasar verir, yanlış komut sana %5 hasar verir.</p>'}
        ${st.players.length === 2 && playing ? '<button class="btn green" id="hd-start">BAĞLAN ve BAŞLAT</button>' : st.players.length < 2 ? '<p class="blink">2. oyuncu bekleniyor…</p>' : ''}`;
    } else if (st.phase === 'countdown') center = '<h2 class="blink">BAĞLANTI KURULUYOR…</h2>';
    else {
      center = `<div class="hd-round">TUR ${st.round}</div><div class="hd-line">${esc(st.line || '')}</div>
        ${playing ? `<input class="hd-in" id="hd-in" autocomplete="off" spellcheck="false" placeholder="komutu yaz ve Enter'a bas" ${st.phase !== 'round' ? 'disabled' : ''}>` : '<p class="muted">İzleyici modundasın</p>'}`;
    }
    box.innerHTML = `<div class="hd-top">${bar(a)}<div class="hd-vs">VS</div>${bar(b)}</div><div class="hd-center">${center}</div>`;
    box.querySelector('#hd-start')?.addEventListener('click', () => send({ cmd: 'start' }));
    const inp = box.querySelector('#hd-in');
    if (inp) {
      inp.focus();
      inp.oninput = () => {
        let n = 0;
        while (n < inp.value.length && inp.value[n] === st.line[n]) n++;
        inp.classList.toggle('bad', n < inp.value.length);
        send({ cmd: 'progress', n });
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { send({ cmd: 'submit', text: inp.value }); inp.value = ''; } };
    }
  };
  return {
    update(s) { st = s; for (const k of Object.keys(prog)) delete prog[k]; draw(); },
    op(o) {
      if (o.cmd === 'progress') {
        prog[o.uid] = o.n;
        const bars = box.querySelectorAll('.hd-p');
        const i = st.players.indexOf(o.uid);
        const pb = bars[i]?.querySelector('.hd-prog i');
        if (pb && st.line) pb.style.width = Math.min(100, (o.n / st.line.length) * 100) + '%';
      } else if (o.cmd === 'hit') {
        st.hp[o.foe] = o.hp;
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 400);
        ctx.toast(`💥 ${nameOf(o.uid)} vurdu! ${nameOf(o.foe)}: %${o.hp}`);
      } else if (o.cmd === 'miss') { st.hp[o.uid] = o.hp; if (o.uid === me()) ctx.toast('❌ Yanlış komut! -5%', 'error'); draw(); }
    },
    destroy() {},
  };
});
