'use strict';
// Kanal etkinlikleri: Bilgi Yarışması, ASCII Yılan, Arena kapışması ve Birlikte İzleme.
// Oyun durumu sunucuda tutulur ve hesaplanır (hile önlenir); istemciler yalnızca girdi gönderir ve çizim yapar.
const BANK = require('./trivia-questions');

const COLORS = ['#2fbf71', '#f0b232', '#3d8bfd', '#ec4b4b', '#e056a0', '#14b8a6', '#a78bfa', '#f97316', '#84cc16', '#06b6d4'];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------------------------------------------------------------- Bilgi Yarışması
function trivia({ send, host }) {
  const ROUNDS = 10;
  const QTIME = 15000;
  const RTIME = 4500;
  let phase = 'lobby';
  let qi = -1;
  let list = [];
  let cur = null;
  let deadline = 0;
  let timer = null;
  let reveal = null;
  const answers = new Map();
  const scores = new Map();
  const players = new Set();

  const next = () => {
    qi++;
    if (qi >= ROUNDS) { phase = 'end'; cur = null; reveal = null; return send(); }
    const [text, correct, ...wrong] = list[qi];
    const options = shuffle([correct, ...wrong]);
    cur = { text, options, correct: options.indexOf(correct) };
    answers.clear();
    reveal = null;
    phase = 'question';
    deadline = Date.now() + QTIME;
    clearTimeout(timer);
    timer = setTimeout(doReveal, QTIME);
    send();
  };
  const doReveal = () => {
    if (phase !== 'question') return;
    clearTimeout(timer);
    phase = 'reveal';
    const gained = {};
    for (const [uid, a] of answers) {
      if (a.answer === cur.correct) {
        const pts = 500 + Math.round(500 * Math.max(0, deadline - a.at) / QTIME);
        scores.set(uid, (scores.get(uid) || 0) + pts);
        gained[uid] = pts;
      }
    }
    reveal = { correct: cur.correct, answers: Object.fromEntries([...answers].map(([u, a]) => [u, a.answer])), gained };
    send();
    timer = setTimeout(next, RTIME);
  };
  return {
    max: 20,
    join(uid) { players.add(uid); if (!scores.has(uid)) scores.set(uid, 0); send(); },
    leave(uid) { players.delete(uid); answers.delete(uid); send(); },
    input(uid, d) {
      if (d?.cmd === 'begin' && phase !== 'question' && phase !== 'reveal' && uid === host()) {
        list = shuffle(BANK).slice(0, ROUNDS);
        for (const p of players) scores.set(p, 0);
        qi = -1;
        next();
      } else if (phase === 'question' && Number.isInteger(d?.answer) && !answers.has(uid) && players.has(uid)) {
        answers.set(uid, { answer: d.answer, at: Date.now() });
        if ([...players].every((p) => answers.has(p))) doReveal();
        else send();
      }
    },
    snapshot() {
      return {
        phase, round: qi + 1, rounds: ROUNDS, deadline, server_now: Date.now(), reveal,
        question: cur ? { text: cur.text, options: cur.options } : null,
        answered: [...answers.keys()], scores: Object.fromEntries(scores),
      };
    },
    destroy() { clearTimeout(timer); },
  };
}

