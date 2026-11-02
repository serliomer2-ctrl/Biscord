// Kanal etkinlikleri arayüzü: Bilgi Yarışması, ASCII Yılan, Arena, Birlikte İzleme
import { ctx } from '../ctx.js';
import { esc, icon, avatar } from '../util.js';

export const GAMES = {
  trivia: { name: 'Bilgi Yarışması', emoji: '🧠', desc: '10 soru, 15 saniye. Hızlı cevap daha çok puan!', players: '1-20 oyuncu' },
  snake: { name: 'ASCII Yılan', emoji: '🐍', desc: 'Retro terminal yılanı — aynı arenada birbirinizi sıkıştırın.', players: '1-8 oyuncu' },
  arena: { name: 'Arena', emoji: '⚔️', desc: 'Yukarıdan bakışlı nişancı kapışması. WASD + fare.', players: '1-10 oyuncu' },
  watch: { name: 'Birlikte İzle', emoji: '📺', desc: 'YouTube veya video bağlantısını herkes aynı saniyede izler.', players: 'Sınırsız' },
};

let mounted = null; // { cid, type, comp, host }

// Diğer modüller (collab.js, lobby.js) kendi etkinliklerini buraya ekler
export function registerActivity(type, meta, factory) {
  if (meta) GAMES[type] = meta;
  COMPONENTS[type] = factory;
}
export const mountedActivity = () => mounted;
export const sendInput = (data) => mounted && ctx.socket.emit('act:input', { channel_id: mounted.cid, data });

// Katılırken sunucunun ilk durumu, arayüz kurulmadan gelebilir; son durumu saklayıp kurulumda uygularız
const lastState = new Map();

export function initActivities(socket) {
  socket.on('act:state', (d) => { if (d.ended) lastState.delete(d.channel_id); else lastState.set(d.channel_id, d); });
  socket.on('act:op', (d) => {
    if (!mounted || mounted.cid !== d.channel_id) return;
    try { mounted.comp.op?.(d.op); } catch (e) { console.error('etkinlik işlemi', e); }
  });
  socket.on('act:state', (d) => {
    if (!mounted || mounted.cid !== d.channel_id) return;
    if (d.ended) {
      unmount();
      ctx.toast('Etkinlik sona erdi');
      renderActivityArea();
      return;
    }
    mounted.host = d.host;
    try { mounted.comp.update(d.state); } catch (e) { console.error('etkinlik çizimi', e); }
    drawHead();
  });
  socket.on('disconnect', () => { if (mounted) { unmount(); renderActivityArea(); } });
}

const emit = (ev, data) => new Promise((r) => ctx.socket.emit(ev, data, r));

export function pickActivity(ch, only) {
  const { el, close } = ctx.modal({
    title: '🎮 Etkinlik Başlat', wide: true,
    sub: 'Kanaldaki herkes katılabilir ya da izleyebilir.',
    body: `<div class="act-pick">${Object.entries(GAMES).filter(([k, g]) => !g.hidden && (!only || only.includes(k))).map(([k, g]) => `<button class="act-card" data-t="${k}"><div class="ac-emoji">${g.emoji}</div><b>${g.name}</b><small>${g.desc}</small><span class="pill">${g.players}</span></button>`).join('')}</div>`,
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const r = await emit('act:start', { channel_id: ch.id, type: b.dataset.t });
    if (!r?.ok) return ctx.toast(r?.error || 'Başlatılamadı', 'error');
    close();
    ctx.S.activities.set(ch.id, r.activity);
    mount(ch.id, b.dataset.t, r.activity.host);
  });
}

export async function joinActivity(cid, play = true) {
  const act = ctx.S.activities.get(cid);
  if (!act) return;
  const r = await emit('act:join', { channel_id: cid, play });
  if (!r?.ok) { ctx.toast(r?.error || 'Katılınamadı', 'error'); if (!/dolu/.test(r?.error || '')) return; }
  mount(cid, act.type, act.host);
}

function leave() {
  if (!mounted) return;
  ctx.socket.emit('act:leave', { channel_id: mounted.cid });
  unmount();
  renderActivityArea();
}

function unmount() {
  if (!mounted) return;
  try { mounted.comp.destroy(); } catch { /* yok */ }
  mounted = null;
  document.querySelector('#activity-area')?.classList.remove('open');
}

