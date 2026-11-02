// Sosyal eğlence: boss savaşı, sunucu maskotu, rus ruleti, arkadaş radarı, sohbet özetleyici, doodle botlar, anonim itiraf
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, avatar, colorFor } from '../util.js';

const fmt = (n) => Number(n || 0).toLocaleString('tr-TR');
const nm = (uid, sid) => esc(ctx.displayName(uid, sid));

// ================================================================ boss savaşı
export const bosses = new Map(); // server_id -> boss
export function bossBannerHTML(sid) {
  const b = bosses.get(sid);
  if (!b) return '';
  const pct = Math.max(0, (b.hp / b.max) * 100);
  const left = Math.max(0, Math.ceil((b.ends_at - Date.now()) / 60000));
  return `<div class="boss-bar" id="boss-bar"><span class="boss-emoji">${b.emoji}</span>
    <div class="grow"><div class="boss-name"><b>${esc(b.name)}</b><span>${fmt(b.hp)} / ${fmt(b.max)} • ${left} dk kaldı</span></div>
      <div class="boss-hp"><i style="width:${pct}%"></i></div>
      <small class="muted">Mesaj yaz (+25), tepki ver (+10) ya da <b>/saldir</b> yaz (+90) • ${b.top.map((t, i) => `${['🥇', '🥈', '🥉'][i]} ${nm(t.user_id, sid)} ${fmt(t.dmg)}`).join(' ')}</small></div>
    <button class="btn red sm" data-action="boss-attack">⚔️ Saldır</button></div>`;
}
export function bossHit(hit) {
  const bar = document.getElementById('boss-bar');
  if (!bar || !hit) return;
  const f = document.createElement('span');
  f.className = 'dmg-float' + (hit.crit ? ' crit' : '');
  f.textContent = (hit.crit ? '💥 KRİTİK -' : '-') + hit.dmg;
  f.style.left = 40 + Math.random() * 50 + '%';
  bar.appendChild(f);
  setTimeout(() => f.remove(), 1100);
  if (hit.crit) { bar.classList.add('boss-shake'); setTimeout(() => bar.classList.remove('boss-shake'), 400); }
}

// ================================================================ maskot
const MOODS = (m) => (m.state === 'gone' ? '🏃💨' : m.state === 'sleep' ? '💤' : m.hunger < 25 ? '🍖?' : m.happy > 75 ? '💖' : m.happy < 30 ? '😾' : '');
export function mascotHTML(raw, sid) {
  let m = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return ''; } }
  if (!m) return `<div class="mascot empty"><button class="btn secondary sm" data-action="mascot-wake" data-sid="${sid}">🥚 Maskotu çağır</button></div>`;
  const cls = m.state === 'gone' ? 'gone' : m.state === 'sleep' ? 'sleep' : m.happy > 70 ? 'happy' : '';
  return `<div class="mascot ${cls}" data-sid="${sid}">
    <div class="mascot-pet" data-action="mascot-pet" data-sid="${sid}" title="Sev">${m.state === 'gone' ? '🕳️' : m.emoji}<i>${MOODS(m)}</i></div>
    <div class="grow"><b>${esc(m.name)}</b> <small class="muted">Sv. ${m.level}</small>
      <div class="mbar" title="Tokluk"><i style="width:${m.hunger}%;background:#f0b232"></i></div>
      <div class="mbar" title="Mutluluk"><i style="width:${m.happy}%;background:#e056a0"></i></div>
      <small class="muted">${m.state === 'gone' ? 'Kimse ilgilenmedi, kaçtı!' : m.state === 'sleep' ? 'Uyuyor… biri yazsın!' : 'Mesaj yazdıkça beslenir'}</small></div>
    <div class="mascot-acts">${m.state === 'gone' ? `<button class="btn sm" data-action="mascot-call" data-sid="${sid}">📣 Çağır</button>` : `<button class="icon-btn" data-action="mascot-feed" data-sid="${sid}" title="Besle">🍖</button>`}</div></div>`;
}
export const mascotAct = (sid, action, extra) => api.post(`/servers/${sid}/mascot`, { action, ...extra }).catch(ctx.fail);