// ---------------------------------------------------------------- ASCII Yılan
function snake({ send }) {
  const W = 32;
  const H = 20;
  const D = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const OPP = { u: 'd', d: 'u', l: 'r', r: 'l' };
  const snakes = new Map();
  let food = [];
  let colorIdx = 0;
  const occupied = () => {
    const s = new Set();
    for (const sn of snakes.values()) for (const [x, y] of sn.body) s.add(x + ',' + y);
    for (const [x, y] of food) s.add(x + ',' + y);
    return s;
  };
  const freeCell = (margin = 0) => {
    const occ = occupied();
    for (let i = 0; i < 200; i++) {
      const x = margin + Math.floor(Math.random() * (W - margin * 2));
      const y = margin + Math.floor(Math.random() * (H - margin * 2));
      if (!occ.has(x + ',' + y)) return [x, y];
    }
    return [Math.floor(W / 2), Math.floor(H / 2)];
  };
  const spawn = (sn) => {
    const [x, y] = freeCell(4);
    sn.body = [[x, y], [x - 1, y], [x - 2, y]];
    sn.dir = sn.next = 'r';
    sn.alive = true;
  };
  const fillFood = () => { while (food.length < Math.min(6, 2 + snakes.size)) food.push(freeCell()); };

  const tick = () => {
    if (!snakes.size) return;
    const t = Date.now();
    for (const sn of snakes.values()) if (!sn.alive && t >= sn.respawn) spawn(sn);
    const heads = new Map();
    for (const sn of snakes.values()) {
      if (!sn.alive) continue;
      sn.dir = sn.next;
      const [dx, dy] = D[sn.dir];
      const head = [sn.body[0][0] + dx, sn.body[0][1] + dy];
      sn.newHead = head;
      const ate = food.findIndex(([fx, fy]) => fx === head[0] && fy === head[1]);
      sn.ate = ate;
      heads.set(sn, head);
    }
    // gövdeler (bu tur kuyruklar hareket eder)
    const bodies = new Set();
    for (const sn of snakes.values()) {
      if (!sn.alive) continue;
      const b = sn.ate >= 0 ? sn.body : sn.body.slice(0, -1);
      for (const [x, y] of b) bodies.add(x + ',' + y);
    }
    const headCount = new Map();
    for (const h of heads.values()) headCount.set(h + '', (headCount.get(h + '') || 0) + 1);
    for (const [sn, h] of heads) {
      const dead = h[0] < 0 || h[1] < 0 || h[0] >= W || h[1] >= H || bodies.has(h[0] + ',' + h[1]) || headCount.get(h + '') > 1;
      if (dead) {
        sn.alive = false;
        sn.respawn = t + 3000;
        for (const [x, y] of sn.body.filter((_, i) => i % 2 === 0)) if (food.length < 14) food.push([x, y]); // ölen yılan yem bırakır
        sn.body = [];
        continue;
      }
      sn.body.unshift(h);
      if (sn.ate >= 0) { sn.score++; food = food.filter((f) => !(f[0] === h[0] && f[1] === h[1])); } else sn.body.pop();
      sn.best = Math.max(sn.best, sn.body.length);
    }
    fillFood();
    send();
  };
  const timer = setInterval(tick, 130);

  return {
    max: 8,
    join(uid) {
      if (!snakes.has(uid)) {
        const sn = { body: [], score: 0, best: 3, color: COLORS[colorIdx++ % COLORS.length] };
        snakes.set(uid, sn);
        spawn(sn);
        fillFood();
      }
      send();
    },
    leave(uid) { snakes.delete(uid); send(); },
    input(uid, d) {
      const sn = snakes.get(uid);
      if (sn && D[d?.dir] && OPP[d.dir] !== sn.dir) sn.next = d.dir;
    },
    snapshot() {
      return {
        w: W, h: H, food,
        snakes: [...snakes].map(([uid, s]) => ({ uid, body: s.body, color: s.color, alive: s.alive, score: s.score, best: s.best })),
      };
    },
    destroy() { clearInterval(timer); },
  };
}

