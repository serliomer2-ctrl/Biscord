// Arayüz modları: Terminal (ASCII) modu + klavyeyle gezinme, Aynalı Evren, Panik tuşu (sahte ekran),
// Canlı imleç arenası, Mesaj balonu patlatma, Oyun içi mini sohbet (Picture-in-Picture)
import { ctx } from '../ctx.js';
import { esc, store, markdown, colorFor } from '../util.js';

export function applyModes() {
  const r = document.documentElement;
  r.classList.toggle('term', !!store.get('termMode', false));
  r.classList.toggle('mirror', !!store.get('mirrorMode', false));
}

export function toggleTerminal() {
  store.set('termMode', !store.get('termMode', false));
  applyModes();
  ctx.toast(store.get('termMode') ? '>_ TERMİNAL MODU AKTİF — klavye kısayolları için F1' : 'Terminal modu kapatıldı');
}

// ---------------------------------------------------------------- klavyeyle gezinme (her modda çalışır)
const TERM_HELP = [
  ['Alt + ↑ / ↓', 'Önceki / sonraki kanal'], ['Alt + Shift + ↑ / ↓', 'Önceki / sonraki sunucu'], ['Alt + H', 'Ana sayfa (Arkadaşlar)'],
  ['Ctrl + K', 'Hızlı geçiş'], ['/', 'Mesaj kutusuna odaklan'], ['Alt + M', 'Üye listesini aç/kapa'], ['Alt + V', 'Seçili ses kanalına katıl'],
  ['Ctrl + Shift + M', 'Mikrofonu sustur'], ['Ctrl + Shift + T', 'Terminal modunu aç/kapa'], ['F12 veya Alt + Q', 'Panik tuşu'], ['Alt + C', 'Klip kaydet'], ['F1', 'Bu yardım'],
];
export function termHelp() {
  ctx.modal({
    title: '>_ KLAVYE KISAYOLLARI',
    body: `<div class="term-help">${TERM_HELP.map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</div>`,
  });
}
export function moveChannel(dir) {
  const S = ctx.S;
  if (S.view.sid === '@me') {
    const dms = [...S.channels.values()].filter((c) => c.type === 'dm').sort((a, b) => (b.last_message_at || b.created_at) - (a.last_message_at || a.created_at));
    const ids = [null, ...dms.map((c) => c.id)];
    const i = ids.indexOf(S.view.cid);
    return ctx.navigate('@me', ids[(i + dir + ids.length) % ids.length]);
  }
  const list = ctx.serverChannels(S.view.sid).filter((c) => ['text', 'voice', 'lobby', 'ghost'].includes(c.type));
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === S.view.cid);
  const next = list[(i + dir + list.length) % list.length];
  ctx.navigate(S.view.sid, next.id);
}
export function moveServer(dir) {
  const ids = ['@me', ...ctx.S.servers.keys()];
  const i = ids.indexOf(ctx.S.view.sid);
  ctx.navigate(ids[(i + dir + ids.length) % ids.length]);
}