// ================================================================ rus ruleti
export function rouletteHTML(m, sid) {
  const c = m.components;
  if (c?.type !== 'roulette') return '';
  const me = ctx.S.me.id;
  const seats = Array.from({ length: 6 }, (_, i) => c.players[i]);
  return `<div class="roulette ${c.status}">
    <div class="rl-q">🎲 ${esc(c.question)}</div>
    <div class="rl-wheel ${c.status === 'done' ? 'spun' : ''}">${seats.map((u, i) => `<div class="rl-seat s${i} ${c.result?.loser === u ? 'loser' : ''}">${u ? avatar(ctx.user(u), 30) : '<span>?</span>'}</div>`).join('')}<div class="rl-center">🔫</div></div>
    ${c.status === 'done'
      ? `<div class="rl-result">💥 <b>${nm(c.result.loser, sid)}</b> ${esc(c.result.text)}</div>`
      : `<div class="row" style="justify-content:center;gap:8px">${!c.players.includes(me) ? `<button class="btn sm" data-action="rl-join" data-mid="${m.id}">Masaya Otur (${c.players.length}/6)</button>` : '<span class="muted">Masadasın…</span>'}
        ${(m.author.id === me || ctx.can(sid, ctx.P.MANAGE_MESSAGES)) && c.players.length >= 2 ? `<button class="btn red sm" data-action="rl-spin" data-mid="${m.id}">Çarkı Çevir</button>` : ''}</div>
        <small class="muted" style="display:block;text-align:center">6 kişi dolunca çark kendiliğinden döner. Kaybeden: 🦆 ördek, 🚪 1 dk atılma ya da ███ sansür!</small>`}
  </div>`;
}

// ================================================================ ping / arkadaş radarı
let myRtt = null;
export function startPing() {
  const measure = () => {
    if (!ctx.socket?.connected) return;
    const t = performance.now();
    ctx.socket.emit('ping:t', () => {
      myRtt = Math.round(performance.now() - t);
      ctx.socket.emit('ping:report', { rtt: myRtt, region: Intl.DateTimeFormat().resolvedOptions().timeZone });
    });
  };
  measure();
  setInterval(measure, 15000);
}