// ---------------------------------------------------------------- Arena kapışması
function arena({ send }) {
  const W = 900;
  const H = 520;
  const R = 16;
  const OBST = [[150, 210, 60, 100], [690, 210, 60, 100], [420, 60, 60, 110], [420, 350, 60, 110]];
  const players = new Map();
  let bullets = [];
  const feed = [];
  let colorIdx = 0;
  const inRect = (x, y, r, [rx, ry, rw, rh]) => {
    const cx = Math.max(rx, Math.min(x, rx + rw));
    const cy = Math.max(ry, Math.min(y, ry + rh));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  };
  const spawnPos = () => {
    for (let i = 0; i < 50; i++) {
      const x = R + Math.random() * (W - 2 * R);
      const y = R + Math.random() * (H - 2 * R);
      if (!OBST.some((o) => inRect(x, y, R + 8, o))) return [x, y];
    }
    return [60, 60];
  };
  const respawn = (p) => { [p.x, p.y] = spawnPos(); p.hp = 100; p.alive = true; };

  let last = Date.now();
  const tick = () => {
    if (!players.size) return;
    const t = Date.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    for (const p of players.values()) {
      if (!p.alive) { if (t >= p.deadUntil) respawn(p); continue; }
      let vx = (p.keys.r ? 1 : 0) - (p.keys.l ? 1 : 0);
      let vy = (p.keys.d ? 1 : 0) - (p.keys.u ? 1 : 0);
      const len = Math.hypot(vx, vy) || 1;
      vx = (vx / len) * 230 * dt;
      vy = (vy / len) * 230 * dt;
      const nx = Math.max(R, Math.min(W - R, p.x + vx));
      if (!OBST.some((o) => inRect(nx, p.y, R, o))) p.x = nx;
      const ny = Math.max(R, Math.min(H - R, p.y + vy));
      if (!OBST.some((o) => inRect(p.x, ny, R, o))) p.y = ny;
      if (p.shoot && t - p.lastShot > 280) {
        p.lastShot = t;
        bullets.push({ x: p.x + Math.cos(p.angle) * (R + 4), y: p.y + Math.sin(p.angle) * (R + 4), vx: Math.cos(p.angle) * 560, vy: Math.sin(p.angle) * 560, owner: p.uid, die: t + 1300 });
      }
    }
    const alive = [];
    for (const b of bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (t > b.die || b.x < 0 || b.y < 0 || b.x > W || b.y > H || OBST.some((o) => inRect(b.x, b.y, 3, o))) continue;
      let hit = false;
      for (const p of players.values()) {
        if (!p.alive || p.uid === b.owner || (p.x - b.x) ** 2 + (p.y - b.y) ** 2 > R * R) continue;
        hit = true;
        p.hp -= 25;
        if (p.hp <= 0) {
          p.alive = false;
          p.deadUntil = t + 3000;
          p.deaths++;
          const killer = players.get(b.owner);
          if (killer) killer.score++;
          feed.unshift({ killer: b.owner, victim: p.uid, at: t });
          feed.length = Math.min(feed.length, 5);
        }
        break;
      }
      if (!hit) alive.push(b);
    }
    bullets = alive;
    send();
  };
  const timer = setInterval(tick, 50);

  return {
    max: 10,
    join(uid) {
      if (!players.has(uid)) {
        const p = { uid, keys: {}, angle: 0, shoot: false, lastShot: 0, score: 0, deaths: 0, color: COLORS[colorIdx++ % COLORS.length] };
        respawn(p);
        players.set(uid, p);
      }
      send();
    },
    leave(uid) { players.delete(uid); send(); },
    input(uid, d) {
      const p = players.get(uid);
      if (!p || !d) return;
      if (d.keys) p.keys = { u: !!d.keys.u, d: !!d.keys.d, l: !!d.keys.l, r: !!d.keys.r };
      if (Number.isFinite(d.angle)) p.angle = d.angle;
      if ('shoot' in d) p.shoot = !!d.shoot;
    },
    snapshot() {
      return {
        w: W, h: H, r: R, obstacles: OBST, feed,
        players: [...players.values()].map((p) => ({ uid: p.uid, x: Math.round(p.x), y: Math.round(p.y), hp: p.hp, a: +p.angle.toFixed(2), color: p.color, score: p.score, deaths: p.deaths, alive: p.alive })),
        bullets: bullets.map((b) => [Math.round(b.x), Math.round(b.y)]),
      };
    },
    destroy() { clearInterval(timer); },
  };
}

// ---------------------------------------------------------------- Birlikte İzleme
function parseVideo(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com')) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];
  }
  if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'youtube', video_id: id, url: `https://www.youtube.com/watch?v=${id}` };
  if (/\.(mp4|webm|ogg|ogv|mov)(\?|$)/i.test(u.pathname + u.search) || u.pathname.startsWith('/uploads/')) return { kind: 'video', url: u.href };
  return null;
}

function watch({ send }) {
  const s = { url: null, kind: null, video_id: null, playing: false, position: 0, updated_at: Date.now(), by: null };
  const pos = () => s.position + (s.playing ? (Date.now() - s.updated_at) / 1000 : 0);
  const viewers = new Set();
  return {
    max: 50,
    join(uid) { viewers.add(uid); send(); },
    leave(uid) { viewers.delete(uid); send(); },
    input(uid, d) {
      if (d?.cmd === 'load') {
        const v = parseVideo(d.url);
        if (!v) return;
        Object.assign(s, v, { video_id: v.video_id || null, playing: true, position: 0, updated_at: Date.now(), by: uid });
      } else if (d?.cmd === 'play' || d?.cmd === 'pause' || d?.cmd === 'seek') {
        if (!s.url) return;
        const p = Number(d.position);
        s.position = Number.isFinite(p) && p >= 0 ? p : pos();
        if (d.cmd === 'play') s.playing = true;
        if (d.cmd === 'pause') s.playing = false;
        s.updated_at = Date.now();
        s.by = uid;
      } else return;
      send();
    },
    snapshot() { return { ...s, position: pos(), server_now: Date.now(), viewers: [...viewers] }; },
    destroy() {},
  };
}