// Kanal değişince ya da etkinlik durumu güncellenince çağrılır
export function renderActivityArea() {
  const area = document.querySelector('#activity-area');
  const cid = ctx.S.view.cid;
  if (mounted && mounted.cid !== cid) { ctx.socket.emit('act:leave', { channel_id: mounted.cid }); unmount(); }
  if (!area) return;
  const act = ctx.S.activities.get(cid);
  if (act?.type === 'lobby') return; // lobi kendi görünümünü yönetir
  if (mounted && mounted.cid === cid) {
    if (!act) { unmount(); area.innerHTML = ''; } else drawHead();
    return;
  }
  if (!act) { area.innerHTML = ''; area.classList.remove('open'); return; }
  const g = GAMES[act.type];
  area.classList.remove('open');
  area.innerHTML = `<div class="act-banner"><span class="ab-emoji">${g.emoji}</span><div class="grow"><b>${g.name}</b>
    <small>${act.players.length} kişi ${act.type === 'watch' ? 'izliyor' : 'oynuyor'} • ${esc(ctx.displayName(act.host, act.server_id))} başlattı</small></div>
    <div class="row">${act.players.slice(0, 5).map((u) => avatar(ctx.user(u), 24)).join('')}</div>
    ${act.type !== 'watch' ? '<button class="btn secondary sm" data-act-watch>İzle</button>' : ''}<button class="btn green sm" data-act-join>${act.type === 'watch' ? 'İzlemeye Katıl' : 'Katıl'}</button></div>`;
  area.querySelector('[data-act-join]').onclick = () => joinActivity(cid, true);
  area.querySelector('[data-act-watch]')?.addEventListener('click', () => joinActivity(cid, false));
}

export async function startOrJoin(cid, type) {
  if (!ctx.S.activities.has(cid)) {
    const r = await emit('act:start', { channel_id: cid, type });
    if (r?.ok) { ctx.S.activities.set(cid, r.activity); mount(cid, type, r.activity.host); return true; }
    if (!/zaten/.test(r?.error || '')) { ctx.toast(r?.error || 'Başlatılamadı', 'error'); return false; }
  }
  await joinActivity(cid, true);
  return true;
}

function mount(cid, type, host) {
  const area = document.querySelector('#activity-area');
  if (!area || ctx.S.view.cid !== cid) return;
  if (mounted) unmount();
  area.classList.add('open');
  area.innerHTML = `<div class="activity act-${type}"><div class="act-head" id="act-head"></div><div class="act-body" id="act-body"></div></div>`;
  const body = area.querySelector('#act-body');
  mounted = { cid, type, host, comp: COMPONENTS[type](body, (data) => ctx.socket.emit('act:input', { channel_id: cid, data })) };
  const early = lastState.get(cid);
  if (early?.state && early.type === type) {
    mounted.host = early.host;
    try { mounted.comp.update(early.state); } catch (e) { console.error('etkinlik çizimi', e); }
  }
  drawHead();
}

function drawHead() {
  const h = document.querySelector('#act-head');
  if (!h || !mounted) return;
  const act = ctx.S.activities.get(mounted.cid);
  const g = GAMES[mounted.type];
  const isHost = mounted.host === ctx.S.me.id;
  const canEnd = isHost || ctx.can(act?.server_id, ctx.P.MANAGE_CHANNELS);
  h.innerHTML = `<span>${g.emoji} <b>${g.name}</b></span><span class="muted">${act ? act.players.length : 0} katılımcı</span><span class="grow"></span>
    ${canEnd ? `<button class="btn ghost sm" data-act-end>${icon('x', 'sm')} Bitir</button>` : ''}<button class="btn secondary sm" data-act-leave>Ayrıl</button>`;
  h.querySelector('[data-act-leave]').onclick = leave;
  h.querySelector('[data-act-end]')?.addEventListener('click', async () => {
    const r = await emit('act:end', { channel_id: mounted.cid });
    if (r?.ok === false) ctx.toast(r.error, 'error');
  });
}

const name = (uid) => esc(ctx.displayName(uid, ctx.S.activities.get(mounted?.cid)?.server_id));
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]');

