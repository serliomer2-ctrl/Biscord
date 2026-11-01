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

const ENGINES = { trivia, snake, arena, watch };
const NAMES = { trivia: 'Bilgi Yarışması', snake: 'ASCII Yılan', arena: 'Arena', watch: 'Birlikte İzleme' };

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
      if (!['text', 'voice', 'dm'].includes(ch.type)) fail(400, 'Bu kanalda etkinlik başlatılamaz');
      const type = String(d?.type);
      if (!ENGINES[type]) fail(400, 'Bilinmeyen etkinlik');
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
      a.engine = ENGINES[type]({ send, host: () => a.host });
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