// ---------------------------------------------------------------- Ortak Çizim Tahtası
const round4 = (n) => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 10000) / 10000;
const COLOR = /^#[0-9a-f]{6}$/i;

function whiteboard({ op, send }) {
  let strokes = [];
  return {
    max: 50,
    join() { send(); },
    leave() {},
    input(uid, d) {
      if (d?.cmd === 'seg') {
        op({ cmd: 'seg', uid, id: String(d.id).slice(0, 24), color: COLOR.test(d.color) ? d.color : '#ffffff', size: Math.min(40, Math.max(1, +d.size || 4)), tool: d.tool === 'erase' ? 'erase' : 'pen', pts: (d.pts || []).slice(0, 40).map(([x, y]) => [round4(x), round4(y)]) });
      } else if (d?.cmd === 'stroke') {
        const s = d.s || {};
        const pts = (Array.isArray(s.pts) ? s.pts : []).slice(0, 2000).map(([x, y]) => [round4(x), round4(y)]);
        const stroke = { id: String(s.id).slice(0, 24), uid, color: COLOR.test(s.color) ? s.color : '#ffffff', size: Math.min(40, Math.max(1, +s.size || 4)), tool: ['pen', 'erase', 'text'].includes(s.tool) ? s.tool : 'pen', pts, text: s.tool === 'text' ? String(s.text || '').slice(0, 120) : undefined };
        if (!pts.length) return;
        strokes.push(stroke);
        if (strokes.length > 3000) strokes = strokes.slice(-3000);
        op({ cmd: 'stroke', s: stroke });
      } else if (d?.cmd === 'undo') {
        const i = strokes.map((s) => s.uid).lastIndexOf(uid);
        if (i >= 0) { const [s] = strokes.splice(i, 1); op({ cmd: 'remove', id: s.id }); }
      } else if (d?.cmd === 'clear') {
        strokes = [];
        op({ cmd: 'clear', uid });
      }
    },
    snapshot() { return { strokes }; },
    destroy() {},
  };
}

// ---------------------------------------------------------------- Sanal Masaüstü
function desktop({ op, send }) {
  const items = new Map();
  let theme = 'win95';
  let z = 1;
  const APPS = ['calc', 'clock', 'notepad', 'music', 'trash'];
  return {
    max: 50,
    join() { send(); },
    leave() {},
    input(uid, d) {
      const it = d?.id && items.get(String(d.id));
      if (d?.cmd === 'add') {
        if (items.size >= 80) return;
        const type = ['note', 'image', 'link', 'app'].includes(d.type) ? d.type : 'note';
        const url = typeof d.url === 'string' && /^(https:\/\/|\/uploads\/)/.test(d.url) ? d.url.slice(0, 1000) : undefined;
        if ((type === 'image' || type === 'link') && !url) return;
        const item = {
          id: String(d.id || Math.random().toString(36).slice(2)).slice(0, 24), type, by: uid, z: ++z,
          x: round4(d.x ?? 0.4), y: round4(d.y ?? 0.3),
          text: String(d.text || '').slice(0, 2000), url, app: APPS.includes(d.app) ? d.app : undefined,
          color: COLOR.test(d.color) ? d.color : '#fff59d',
        };
        items.set(item.id, item);
        op({ cmd: 'add', item });
      } else if (d?.cmd === 'move' && it) {
        it.x = round4(d.x); it.y = round4(d.y); it.z = ++z;
        op({ cmd: 'move', id: it.id, x: it.x, y: it.y, z: it.z, uid });
      } else if (d?.cmd === 'edit' && it) {
        it.text = String(d.text || '').slice(0, 2000);
        op({ cmd: 'edit', id: it.id, text: it.text, uid });
      } else if (d?.cmd === 'del' && it) {
        items.delete(it.id);
        op({ cmd: 'del', id: it.id });
      } else if (d?.cmd === 'theme' && ['win95', 'xp', 'cyber'].includes(d.theme)) {
        theme = d.theme;
        op({ cmd: 'theme', theme });
      }
    },
    snapshot() { return { theme, items: [...items.values()] }; },
    destroy() {},
  };
}