// ================================================================ bileşenler
const COMPONENTS = {
  // ---------------------------------------------------------------- Bilgi Yarışması
  trivia(el, send) {
    const LETTERS = ['A', 'B', 'C', 'D'];
    let timer = null;
    return {
      update(s) {
        const me = ctx.S.me.id;
        const scores = Object.entries(s.scores).sort((a, b) => b[1] - a[1]);
        const board = `<div class="tv-board">${scores.map(([u, p], i) => `<div class="tv-score ${u === me ? 'me' : ''}"><span>${i + 1}.</span>${avatar(ctx.user(u), 22)}<b class="grow">${name(u)}</b>${s.answered.includes(u) && s.phase === 'question' ? '✔️' : ''}<span>${p}</span></div>`).join('')}</div>`;
        let main = '';
        if (s.phase === 'lobby') {
          main = `<div class="tv-center"><div style="font-size:54px">🧠</div><h2>Bilgi Yarışması</h2><p class="muted">10 soru • her soru için 15 saniye • hızlı doğru cevap daha çok puan</p>
            ${mounted.host === me ? '<button class="btn green" data-begin>Yarışmayı Başlat</button>' : '<p>Başlatan kişinin oyunu başlatması bekleniyor…</p>'}</div>`;
        } else if (s.phase === 'end') {
          const top = scores.slice(0, 3);
          main = `<div class="tv-center"><h2>🏆 Yarışma Bitti!</h2><div class="podium">${top.map(([u, p], i) => `<div class="pod p${i + 1}">${avatar(ctx.user(u), 48)}<b>${name(u)}</b><span>${p} puan</span><i>${['🥇', '🥈', '🥉'][i]}</i></div>`).join('')}</div>
            ${mounted.host === me ? '<button class="btn green" data-begin>Tekrar Oyna</button>' : ''}</div>`;
        } else {
          const q = s.question;
          const myAns = s.reveal ? s.reveal.answers[me] : undefined;
          const answered = s.answered.includes(me);
          main = `<div class="tv-q"><div class="tv-round">Soru ${s.round}/${s.rounds}</div><h3>${esc(q.text)}</h3>
            ${s.phase === 'question' ? '<div class="tv-timer"><i id="tv-bar"></i></div>' : ''}
            <div class="tv-opts">${q.options.map((o, i) => {
              let cls = '';
              if (s.reveal) cls = i === s.reveal.correct ? 'correct' : i === myAns ? 'wrong' : 'dim';
              return `<button class="tv-opt o${i} ${cls}" data-ans="${i}" ${s.phase !== 'question' || answered ? 'disabled' : ''}><b>${LETTERS[i]}</b>${esc(o)}</button>`;
            }).join('')}</div>
            ${s.reveal ? `<p class="tv-msg">${s.reveal.gained[me] ? `✅ Doğru! +${s.reveal.gained[me]} puan` : myAns === undefined ? '⏰ Süre doldu' : '❌ Yanlış cevap'}</p>` : answered ? '<p class="tv-msg">Cevabın alındı, diğerleri bekleniyor…</p>' : ''}</div>`;
        }
        el.innerHTML = `<div class="tv">${main}${board}</div>`;
        el.querySelector('[data-begin]')?.addEventListener('click', () => send({ cmd: 'begin' }));
        el.querySelectorAll('[data-ans]').forEach((b) => b.onclick = () => send({ answer: +b.dataset.ans }));
        const bar = el.querySelector('#tv-bar');
        if (bar) {
          const remaining = Math.max(0, s.deadline - s.server_now);
          const pct = Math.min(100, (remaining / 15000) * 100);
          bar.style.width = pct + '%';
          requestAnimationFrame(() => { bar.style.transition = `width ${remaining}ms linear`; bar.style.width = '0%'; });
        }
      },
      destroy() { clearTimeout(timer); },
    };
  },

  // ---------------------------------------------------------------- ASCII Yılan
  snake(el, send) {
    el.innerHTML = `<div class="snake-wrap"><canvas id="sn-cv"></canvas><div class="sn-side"><div id="sn-board"></div>
      <p class="muted" style="font-size:12px">Yön tuşları veya WASD ile oyna. Duvara, kendine ya da başkasına çarparsan 3 sn sonra yeniden doğarsın.</p>
      <div class="dpad"><button data-d="u">▲</button><button data-d="l">◀</button><button data-d="r">▶</button><button data-d="d">▼</button></div></div></div>`;
    const cv = el.querySelector('#sn-cv');
    const g = cv.getContext('2d');
    const KEYS = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', KeyW: 'u', KeyS: 'd', KeyA: 'l', KeyD: 'r' };
    const onKey = (e) => {
      const d = KEYS[e.code];
      if (!d || typing(e)) return;
      e.preventDefault();
      send({ dir: d });
    };
    addEventListener('keydown', onKey);
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => send({ dir: b.dataset.d }));
    return {
      update(s) {
        const cols = s.w + 2;
        const rows = s.h + 2;
        const cell = Math.max(10, Math.min(22, Math.floor((el.clientWidth - 200) / cols)));
        cv.width = cols * cell;
        cv.height = rows * cell;
        g.fillStyle = '#05070a';
        g.fillRect(0, 0, cv.width, cv.height);
        g.font = `bold ${cell}px ui-monospace, Consolas, monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const put = (x, y, ch, color) => { g.fillStyle = color; g.fillText(ch, (x + 1.5) * cell, (y + 1.5) * cell + 1); };
        for (let x = -1; x <= s.w; x++) { put(x, -1, '#', '#2b5d3a'); put(x, s.h, '#', '#2b5d3a'); }
        for (let y = 0; y < s.h; y++) { put(-1, y, '#', '#2b5d3a'); put(s.w, y, '#', '#2b5d3a'); }
        for (const [x, y] of s.food) put(x, y, '*', '#ffd84d');
        for (const sn of s.snakes) {
          sn.body.forEach(([x, y], i) => put(x, y, i === 0 ? '@' : 'o', i === 0 ? '#fff' : sn.color));
          if (sn.body[0]) {
            g.font = `600 ${Math.max(9, cell * 0.6)}px Inter, sans-serif`;
            g.fillStyle = sn.color;
            g.fillText(ctx.displayName(sn.uid).slice(0, 10), (sn.body[0][0] + 1.5) * cell, (sn.body[0][1] + 0.6) * cell);
            g.font = `bold ${cell}px ui-monospace, Consolas, monospace`;
          }
        }
        el.querySelector('#sn-board').innerHTML = [...s.snakes].sort((a, b) => b.score - a.score).map((sn) => `<div class="tv-score ${sn.uid === ctx.S.me.id ? 'me' : ''}">
          <i class="dotc" style="background:${sn.color}"></i><b class="grow">${name(sn.uid)}</b>${sn.alive ? '' : '💀'}<span>${sn.score}</span></div>`).join('');
      },
      destroy() { removeEventListener('keydown', onKey); },
    };
  },

  // ---------------------------------------------------------------- Arena
  arena(el, send) {
    el.innerHTML = `<div class="arena-wrap"><canvas id="ar-cv" width="900" height="520"></canvas>
      <div class="ar-hud"><div id="ar-board"></div><div id="ar-feed"></div></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Hareket: WASD / yön tuşları • Nişan: fare • Ateş: sol tık veya Boşluk</p>
      <div class="ar-touch"><div class="dpad"><button data-k="u">▲</button><button data-k="l">◀</button><button data-k="r">▶</button><button data-k="d">▼</button></div><button class="btn red" data-fire>🔥 Ateş</button></div></div>`;
    const cv = el.querySelector('#ar-cv');
    const g = cv.getContext('2d');
    const keys = { u: false, d: false, l: false, r: false };
    let angle = 0;
    let shoot = false;
    let prev = null;
    let cur = null;
    let curAt = 0;
    let raf = 0;
    let lastAngleSent = 0;
    const MAP = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
    const push = () => send({ keys, angle, shoot });
    const onDown = (e) => {
      if (typing(e)) return;
      if (MAP[e.code]) { e.preventDefault(); if (!keys[MAP[e.code]]) { keys[MAP[e.code]] = true; push(); } }
      if (e.code === 'Space') { e.preventDefault(); if (!shoot) { shoot = true; push(); } }
    };
    const onUp = (e) => {
      if (MAP[e.code] && keys[MAP[e.code]]) { keys[MAP[e.code]] = false; push(); }
      if (e.code === 'Space' && shoot) { shoot = false; push(); }
    };
    addEventListener('keydown', onDown);
    addEventListener('keyup', onUp);
    const toWorld = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    cv.addEventListener('mousemove', (e) => {
      const me = cur?.players.find((p) => p.uid === ctx.S.me.id);
      if (!me) return;
      const [x, y] = toWorld(e);
      angle = Math.atan2(y - me.y, x - me.x);
      if (performance.now() - lastAngleSent > 50) { lastAngleSent = performance.now(); send({ angle }); }
    });
    cv.addEventListener('mousedown', (e) => { e.preventDefault(); shoot = true; push(); });
    addEventListener('mouseup', () => { if (shoot) { shoot = false; push(); } });
    el.querySelectorAll('[data-k]').forEach((b) => {
      const k = b.dataset.k;
      b.onpointerdown = () => { keys[k] = true; push(); };
      b.onpointerup = b.onpointerleave = () => { keys[k] = false; push(); };
    });
    const fire = el.querySelector('[data-fire]');
    fire.onpointerdown = () => { shoot = true; push(); };
    fire.onpointerup = fire.onpointerleave = () => { shoot = false; push(); };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!cur) return;
      const t = Math.min(1, (performance.now() - curAt) / 50);
      const lerp = (a, b) => a + (b - a) * t;
      g.fillStyle = '#101317';
      g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = 'rgba(255,255,255,.04)';
      for (let x = 0; x < cv.width; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); }
      for (let y = 0; y < cv.height; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(cv.width, y); g.stroke(); }
      g.fillStyle = '#2a2f3a';
      for (const [x, y, w, h] of cur.obstacles) g.fillRect(x, y, w, h);
      g.fillStyle = '#ffd84d';
      for (const [x, y] of cur.bullets) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
      for (const p of cur.players) {
        if (!p.alive) continue;
        const pp = prev?.players.find((q) => q.uid === p.uid);
        const x = pp?.alive ? lerp(pp.x, p.x) : p.x;
        const y = pp?.alive ? lerp(pp.y, p.y) : p.y;
        const a = p.uid === ctx.S.me.id ? angle : p.a;
        g.fillStyle = p.color;
        g.beginPath(); g.arc(x, y, cur.r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (cur.r + 10), y + Math.sin(a) * (cur.r + 10)); g.stroke();
        g.lineWidth = 1;
        g.fillStyle = '#000a'; g.fillRect(x - 20, y - cur.r - 12, 40, 5);
        g.fillStyle = p.hp > 50 ? '#2fbf71' : p.hp > 25 ? '#f0b232' : '#ec4b4b'; g.fillRect(x - 20, y - cur.r - 12, 40 * (p.hp / 100), 5);
        g.fillStyle = '#fff'; g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText(ctx.displayName(p.uid).slice(0, 14), x, y - cur.r - 16);
      }
      const me = cur.players.find((p) => p.uid === ctx.S.me.id);
      if (me && !me.alive) { g.fillStyle = '#000a'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#fff'; g.font = 'bold 32px Inter'; g.textAlign = 'center'; g.fillText('💀 Yeniden doğuyorsun…', cv.width / 2, cv.height / 2); }
    };
    raf = requestAnimationFrame(draw);
    return {
      update(s) {
        prev = cur;
        cur = s;
        curAt = performance.now();
        el.querySelector('#ar-board').innerHTML = [...s.players].sort((a, b) => b.score - a.score).map((p) => `<div class="tv-score ${p.uid === ctx.S.me.id ? 'me' : ''}"><i class="dotc" style="background:${p.color}"></i><b class="grow">${name(p.uid)}</b><span>⚔️ ${p.score}</span><span class="muted">💀 ${p.deaths}</span></div>`).join('');
        el.querySelector('#ar-feed').innerHTML = s.feed.slice(0, 4).map((f) => `<div>${name(f.killer)} ⚔️ ${name(f.victim)}</div>`).join('');
      },
      destroy() { cancelAnimationFrame(raf); removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); },
    };
  },

  // ---------------------------------------------------------------- Birlikte İzle
  watch(el, send) {
    el.innerHTML = `<div class="watch"><form class="watch-bar" id="w-form"><input class="input grow" id="w-url" placeholder="YouTube bağlantısı veya .mp4/.webm video bağlantısı yapıştır"><button class="btn">Oynat</button></form>
      <div class="watch-stage" id="w-stage"><div class="empty"><div class="art">📺</div><p>Bir video bağlantısı yapıştır — kanaldaki herkes aynı anda izler. Durdurma, oynatma ve ileri sarma herkese yansır.</p></div></div>
      <div class="muted" id="w-info" style="font-size:12.5px;margin-top:6px"></div></div>`;
    const stage = el.querySelector('#w-stage');
    let st = null;
    let at = 0;
    let player = null;
    let kind = null;
    let loadedUrl = null;
    let applying = 0;
    let syncTimer = null;
    el.querySelector('#w-form').onsubmit = (e) => {
      e.preventDefault();
      const url = el.querySelector('#w-url').value.trim();
      if (url) send({ cmd: 'load', url });
      el.querySelector('#w-url').value = '';
    };
    const target = () => (st ? st.position + (st.playing ? (performance.now() - at) / 1000 : 0) : 0);
    const quiet = (fn) => { applying = performance.now(); fn(); };
    const isQuiet = () => performance.now() - applying < 700;

    const ytReady = () => new Promise((res) => {
      if (window.YT?.Player) return res();
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prevCb?.(); res(); };
      if (!document.getElementById('yt-api')) {
        const s = document.createElement('script');
        s.id = 'yt-api';
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    });

    const build = async () => {
      loadedUrl = st.url;
      kind = st.kind;
      player?.destroy?.();
      player = null;
      if (st.kind === 'youtube') {
        stage.innerHTML = '<div id="w-yt"></div>';
        await ytReady();
        if (loadedUrl !== st.url) return;
        await new Promise((res) => {
          player = new window.YT.Player('w-yt', {
            videoId: st.video_id, width: '100%', height: '100%',
            playerVars: { start: Math.floor(target()), autoplay: 1, playsinline: 1, rel: 0 },
            events: {
              onReady: res,
              onStateChange: (e) => {
                if (isQuiet()) return;
                if (e.data === 1) send({ cmd: 'play', position: player.getCurrentTime() });
                if (e.data === 2) send({ cmd: 'pause', position: player.getCurrentTime() });
              },
            },
          });
        });
      } else {
        stage.innerHTML = `<video id="w-vid" controls playsinline src="${esc(st.url)}"></video>`;
        const v = stage.querySelector('video');
        player = {
          getCurrentTime: () => v.currentTime, seekTo: (t) => { v.currentTime = t; },
          playVideo: () => v.play().catch(() => {}), pauseVideo: () => v.pause(),
          isPlaying: () => !v.paused, destroy: () => { v.pause(); v.removeAttribute('src'); },
        };
        v.onplay = () => { if (!isQuiet()) send({ cmd: 'play', position: v.currentTime }); };
        v.onpause = () => { if (!isQuiet() && !v.ended) send({ cmd: 'pause', position: v.currentTime }); };
        v.onseeked = () => { if (!isQuiet()) send({ cmd: 'seek', position: v.currentTime }); };
      }
      sync();
    };

    const sync = () => {
      if (!player || !st?.url) return;
      const t = target();
      const now = player.getCurrentTime?.() ?? 0;
      const playing = kind === 'youtube' ? player.getPlayerState?.() === 1 : player.isPlaying();
      quiet(() => {
        if (Math.abs(now - t) > 1.5) player.seekTo(t, true);
        if (st.playing && !playing) player.playVideo();
        if (!st.playing && playing) player.pauseVideo();
      });
    };
    syncTimer = setInterval(sync, 2000);

    return {
      update(s) {
        st = s;
        at = performance.now();
        el.querySelector('#w-info').textContent = s.url ? `${s.viewers.length} kişi izliyor • son işlem: ${ctx.displayName(s.by)}` : `${s.viewers.length} kişi bekliyor`;
        if (!s.url) return;
        if (s.url !== loadedUrl) build();
        else sync();
      },
      destroy() { clearInterval(syncTimer); player?.destroy?.(); },
    };
  },
};