export async function radarModal() {
  const sid = ctx.S.view.sid !== '@me' ? ctx.S.view.sid : null;
  const { el } = ctx.modal({ title: '📡 Arkadaş Radarı', wide: true, sub: 'Seninle arandaki tahmini gecikme (ping). Merkeze yakın olan daha hızlı. Aynı bölgede veya aynı etkinlikte olanlar gruplanır.', body: '<div class="radar-wrap"><canvas id="rd-cv" width="360" height="360"></canvas><div id="rd-list" class="radar-list"></div></div>' });
  const cv = el.querySelector('#rd-cv');
  const g = cv.getContext('2d');
  let data = { users: [] };
  let ang = 0;
  const load = async () => { try { data = await api.get('/radar' + (sid ? `?server_id=${sid}` : '')); drawList(); } catch (e) { ctx.fail(e); } };
  const drawList = () => {
    const groups = {};
    for (const u of data.users) {
      const key = u.user.presence?.text ? `🎮 ${u.user.presence.text}` : u.game || `🌍 ${u.region || 'Bilinmeyen bölge'}`;
      (groups[key] ||= []).push(u);
    }
    el.querySelector('#rd-list').innerHTML = `<p><b>Senin ping'in:</b> ${data.me ? data.me.rtt + ' ms' : 'ölçülüyor…'}</p>` + (Object.entries(groups).map(([k, list]) => `<h5>${esc(k)}</h5>${list.map((u) => `<div class="rd-row">${avatar(u.user, 24, { status: true })}<b class="grow">${esc(u.user.display_name)}</b><span class="rd-ms ${u.estimate < 60 ? 'good' : u.estimate < 140 ? 'mid' : 'bad'}">~${u.estimate} ms</span></div>`).join('')}`).join('') || '<p class="muted">Çevrimiçi arkadaş yok ya da henüz ölçüm gelmedi.</p>');
  };
  const draw = () => {
    if (!cv.isConnected) return;
    requestAnimationFrame(draw);
    const W = 360;
    const c = W / 2;
    g.fillStyle = '#04120a'; g.fillRect(0, 0, W, W);
    g.strokeStyle = 'rgba(47,191,113,.35)';
    for (const r of [45, 90, 135, 175]) { g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(0, c); g.lineTo(W, c); g.moveTo(c, 0); g.lineTo(c, W); g.stroke();
    ang += 0.025;
    const grd = g.createConicGradient ? g.createConicGradient(ang, c, c) : null;
    if (grd) { grd.addColorStop(0, 'rgba(47,191,113,.45)'); grd.addColorStop(0.12, 'rgba(47,191,113,0)'); g.fillStyle = grd; g.beginPath(); g.arc(c, c, 175, 0, 7); g.fill(); }
    g.font = '10px monospace'; g.fillStyle = 'rgba(47,191,113,.7)';
    ['50ms', '100ms', '150ms'].forEach((t, i) => g.fillText(t, c + 4, c - 45 * (i + 1) - 2));
    g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 5, 0, 7); g.fill();
    data.users.forEach((u, i) => {
      const r = Math.min(170, (u.estimate / 200) * 175 + 12);
      const a = (parseInt(u.user.id.slice(-5), 10) % 360) * Math.PI / 180 + i * 0.01;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      const diff = Math.abs(((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
      const glow = Math.max(0.35, 1 - diff / 2);
      g.globalAlpha = glow;
      g.fillStyle = colorFor(u.user.id); g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
      g.fillStyle = '#d1fae5'; g.font = '11px Inter, sans-serif'; g.fillText(u.user.display_name.slice(0, 12), x + 9, y + 4);
      g.globalAlpha = 1;
    });
  };
  draw();
  await load();
  const t = setInterval(() => (cv.isConnected ? load() : clearInterval(t)), 5000);
}

// ================================================================ sohbet özetleyici ("Sen yokken neler oldu?")
const STOP = new Set('ve veya ile ama fakat de da ki bu şu o bir iki çok daha en gibi için mi mı mu mü ne ben sen biz siz onlar var yok değil evet hayır şey olan olarak kadar sonra önce artık zaten hem diye bunu şunu onu bana sana ona bizi beni seni hep tamam yani ya işte abi lan aynen bence benim senin onun hadi tabi tabii okey ok the and you is to a of it in that this i what'.split(' '));
const words = (t) => (t.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));

export async function summarize(ch) {
  const { el } = ctx.modal({ title: '📰 Sen Yokken Neler Oldu?', wide: true, body: '<p class="muted" id="sm-st">Son 1000 mesaj okunuyor…</p><div id="sm-out"></div>' });
  const all = [];
  let before = '';
  try {
    for (let i = 0; i < 10; i++) {
      const page = await api.get(`/channels/${ch.id}/messages?limit=100${before}`);
      all.unshift(...page);
      el.querySelector('#sm-st').textContent = `${all.length} mesaj okundu…`;
      if (page.length < 100) break;
      before = `&before=${page[0].id}`;
    }
  } catch (e) { return ctx.fail(e); }
  const msgs = all.filter((m) => m.type === 0 && !m.author.is_bot && m.content);
  if (msgs.length < 5) { el.querySelector('#sm-st').textContent = 'Özetlenecek kadar mesaj yok.'; return; }
  // konu kelimeleri (TF-IDF benzeri: çok geçen ama her mesajda geçmeyen)
  const df = new Map();
  const tf = new Map();
  for (const m of msgs) {
    const ws = words(m.content);
    for (const w of ws) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of new Set(ws)) df.set(w, (df.get(w) || 0) + 1);
  }
  const score = (w) => tf.get(w) * Math.log(1 + msgs.length / df.get(w));
  const topics = [...tf.keys()].filter((w) => tf.get(w) >= 2).sort((a, b) => score(b) - score(a)).slice(0, 8);
  // en çok konuşanlar
  const talk = new Map();
  for (const m of msgs) talk.set(m.author.id, (talk.get(m.author.id) || 0) + 1);
  const talkers = [...talk].sort((a, b) => b[1] - a[1]).slice(0, 5);
  // kim kime: yanıtlar ve bahsetmeler
  const pairs = new Map();
  const bump = (a, b) => { if (a === b) return; const k = `${a}>${b}`; pairs.set(k, (pairs.get(k) || 0) + 1); };
  msgs.forEach((m, i) => {
    if (m.referenced?.author) bump(m.author.id, m.referenced.author.id);
    m.mentions.forEach((u) => bump(m.author.id, u));
    const prev = msgs[i - 1];
    if (prev && prev.author.id !== m.author.id && m.created_at - prev.created_at < 90000) bump(m.author.id, prev.author.id);
  });
  const gossip = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => { const [a, b] = k.split('>'); return { a, b, n }; });
  // öne çıkan cümle: konu kelimelerini en çok içeren + tepki alan mesaj
  const tset = new Set(topics.slice(0, 5));
  const best = msgs.map((m) => ({ m, s: words(m.content).filter((w) => tset.has(w)).length + m.reactions.reduce((n, r) => n + r.count, 0) * 1.5 + Math.min(2, m.content.length / 120) }))
    .sort((a, b) => b.s - a.s).slice(0, 2).map((x) => x.m);
  const sid = ch.server_id;
  const span = Math.max(1, Math.round((msgs[msgs.length - 1].created_at - msgs[0].created_at) / 3600000));
  const hot = (() => { const hours = new Array(24).fill(0); msgs.forEach((m) => hours[new Date(m.created_at).getHours()]++); const h = hours.indexOf(Math.max(...hours)); return `${String(h).padStart(2, '0')}:00`; })();
  el.querySelector('#sm-st').textContent = `${msgs.length} mesaj, yaklaşık ${span} saat • tamamen tarayıcında hesaplandı`;
  el.querySelector('#sm-out').innerHTML = `
    <ol class="summary">
      <li><b>En çok konuşulanlar:</b> ${topics.slice(0, 5).map((t) => `<span class="pill brand">#${esc(t)}</span>`).join(' ')} — en hareketli saat ${hot}.</li>
      <li><b>Sohbeti sürükleyenler:</b> ${talkers.map(([u, n]) => `${nm(u, sid)} (${n})`).join(', ')}.</li>
      <li><b>Öne çıkan:</b> ${best.map((m) => `<i>“${esc(m.content.slice(0, 140))}${m.content.length > 140 ? '…' : ''}”</i> — ${nm(m.author.id, sid)}`).join('<br>')}</li>
    </ol>
    ${gossip.length ? `<h4>🗣️ Dedikodu Köşesi</h4>${gossip.map((g2) => `<p>👀 <b>${nm(g2.a, sid)}</b>, <b>${nm(g2.b, sid)}</b> ile tam <b>${g2.n}</b> kez atıştı.</p>`).join('')}` : ''}
    <p class="muted" style="font-size:12px">Not: Bu özet yapay zekâ değil; kelime ve konuşma istatistiklerinden çıkarılır, hiçbir veri dışarı gönderilmez.</p>`;
}

// ================================================================ doodle botlar (16x16 piksel maskot + komut)
const doodles = new Map(); // server_id -> liste
export async function loadDoodles(sid, force) {
  if (!sid) return [];
  if (!doodles.has(sid) || force) { try { doodles.set(sid, await api.get(`/servers/${sid}/doodles`)); } catch { doodles.set(sid, []); } }
  return doodles.get(sid);
}
export const doodleCreated = (d) => { if (doodles.has(d.server_id)) doodles.get(d.server_id).push(d); };
export const doodleDeleted = (d) => { if (doodles.has(d.server_id)) doodles.set(d.server_id, doodles.get(d.server_id).filter((x) => x.id !== d.id)); };

export function checkDoodle(m) {
  const sid = m.server_id;
  const list = sid && doodles.get(sid);
  if (!list) return loadDoodles(sid);
  const t = (m.content || '').trim().toLowerCase();
  const d = list.find((x) => x.trigger === t);
  if (d) playDoodle(d);
}

function doodleCanvas(px, scale = 6) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16 * scale;
  const g = cv.getContext('2d');
  px.forEach((c, i) => { if (c) { g.fillStyle = c; g.fillRect((i % 16) * scale, Math.floor(i / 16) * scale, scale, scale); } });
  return cv;
}

export function playDoodle(d) {
  if (document.documentElement.dataset.lowend) return;
  const wrap = document.createElement('div');
  wrap.className = `doodle-play anim-${d.anim}`;
  wrap.appendChild(doodleCanvas(d.pixels, 8));
  const tag = document.createElement('span');
  tag.textContent = d.name;
  wrap.appendChild(tag);
  if (d.anim === 'balloon') {
    for (let i = 0; i < 8; i++) {
      const b = document.createElement('i');
      b.className = 'dd-balloon';
      b.textContent = '🎈';
      b.style.setProperty('--x', (Math.random() * 300 - 150) + 'px');
      b.style.animationDelay = i * 0.12 + 's';
      wrap.appendChild(b);
    }
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3200);
}

export async function doodleStudio(sid) {
  const COLORS = ['#000000', '#ffffff', '#ec4b4b', '#f97316', '#f0b232', '#2fbf71', '#14b8a6', '#3d8bfd', '#6c5ce7', '#e056a0', '#8b5a2b', '#9ca3af'];
  let px = Array(256).fill(null);
  let color = '#6c5ce7';
  let list = await loadDoodles(sid, true);
  const { el } = ctx.modal({ title: '🤖 Kendi Botunu Çiz (Doodle Bot)', wide: true, sub: '16x16 piksel karakterini çiz, bir komut ver. Kanalda o komut yazılınca herkesin ekranında karakterin canlanır!', body: '<div id="dd"></div>' });
  const box = el.querySelector('#dd');
  const draw = () => {
    box.innerHTML = `<div class="dd-studio"><div class="dd-grid" id="dd-grid">${px.map((c, i) => `<i data-i="${i}" style="${c ? `background:${c}` : ''}"></i>`).join('')}</div>
      <div class="dd-side"><div class="dd-pal">${COLORS.map((c) => `<button data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}"></button>`).join('')}<button data-c="" class="${!color ? 'on' : ''}" title="Silgi">🧽</button></div>
        <label class="field"><span>Ad</span><input class="input" id="dd-name" maxlength="24" placeholder="Bloby"></label>
        <label class="field"><span>Komut</span><input class="input" id="dd-trig" maxlength="30" placeholder="!selam"></label>
        <label class="field"><span>Animasyon</span><select class="input" id="dd-anim"><option value="jump">🦘 Zıpla</option><option value="spin">🌀 Dön</option><option value="balloon">🎈 Balon patlat</option><option value="dance">💃 Dans et</option><option value="zoom">🚀 Ekrana fırla</option></select></label>
        <div class="row"><button class="btn ghost sm" id="dd-clear">Temizle</button><button class="btn ghost sm" id="dd-test">▶ Dene</button><button class="btn sm" id="dd-save">Kaydet</button></div></div></div>
      <h4>Bu sunucudaki doodle botlar</h4><div class="dd-list">${list.map((d) => `<div class="dd-item" data-id="${d.id}"><span class="dd-thumb"></span><b>${esc(d.name)}</b><code>${esc(d.trigger)}</code><small class="muted">${esc(d.user?.display_name || '')}</small>
        ${d.user_id === ctx.S.me.id || ctx.can(sid, ctx.P.MANAGE_SERVER) ? `<button class="icon-btn" data-del="${d.id}" title="Sil">🗑</button>` : ''}</div>`).join('') || '<p class="muted">Henüz yok — ilkini sen çiz!</p>'}</div>`;
    box.querySelectorAll('.dd-item').forEach((it) => { const d = list.find((x) => x.id === it.dataset.id); it.querySelector('.dd-thumb').appendChild(doodleCanvas(d.pixels, 2)); });
    const grid = box.querySelector('#dd-grid');
    let painting = false;
    const paint = (e) => { const c = e.target.closest('[data-i]'); if (!c) return; px[+c.dataset.i] = color || null; c.style.background = color || ''; };
    grid.onpointerdown = (e) => { painting = true; paint(e); };
    grid.onpointerover = (e) => { if (painting) paint(e); };
    window.addEventListener('pointerup', () => { painting = false; }, { once: true });
    box.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { color = b.dataset.c; box.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); });
    box.querySelector('#dd-clear').onclick = () => { px = Array(256).fill(null); draw(); };
    box.querySelector('#dd-test').onclick = () => playDoodle({ pixels: px, name: box.querySelector('#dd-name').value || 'Doodle', anim: box.querySelector('#dd-anim').value });
    box.querySelector('#dd-save').onclick = async () => {
      try {
        await api.post(`/servers/${sid}/doodles`, { pixels: px, name: box.querySelector('#dd-name').value, trigger: box.querySelector('#dd-trig').value, anim: box.querySelector('#dd-anim').value });
        ctx.toast('Doodle bot kaydedildi! Kanala komutunu yazmayı dene 🎉', 'ok');
        list = await loadDoodles(sid, true);
        px = Array(256).fill(null);
        draw();
      } catch (e) { ctx.fail(e); }
    };
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { try { await api.del('/doodles/' + b.dataset.del); list = await loadDoodles(sid, true); draw(); } catch (e) { ctx.fail(e); } });
  };
  draw();
}

// ================================================================ anonim itiraf
export function anonInfo(m) {
  const a = m.components?.anon;
  return a ? { code: a.code, color: a.color } : null;
}