// ---------------------------------------------------------------- Ortak Kod Editörü (OT: aynı anda yazma)
// İşlemler: { t:'ins', p, s } ya da { t:'del', p, n }
// a'yı, b zaten uygulanmış belgeye göre dönüştürür. aFirst: aynı noktaya iki ekleme olursa a önce gelir.
// Kural: bir silme aralığının İÇİNE düşen ekleme de silinir (iki taraf da aynı sonuca varır).
function transform(a, b, aFirst = false) {
  if (!a || !b) return a;
  if (a.t === 'ins') {
    if (b.t === 'ins') return b.p < a.p || (b.p === a.p && !aFirst) ? { ...a, p: a.p + b.s.length } : a;
    if (a.p <= b.p) return a;
    if (a.p >= b.p + b.n) return { ...a, p: a.p - b.n };
    return null; // silinen aralığın içine yazılmıştı
  }
  if (b.t === 'ins') {
    if (b.p >= a.p + a.n) return a;
    if (b.p <= a.p) return { ...a, p: a.p + b.s.length };
    return { ...a, n: a.n + b.s.length }; // araya eklenen metin de silinir
  }
  // ikisi de silme
  const aEnd = a.p + a.n;
  const bEnd = b.p + b.n;
  if (bEnd <= a.p) return { ...a, p: a.p - b.n };
  if (b.p >= aEnd) return a;
  const overlap = Math.min(aEnd, bEnd) - Math.max(a.p, b.p);
  const n = a.n - overlap;
  if (n <= 0) return null;
  return { ...a, p: Math.min(a.p, b.p), n };
}
const applyOp = (doc, o) => (o.t === 'ins' ? doc.slice(0, o.p) + o.s + doc.slice(o.p) : doc.slice(0, o.p) + doc.slice(o.p + o.n));

function codecollab({ op, send }) {
  let doc = '// Birlikte kodlayın! Herkes aynı anda yazabilir.\n// ▶ Çalıştır çıktısı alttaki terminalde herkese görünür.\n\nconsole.log("Merhaba Biscord!");\n';
  let version = 0;
  let lang = 'js';
  const history = [];
  return {
    max: 20,
    join() { send(); },
    leave(uid) { op({ cmd: 'cursor', uid, pos: null }); },
    input(uid, d) {
      if (d?.cmd === 'op') {
        let o = d.op;
        if (!o || !['ins', 'del'].includes(o.t)) return;
        o = o.t === 'ins' ? { t: 'ins', p: Math.trunc(o.p), s: String(o.s).slice(0, 5000) } : { t: 'del', p: Math.trunc(o.p), n: Math.trunc(o.n) };
        const base = Math.trunc(d.base);
        if (!(base >= version - history.length && base <= version)) return op({ cmd: 'resync', uid, doc, version });
        for (const h of history.slice(history.length - (version - base))) { o = transform(o, h.op); if (!o) break; }
        if (o) {
          o.p = Math.max(0, Math.min(doc.length, o.p));
          if (o.t === 'del') o.n = Math.max(0, Math.min(doc.length - o.p, o.n));
          if (doc.length + (o.t === 'ins' ? o.s.length : 0) > 100000) return;
          doc = applyOp(doc, o);
        }
        version++;
        history.push({ op: o || { t: 'ins', p: 0, s: '' } });
        if (history.length > 500) history.shift();
        op({ cmd: 'op', uid, op: o || { t: 'ins', p: 0, s: '' }, version, ack: d.seq });
      } else if (d?.cmd === 'cursor') {
        op({ cmd: 'cursor', uid, pos: Math.trunc(d.pos), sel: Math.trunc(d.sel || d.pos) });
      } else if (d?.cmd === 'lang' && ['js', 'py'].includes(d.lang)) {
        lang = d.lang;
        op({ cmd: 'lang', lang, uid });
      } else if (d?.cmd === 'out') {
        op({ cmd: 'out', uid, lines: (d.lines || []).slice(0, 200).map((l) => ({ type: String(l.type).slice(0, 10), text: String(l.text).slice(0, 2000) })) });
      } else if (d?.cmd === 'run') op({ cmd: 'run', uid, lang });
    },
    snapshot() { return { doc, version, lang }; },
    destroy() {},
  };
}