// ---------------------------------------------------------------- panik tuşu (Boss Key)
const DISGUISES = {
  excel: () => {
    const cols = 'ABCDEFGHIJK'.split('');
    const rows = Array.from({ length: 40 }, (_, r) => `<tr><th>${r + 1}</th>${cols.map((c, ci) => `<td>${r === 0 ? ['Bölge', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Toplam', 'Ortalama', 'Hedef', 'Durum'][ci] : ci === 0 ? ['Marmara', 'Ege', 'Akdeniz', 'İç Anadolu', 'Karadeniz', 'Doğu', 'G.Doğu'][r % 7] : ci === 10 ? (r % 3 ? '✔ Tamam' : '⚠ Gözden geçir') : ((r * 137 + ci * 911) % 9000 + 1000).toLocaleString('tr-TR')}</td>`).join('')}</tr>`).join('');
    return { title: 'Kitap1.xlsx - Excel', html: `<div class="dg-excel"><div class="dg-ribbon"><b>Dosya</b> Giriş Ekle Sayfa Düzeni Formüller Veri Gözden Geçir Görünüm</div><div class="dg-formula">fx &nbsp; =TOPLA(B2:G2)</div><table><tr><th></th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows}</table><div class="dg-tabs">Sayfa1 &nbsp; Sayfa2 &nbsp; +</div></div>` };
  },
  wiki: () => ({ title: 'Osmanlı İmparatorluğu ekonomisi - Vikipedi', html: `<div class="dg-wiki"><div class="dg-wiki-top">VİKİPEDİ — Özgür Ansiklopedi</div><h1>Osmanlı İmparatorluğu ekonomisi</h1><p class="dg-sub">Vikipedi, özgür ansiklopedi</p>
    ${['Osmanlı İmparatorluğu ekonomisi, tarım, zanaat ve ticaret üzerine kurulu, bölgeden bölgeye büyük farklılıklar gösteren karmaşık bir yapıya sahipti. Tımar sistemi, toprağın işlenmesini ve askeri gücün sürdürülmesini birlikte düzenleyen temel kurumlardan biriydi.', 'Loncalar, şehirlerdeki zanaat üretimini denetler; fiyatlar, kalite ve çırak-usta ilişkileri ayrıntılı kurallara bağlanırdı. Narh sistemi, temel tüketim maddelerinin fiyatlarını belirleyerek halkın alım gücünü korumayı amaçlıyordu.', 'Ticaret yolları üzerindeki konumu sayesinde imparatorluk, ipek ve baharat ticaretinden önemli gelirler elde etti. Kervansaraylar ve bedestenler bu ticaret ağının düğüm noktaları hâline geldi.', 'On sekizinci yüzyıldan itibaren artan dış borçlar ve kapitülasyonlar, ekonomik yapının dönüşümünde belirleyici rol oynadı. 1881\'de kurulan Düyun-u Umumiye idaresi, borçların yönetimini üstlendi.'].map((p) => `<p>${p}</p>`).join('')}
    <h2>Ayrıca bakınız</h2><ul><li>Tımar sistemi</li><li>Lonca</li><li>Düyun-u Umumiye</li></ul></div>` }),
  cpp: () => {
    const lines = [];
    for (let i = 0; i < 70; i++) {
      const f = ['src/engine/render.cpp', 'src/net/socket_pool.cpp', 'include/core/allocator.hpp', 'src/physics/solver.cpp', 'src/ui/layout.cpp'][i % 5];
      lines.push(i % 9 === 4 ? `<span class="w">${f}:${100 + i * 7}:12: warning: unused variable 'tmp_${i}' [-Wunused-variable]</span>` : `[${String(i + 1).padStart(3)}/412] Building CXX object CMakeFiles/core.dir/${f}.o`);
    }
    return { title: 'build — g++ -O2 -std=c++20', html: `<pre class="dg-cpp">$ cmake --build build -j8\n${lines.join('\n')}\n<span class="blink">█</span></pre>` };
  },
};
let panic = null;
export function togglePanic() {
  if (panic) {
    panic.el.remove();
    document.title = panic.title;
    panic = null;
    return;
  }
  const kind = store.get('panicKind', 'excel');
  const d = DISGUISES[kind]();
  const el = document.createElement('div');
  el.className = 'panic-screen';
  el.innerHTML = d.html;
  document.body.appendChild(el);
  panic = { el, title: document.title };
  document.title = d.title;
  ctx.voice?.connected && !ctx.voice.deafened && ctx.voice.toggleDeafen();
  el.addEventListener('dblclick', togglePanic);
}
export const PANIC_KINDS = { excel: '📊 Excel tablosu', wiki: '📖 Vikipedi makalesi', cpp: '🖥️ C++ derleme terminali' };

// ---------------------------------------------------------------- canlı imleç arenası
let cur = null;
export function cursorsEnabled() { return !!store.get('cursorArena', false); }
export function startCursors(cid) {
  stopCursors();
  if (!cursorsEnabled()) return;
  const chat = document.querySelector('#chat');
  if (!chat) return;
  const layer = document.createElement('div');
  layer.className = 'cursor-layer';
  chat.appendChild(layer);
  const others = new Map();
  let score = 0;
  let last = 0;
  const pos = (e) => { const r = chat.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const onMove = (e) => {
    if (performance.now() - last < 50) return;
    last = performance.now();
    const p = pos(e);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    ctx.socket.emit('cursor', { channel_id: cid, ...p });
  };
  const onClick = (e) => {
    if (!e.altKey) return; // lazer: Alt + tık
    e.preventDefault();
    const p = pos(e);
    const r = chat.getBoundingClientRect();
    let hit = null;
    for (const [uid, o] of others) if (Math.hypot((o.x - p.x) * r.width, (o.y - p.y) * r.height) < 40) hit = uid;
    laser(layer, p);
    if (hit) { score++; ctx.toast(`🎯 ${ctx.displayName(hit)} vuruldu! Skor: ${score}`); }
    ctx.socket.emit('cursor', { channel_id: cid, ...p, shot: p, hit });
  };
  chat.addEventListener('mousemove', onMove);
  chat.addEventListener('click', onClick, true);
  const onCursor = (d) => {
    if (d.gone) { others.get(d.uid)?.el.remove(); others.delete(d.uid); return; }
    let o = others.get(d.uid);
    if (!o) {
      const el = document.createElement('div');
      el.className = 'mc-cursor';
      el.style.setProperty('--c', colorFor(d.uid));
      el.innerHTML = `<svg viewBox="0 0 16 16"><path d="M1 1l5 14 2-6 6-2z"/></svg><span>${esc(ctx.displayName(d.uid, ctx.S.view.sid))}</span>`;
      layer.appendChild(el);
      o = { el };
      others.set(d.uid, o);
    }
    o.x = d.x; o.y = d.y;
    o.el.style.left = d.x * 100 + '%';
    o.el.style.top = d.y * 100 + '%';
    if (d.shot) laser(layer, d.shot);
    if (d.hit === ctx.S.me.id) { chat.classList.add('hit-flash'); setTimeout(() => chat.classList.remove('hit-flash'), 300); ctx.toast(`💥 ${ctx.displayName(d.uid)} seni vurdu!`); }
  };
  ctx.socket.on('cursor', onCursor);
  ctx.socket.emit('cursor:join', { channel_id: cid });
  cur = { cid, stop: () => { chat.removeEventListener('mousemove', onMove); chat.removeEventListener('click', onClick, true); ctx.socket.off('cursor', onCursor); ctx.socket.emit('cursor:leave', { channel_id: cid }); layer.remove(); } };
}
function laser(layer, p) {
  const b = document.createElement('i');
  b.className = 'laser-burst';
  b.style.left = p.x * 100 + '%';
  b.style.top = p.y * 100 + '%';
  layer.appendChild(b);
  setTimeout(() => b.remove(), 500);
}
export function stopCursors() { cur?.stop(); cur = null; }

// ---------------------------------------------------------------- mesaj balonu patlatma
let bubbles = null;
export function toggleBubbles() {
  if (bubbles) { bubbles.stop(); bubbles = null; return; }
  const chat = document.querySelector('#chat');
  const st = ctx.S.messages.get(ctx.S.view.cid);
  if (!chat || !st) return;
  const layer = document.createElement('div');
  layer.className = 'bubble-layer';
  layer.innerHTML = '<div class="bubble-hint">🫧 Mesajlar balon oldu! Okumak için tıklayıp patlat. Popüler mesajların balonu daha büyük. <button class="btn sm">Kapat</button></div>';
  chat.appendChild(layer);
  layer.querySelector('button').onclick = () => toggleBubbles();
  const list = [];
  const add = (m, delay = 0) => {
    if (m.type !== 0 || (!m.content && !m.attachments.length)) return;
    const pop = m.reactions.reduce((n, r) => n + r.count, 0);
    const size = Math.min(170, 70 + pop * 18 + Math.min(40, m.content.length / 4));
    const el = document.createElement('button');
    el.className = 'bubble';
    el.style.width = el.style.height = size + 'px';
    el.style.left = Math.random() * 85 + '%';
    el.style.setProperty('--hue', (parseInt(m.author.id.slice(-4), 10) || 0) % 360);
    el.style.animationDelay = delay + 'ms';
    el.style.animationDuration = 7 + Math.random() * 5 + 's';
    el.innerHTML = `<span>${esc(ctx.displayName(m.author.id, ctx.S.view.sid))}</span>`;
    el.onclick = () => {
      el.classList.add('popped');
      try { const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); o.frequency.setValueAtTime(900, 0); o.frequency.exponentialRampToValueAtTime(200, 0.12); g.gain.setValueAtTime(0.3, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.15); o.connect(g).connect(ac.destination); o.start(); o.stop(0.16); setTimeout(() => ac.close(), 300); } catch { /* yok */ }
      const card = document.createElement('div');
      card.className = 'bubble-card';
      card.style.left = el.style.left;
      card.innerHTML = `<b>${esc(ctx.displayName(m.author.id, ctx.S.view.sid))}</b><div class="msg-text">${markdown(m.content) || '📎 ek'}</div>`;
      layer.appendChild(card);
      setTimeout(() => card.remove(), 6000);
      setTimeout(() => el.remove(), 300);
    };
    layer.appendChild(el);
    list.push(el);
  };
  st.list.slice(-25).forEach((m, i) => add(m, i * 350));
  bubbles = { add, stop: () => layer.remove(), cid: ctx.S.view.cid };
}
export function bubbleNew(m) { if (bubbles && bubbles.cid === m.channel_id) bubbles.add(m); }
export function stopBubbles() { bubbles?.stop(); bubbles = null; }

// ---------------------------------------------------------------- oyun içi mini sohbet (her zaman üstte duran pencere)
let hud = null;
export async function openHud() {
  if (hud) { hud.win.close(); return; }
  if (!('documentPictureInPicture' in window)) {
    return ctx.toast('Bu tarayıcı her zaman üstte duran pencereyi desteklemiyor (Chrome/Edge 116+ gerekir)', 'error');
  }
  const win = await window.documentPictureInPicture.requestWindow({ width: 340, height: 420 });
  win.document.head.innerHTML = `<style>
    body{margin:0;background:rgba(10,12,16,.92);color:#e6e7ea;font:13px/1.35 Inter,system-ui,sans-serif;display:flex;flex-direction:column;height:100vh}
    #h{padding:6px 10px;font-weight:700;background:#000;display:flex;justify-content:space-between}
    #l{flex:1;overflow:auto;padding:6px 10px}#l div{margin:3px 0;word-wrap:break-word}#l b{color:#8ab4ff}
    input{margin:6px;padding:7px 9px;border-radius:6px;border:1px solid #333;background:#1b1d22;color:#fff;outline:none}
    small{color:#888}</style>`;
  win.document.body.innerHTML = '<div id="h"><span id="t"></span><small>Num8/2 kaydır • Num5 yaz • Num0 kapat</small></div><div id="l"></div><input id="i" placeholder="Mesaj yaz, Enter ile gönder">';
  const l = win.document.getElementById('l');
  const inp = win.document.getElementById('i');
  const draw = () => {
    const cid = ctx.S.view.cid;
    const ch = ctx.S.channels.get(cid);
    win.document.getElementById('t').textContent = ch ? (ch.type === 'dm' ? '@' : '#') + (ch.name || ctx.displayName(ch.recipients?.find((x) => x !== ctx.S.me.id))) : 'Biscord';
    const msgs = ctx.S.messages.get(cid)?.list.slice(-40) || [];
    const atBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 30;
    l.innerHTML = msgs.map((m) => `<div><b>${esc(ctx.displayName(m.author.id, ctx.S.view.sid))}:</b> ${esc(m.content || '📎')}</div>`).join('');
    if (atBottom) l.scrollTop = l.scrollHeight;
  };
  inp.onkeydown = async (e) => {
    if (e.key === 'Enter' && inp.value.trim() && ctx.S.view.cid) {
      const text = inp.value;
      inp.value = '';
      try { await ctx.api.post(`/channels/${ctx.S.view.cid}/messages`, { content: text }); } catch (err) { inp.value = text; }
    }
  };
  win.addEventListener('keydown', (e) => {
    if (e.code === 'Numpad8') l.scrollTop -= 60;
    if (e.code === 'Numpad2') l.scrollTop += 60;
    if (e.code === 'Numpad5') { e.preventDefault(); inp.focus(); }
    if (e.code === 'Numpad0' && document.activeElement !== inp) win.close();
  });
  const t = setInterval(draw, 700);
  draw();
  win.addEventListener('pagehide', () => { clearInterval(t); hud = null; });
  hud = { win };
}