// ---------------------------------------------------------------- Beat Yapıcı (adım sıralayıcı)
function beats({ op, send }) {
  const TRACKS = 8;
  const STEPS = 16;
  const grid = Array.from({ length: TRACKS }, () => Array(STEPS).fill(false));
  const s = { bpm: 110, playing: false, start_at: 0, kit: '808' };
  return {
    max: 30,
    join() { send(); },
    leave() {},
    input(uid, d) {
      if (d?.cmd === 'toggle') {
        const t = Math.trunc(d.t);
        const st = Math.trunc(d.s);
        if (t < 0 || t >= TRACKS || st < 0 || st >= STEPS) return;
        grid[t][st] = !grid[t][st];
        op({ cmd: 'cell', t, s: st, v: grid[t][st], uid });
      } else if (d?.cmd === 'bpm') {
        s.bpm = Math.max(60, Math.min(200, Math.trunc(d.bpm) || 110));
        if (s.playing) s.start_at = Date.now() + 150;
        op({ cmd: 'transport', ...s, server_now: Date.now() });
      } else if (d?.cmd === 'play' || d?.cmd === 'stop') {
        s.playing = d.cmd === 'play';
        s.start_at = Date.now() + 300;
        op({ cmd: 'transport', ...s, server_now: Date.now() });
      } else if (d?.cmd === 'kit' && ['808', '8bit', 'rock'].includes(d.kit)) {
        s.kit = d.kit;
        op({ cmd: 'transport', ...s, server_now: Date.now() });
      } else if (d?.cmd === 'clear') {
        grid.forEach((row) => row.fill(false));
        send();
      }
    },
    snapshot() { return { grid, ...s, server_now: Date.now() }; },
    destroy() {},
  };
}

// ---------------------------------------------------------------- Hacker Düellosu
const HACK_LINES = [
  'sudo rm -rf /var/log/izler', 'nmap -sS 10.0.0.0/24', 'ssh root@192.168.1.42 -p 2222', 'chmod 777 /etc/shadow',
  'git push --force origin main', 'cat /dev/urandom | head -c 64', 'iptables -A INPUT -j DROP', 'curl -X POST api/v1/selfdestruct',
  'kill -9 $(pidof firewall)', 'echo 0xDEADBEEF > /proc/kernel', 'docker exec -it core /bin/sh', 'ping -c 4 8.8.8.8',
  'openssl enc -aes-256-cbc -in sırlar.txt', 'nc -lvnp 4444', 'tail -f /var/log/auth.log', 'systemctl stop antivirus',
  'python3 -m http.server 8080', 'export PATH=/tmp/hack:$PATH', 'traceroute biscord.local', 'hashcat -m 0 hash.txt sözlük.txt',
];
function hackduel({ op, send }) {
  const s = { phase: 'lobby', players: [], hp: {}, line: null, round: 0, winner: null, progress: {} };
  let timer = null;
  const nextLine = () => {
    s.round++;
    s.line = HACK_LINES[Math.floor(Math.random() * HACK_LINES.length)];
    s.progress = {};
    s.phase = 'round';
    send();
  };
  return {
    max: 20,
    join(uid) { if (s.players.length < 2 && !s.players.includes(uid)) { s.players.push(uid); s.hp[uid] = 100; } send(); },
    leave(uid) {
      if (s.players.includes(uid) && s.phase === 'round') { s.phase = 'end'; s.winner = s.players.find((p) => p !== uid) || null; }
      s.players = s.players.filter((p) => p !== uid);
      send();
    },
    input(uid, d) {
      if (d?.cmd === 'start' && s.players.length === 2 && s.phase !== 'round' && s.phase !== 'countdown') {
        for (const p of s.players) s.hp[p] = 100;
        s.round = 0; s.winner = null; s.phase = 'countdown';
        send();
        clearTimeout(timer);
        timer = setTimeout(nextLine, 3000);
      } else if (d?.cmd === 'progress' && s.phase === 'round' && s.players.includes(uid)) {
        op({ cmd: 'progress', uid, n: Math.min(200, Math.trunc(d.n) || 0) });
      } else if (d?.cmd === 'submit' && s.phase === 'round' && s.players.includes(uid)) {
        if (String(d.text) !== s.line) { s.hp[uid] = Math.max(0, s.hp[uid] - 5); op({ cmd: 'miss', uid, hp: s.hp[uid] }); }
        else {
          const foe = s.players.find((p) => p !== uid);
          s.hp[foe] = Math.max(0, s.hp[foe] - 25);
          op({ cmd: 'hit', uid, foe, hp: s.hp[foe] });
          if (s.hp[foe] <= 0) { s.phase = 'end'; s.winner = uid; send(); return; }
          s.phase = 'between';
          send();
          clearTimeout(timer);
          timer = setTimeout(nextLine, 1200);
        }
        if (s.hp[uid] <= 0) { s.phase = 'end'; s.winner = s.players.find((p) => p !== uid); send(); }
      }
    },
    snapshot() { return { ...s }; },
    destroy() { clearTimeout(timer); },
  };
}

// ---------------------------------------------------------------- Piksel Lobi (konumlar)
function lobby({ op, send }) {
  const pos = new Map();
  return {
    max: 40,
    join(uid) { if (!pos.has(uid)) pos.set(uid, { x: 9 + Math.random() * 2, y: 10, dir: 'u', emote: null }); send(); },
    leave(uid) { pos.delete(uid); op({ cmd: 'gone', uid }); },
    input(uid, d) {
      const p = pos.get(uid);
      if (!p) return;
      if (d?.cmd === 'move') {
        p.x = Math.max(0.5, Math.min(23.5, Number(d.x) || p.x));
        p.y = Math.max(0.5, Math.min(15.5, Number(d.y) || p.y));
        p.dir = ['u', 'd', 'l', 'r'].includes(d.dir) ? d.dir : p.dir;
        op({ cmd: 'move', uid, x: +p.x.toFixed(2), y: +p.y.toFixed(2), dir: p.dir });
      } else if (d?.cmd === 'emote') {
        op({ cmd: 'emote', uid, e: String(d.e || '👋').slice(0, 8) });
      }
    },
    snapshot() { return { pos: Object.fromEntries(pos) }; },
    destroy() {},
  };
}

const ENGINES = { trivia, snake, arena, watch, whiteboard, desktop, code: codecollab, beats, hackduel, lobby };
const NAMES = {
  trivia: 'Bilgi Yarışması', snake: 'ASCII Yılan', arena: 'Arena', watch: 'Birlikte İzleme', whiteboard: 'Çizim Tahtası',
  desktop: 'Sanal Masaüstü', code: 'Ortak Kod', beats: 'Beat Yapıcı', hackduel: 'Hacker Düellosu', lobby: 'Piksel Lobi',
};

module.exports = (ctx) => {
  const { io, q, fail, channelAccess, channelRooms, has, P, now } = ctx;
  const acts = new Map(); // channel_id -> etkinlik

  const summary = (a) => ({ channel_id: a.channel_id, server_id: a.server_id, type: a.type, name: NAMES[a.type], host: a.host, players: [...a.players.keys()], started_at: a.started_at });
  const announce = (a, ended) => {
    const ch = q.get('SELECT * FROM channels WHERE id=?', a.channel_id);
    if (ch) io.to(channelRooms(ch)).emit('dispatch', { t: 'ACTIVITY_UPDATE', d: { channel_id: a.channel_id, server_id: a.server_id, activity: ended ? null : summary(a) } });
  };

  function end(a) {
    if (acts.get(a.channel_id) !== a) return;
    acts.delete(a.channel_id);
    a.engine.destroy();
    io.to('act:' + a.channel_id).emit('act:state', { channel_id: a.channel_id, type: a.type, ended: true });
    io.in('act:' + a.channel_id).socketsLeave('act:' + a.channel_id);
    announce(a, true);
  }

  function leavePlayer(a, uid) {
    if (!a.players.has(uid)) return;
    a.players.delete(uid);
    a.engine.leave(uid);
    if (!a.players.size) return end(a);
    if (a.host === uid) a.host = a.players.keys().next().value;
    announce(a);
  }

  ctx.hooks.socket.push((socket, uid, safe) => {
    socket.on('act:start', safe((d) => {
      const ch = channelAccess(uid, String(d?.channel_id));
      if (!['text', 'voice', 'dm', 'lobby'].includes(ch.type)) fail(400, 'Bu kanalda etkinlik başlatılamaz');
      const type = String(d?.type);
      if (!ENGINES[type]) fail(400, 'Bilinmeyen etkinlik');
      if ((type === 'lobby') !== (ch.type === 'lobby')) fail(400, 'Piksel lobi yalnızca lobi kanallarında çalışır');
      if (ch.server_id) {
        const s = q.get('SELECT activities, watch_party FROM servers WHERE id=?', ch.server_id);
        if (type === 'watch' && !s.watch_party) fail(403, 'Birlikte izleme bu sunucuda kapalı (Sunucu Ayarları → Özellikler)');
        if (type !== 'watch' && !s.activities) fail(403, 'Oyunlar bu sunucuda kapalı (Sunucu Ayarları → Özellikler)');
      }
      if (acts.has(ch.id)) fail(400, 'Bu kanalda zaten bir etkinlik var — katılabilirsin');
      const a = { type, channel_id: ch.id, server_id: ch.server_id || null, host: uid, players: new Map(), started_at: now() };
      let pending = false;
      const send = () => {
        if (pending) return;
        pending = true;
        setImmediate(() => {
          pending = false;
          if (acts.get(a.channel_id) === a) io.to('act:' + a.channel_id).emit('act:state', { channel_id: a.channel_id, type: a.type, host: a.host, state: a.engine.snapshot() });
        });
      };
      // anlık işlem (çizim, imleç, hareket): tam durum yerine yalnızca değişikliği yayınla
      const op = (data) => { if (acts.get(a.channel_id) === a) io.to('act:' + a.channel_id).emit('act:op', { channel_id: a.channel_id, op: data }); };
      a.engine = ENGINES[type]({ send, op, host: () => a.host });
      acts.set(ch.id, a);
      socket.join('act:' + ch.id);
      a.players.set(uid, socket.id);
      a.engine.join(uid);
      announce(a);
      return { ok: true, activity: summary(a) };
    }));

    socket.on('act:join', safe((d) => {
      const cid = String(d?.channel_id);
      channelAccess(uid, cid);
      const a = acts.get(cid);
      if (!a) fail(404, 'Etkinlik sona erdi');
      socket.join('act:' + cid);
      if (d.play !== false && !a.players.has(uid)) {
        if (a.players.size >= a.engine.max) fail(400, 'Etkinlik dolu — izleyici olarak katıldın');
        a.players.set(uid, socket.id);
        a.engine.join(uid);
        announce(a);
      }
      socket.emit('act:state', { channel_id: cid, type: a.type, host: a.host, state: a.engine.snapshot() });
      return { ok: true, activity: summary(a) };
    }));

    socket.on('act:leave', safe((d) => {
      const cid = String(d?.channel_id);
      socket.leave('act:' + cid);
      const a = acts.get(cid);
      if (a) leavePlayer(a, uid);
    }));

    socket.on('act:input', (d) => {
      const a = acts.get(String(d?.channel_id));
      if (a && a.players.get(uid) === socket.id) {
        try { a.engine.input(uid, d.data); } catch (e) { console.error('[etkinlik]', e); }
      }
    });

    socket.on('act:end', safe((d) => {
      const a = acts.get(String(d?.channel_id));
      if (!a) return;
      if (a.host !== uid && !(a.server_id && has(a.server_id, uid, P.MANAGE_CHANNELS))) fail(403, 'Etkinliği yalnızca başlatan kişi bitirebilir');
      end(a);
    }));

    socket.on('disconnect', () => {
      for (const a of [...acts.values()]) if (a.players.get(uid) === socket.id) leavePlayer(a, uid);
    });
  });

  ctx.hooks.ready.push((ready, uid, sset) => {
    ready.activities = [...acts.values()]
      .filter((a) => (a.server_id ? sset.has(a.server_id) : ctx.isDmParticipant(a.channel_id, uid)))
      .map(summary);
  });
};

module.exports.parseVideo = parseVideo;
module.exports.transform = transform;
module.exports.applyOp = applyOp;
