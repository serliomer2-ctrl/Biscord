'use strict';
const path = require('path');
const fs = require('fs');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env yok */ }

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const { q, tx, newId, DATA_DIR } = require('./db');
const { P, ALL_PERMS, DEFAULT_PERMS } = require('./permissions');

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 25;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ICE_SERVERS = (() => {
  if (process.env.ICE_SERVERS) {
    try { return JSON.parse(process.env.ICE_SERVERS); } catch { console.warn('ICE_SERVERS geçersiz JSON'); }
  }
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  }
  return list;
})();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 20000 });

// Özellik modüllerinin bağlandığı kancalar (server/ klasörü)
const hooks = { message: [], memberJoin: [], socket: [], ready: [], reaction: [] };
const runHooks = (name, ...args) => {
  for (const fn of hooks[name]) {
    try { fn(...args); } catch (e) { console.error(`[kanca:${name}]`, e); }
  }
};
const voice = new Map(); // userId -> ses durumu
const ghostAccess = new Map(); // hayalet kanal id -> Set(userId)
const RESERVED_NAMES = new Set(['admin', 'administrator', 'yonetici', 'biscord', 'system', 'sistem', 'moderator', 'destek', 'support', 'root',
  (process.env.ADMIN_USERNAME || 'Adminolmakben').trim().toLowerCase()]);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------- yardımcılar
const now = () => Date.now();
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const clean = (s, max) => (typeof s === 'string' ? s : '').trim().slice(0, max);
const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error { constructor(code, msg, errCode) { super(msg); this.code = code; this.errCode = errCode; } }
const fail = (code, msg, errCode) => { throw new HttpError(code, msg, errCode); };

const buckets = new Map();
function limited(key, max, windowMs) {
  const t = now();
  let b = buckets.get(key);
  if (!b || t > b.reset) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  return ++b.n > max;
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60000).unref();

// ---------------------------------------------------------------- dosya yükleme
const fixName = (n) => { try { return Buffer.from(n, 'latin1').toString('utf8'); } catch { return n; } };
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(fixName(file.originalname)).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
    cb(null, newId() + '_' + rand(6) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });
const imageUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(f.mimetype)),
});
const INLINE_RE = /\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|ogg|wav|m4a)$/i;

app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  next();
}, express.static(UPLOAD_DIR, {
  maxAge: '30d',
  setHeaders(res, p) { if (!INLINE_RE.test(p)) res.setHeader('Content-Disposition', 'attachment'); },
}));

// ---------------------------------------------------------------- presence
const online = new Map(); // userId -> Set(socketId)
const getUser = (id) => q.get('SELECT * FROM users WHERE id=?', id);

function presenceOf(u) {
  if (!online.has(u.id)) return 'offline';
  return u.status === 'invisible' ? 'offline' : (u.status || 'online');
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    avatar: u.avatar || null,
    banner_color: u.banner_color || null,
    about: u.about || '',
    custom_status: u.custom_status || '',
    is_bot: !!u.is_bot,
    is_admin: !!u.is_admin,
    created_at: u.created_at,
    status: presenceOf(u),
    presence: parsePresence(u.presence),
    profile_fx: safeJson(u.profile_fx, null),
    rare: safeJson(u.rare_collection, {}),
  };
}

function safeJson(s, d) {
  if (!s) return d;
  try { return JSON.parse(s); } catch { return d; }
}

function parsePresence(raw) {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.expires_at && p.expires_at < Date.now()) return null;
    return p;
  } catch { return null; }
}

// ---------------------------------------------------------------- yayın
const emit = (rooms, t, d) => { if (rooms.length) io.to(rooms).emit('dispatch', { t, d }); };
const toUser = (uid, t, d) => emit(['user:' + uid], t, d);
const toServer = (sid, t, d) => emit(['server:' + sid], t, d);
const dmRecipients = (chId) => q.all('SELECT user_id FROM dm_participants WHERE channel_id=?', chId).map((r) => r.user_id);
function channelRooms(ch) {
  if (ch.type === 'ghost') return ['ghost:' + ch.id];
  return ch.server_id ? ['server:' + ch.server_id] : dmRecipients(ch.id).map((u) => 'user:' + u);
}
const toChannel = (ch, t, d) => emit(channelRooms(ch), t, d);

// Bir kullanıcının değişikliklerini görmesi gereken herkes
function audienceRooms(uid) {
  const rooms = new Set(['user:' + uid]);
  for (const r of q.all('SELECT server_id FROM members WHERE user_id=?', uid)) rooms.add('server:' + r.server_id);
  for (const r of q.all(
    `SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS o FROM friendships WHERE requester_id=? OR addressee_id=?`,
    uid, uid, uid,
  )) rooms.add('user:' + r.o);
  for (const r of q.all(
    `SELECT p2.user_id FROM dm_participants p1 JOIN dm_participants p2 ON p2.channel_id=p1.channel_id WHERE p1.user_id=?`,
    uid,
  )) rooms.add('user:' + r.user_id);
  return [...rooms];
}
const broadcastUser = (uid) => emit(audienceRooms(uid), 'USER_UPDATE', publicUser(getUser(uid)));

// ---------------------------------------------------------------- yetkiler
const isMember = (sid, uid) => !!q.get('SELECT 1 FROM members WHERE server_id=? AND user_id=?', sid, uid);
const isDmParticipant = (chId, uid) => !!q.get('SELECT 1 FROM dm_participants WHERE channel_id=? AND user_id=?', chId, uid);

function permsOf(sid, uid) {
  const s = q.get('SELECT owner_id FROM servers WHERE id=?', sid);
  if (!s) return 0;
  if (s.owner_id === uid) return ALL_PERMS;
  if (!isMember(sid, uid)) return 0;
  let p = q.get('SELECT permissions FROM roles WHERE id=?', sid)?.permissions || 0;
  for (const r of q.all(
    'SELECT r.permissions FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.server_id=? AND mr.user_id=?', sid, uid,
  )) p |= r.permissions;
  return (p & P.ADMINISTRATOR) ? ALL_PERMS : p;
}
const has = (sid, uid, perm) => (permsOf(sid, uid) & perm) === perm;
const chanHas = (ch, uid, perm) => (ch.server_id ? has(ch.server_id, uid, perm) : true);

function topRole(sid, uid) {
  const s = q.get('SELECT owner_id FROM servers WHERE id=?', sid);
  if (s && s.owner_id === uid) return Infinity;
  const r = q.get(
    'SELECT MAX(r.position) AS p FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.server_id=? AND mr.user_id=?', sid, uid,
  );
  return r?.p ?? 0;
}
const outranks = (sid, actor, target) => topRole(sid, actor) > topRole(sid, target);

function requireServerPerm(sid, uid, perm) {
  if (!q.get('SELECT 1 FROM servers WHERE id=?', sid)) fail(404, 'Sunucu bulunamadı');
  if (!isMember(sid, uid)) fail(403, 'Bu sunucunun üyesi değilsin');
  if (perm && !has(sid, uid, perm)) fail(403, 'Bunun için yetkin yok');
}

function channelAccess(uid, chId) {
  const ch = q.get('SELECT * FROM channels WHERE id=?', chId);
  if (!ch) fail(404, 'Kanal bulunamadı');
  if (ch.server_id ? !isMember(ch.server_id, uid) : !isDmParticipant(ch.id, uid)) fail(403, 'Bu kanala erişimin yok');
  if (ch.type === 'ghost' && !ghostAccess.get(ch.id)?.has(uid)) fail(404, 'Kanal bulunamadı');
  return ch;
}

// ---------------------------------------------------------------- yükler (payload)
// Seviye: her seviye bir öncekinden biraz daha fazla XP ister
const xpForLevel = (lvl) => 5 * lvl * lvl + 50 * lvl + 100;
function levelOf(xp) {
  let lvl = 0;
  let rest = xp || 0;
  while (rest >= xpForLevel(lvl)) { rest -= xpForLevel(lvl); lvl++; }
  return { level: lvl, into: rest, need: xpForLevel(lvl) };
}

// Üyelik satırından ekonomi ve moderasyon alanları
function memberExtras(m) {
  const t = now();
  return {
    xp: m.xp || 0,
    level: levelOf(m.xp).level,
    coins: m.coins || 0,
    name_color: m.name_color || null,
    title: m.title && (!m.title_until || m.title_until > t) ? m.title : null,
    glow: !!(m.glow_until && m.glow_until > t),
    timeout_until: m.timeout_until && m.timeout_until > t ? m.timeout_until : null,
    duck_until: m.duck_until && m.duck_until > t ? m.duck_until : null,
    censor_until: m.censor_until && m.censor_until > t ? m.censor_until : null,
    badges: (() => { try { return JSON.parse(m.badges || '[]').filter((b) => !b.until || b.until > t); } catch { return []; } })(),
  };
}

function memberPayload(sid, uid) {
  const m = q.get('SELECT * FROM members WHERE server_id=? AND user_id=?', sid, uid);
  if (!m) return null;
  return {
    user: publicUser(getUser(uid)),
    nickname: m.nickname,
    joined_at: m.joined_at,
    roles: q.all('SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?', sid, uid).map((r) => r.role_id),
    ...memberExtras(m),
  };
}

function serverPayload(sid) {
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  if (!s) return null;
  const roleMap = new Map();
  for (const r of q.all('SELECT user_id, role_id FROM member_roles WHERE server_id=?', sid)) {
    if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, []);
    roleMap.get(r.user_id).push(r.role_id);
  }
  const members = q.all(
    `SELECT m.nickname, m.joined_at, m.xp, m.coins, m.name_color, m.title, m.title_until, m.glow_until, m.timeout_until, m.duck_until, m.censor_until, m.badges, u.*
     FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=?`, sid,
  ).map((r) => ({ user: publicUser(r), nickname: r.nickname, joined_at: r.joined_at, roles: roleMap.get(r.id) || [], ...memberExtras(r) }));
  return {
    ...s,
    channels: q.all("SELECT * FROM channels WHERE server_id=? AND type!='ghost' ORDER BY position, created_at", sid).map(publicChannel),
    roles: q.all('SELECT * FROM roles WHERE server_id=? ORDER BY position DESC', sid).map((r) => ({ ...r, hoist: !!r.hoist })),
    members,
  };
}

function publicChannel(ch) {
  if (!ch) return ch;
  const { password_hash, ...rest } = ch;
  return rest;
}

function dmPayload(ch) {
  return {
    ...ch,
    recipients: q.all('SELECT u.* FROM dm_participants p JOIN users u ON u.id=p.user_id WHERE p.channel_id=?', ch.id).map(publicUser),
  };
}

function reactionsOf(mid) {
  const map = new Map();
  for (const r of q.all('SELECT emoji, user_id FROM reactions WHERE message_id=? ORDER BY created_at', mid)) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.user_id);
  }
  return [...map].map(([emoji, users]) => ({ emoji, count: users.length, users }));
}

function messagePayload(m, ch) {
  if (!m) return null;
  ch = ch || q.get('SELECT id, server_id FROM channels WHERE id=?', m.channel_id);
  let referenced = null;
  if (m.reply_to) {
    const r = q.get('SELECT id, author_id, content, attachments FROM messages WHERE id=?', m.reply_to);
    if (r) referenced = { id: r.id, author: publicUser(getUser(r.author_id)), content: r.content.slice(0, 200), has_attachments: r.attachments !== '[]' };
  }
  return {
    id: m.id,
    channel_id: m.channel_id,
    server_id: ch?.server_id || null,
    author: publicUser(getUser(m.author_id)),
    content: m.content,
    type: m.type,
    attachments: JSON.parse(m.attachments || '[]'),
    embeds: JSON.parse(m.embeds || '[]'),
    components: m.components ? JSON.parse(m.components) : null,
    mentions: JSON.parse(m.mentions || '[]'),
    mention_everyone: !!m.mention_everyone,
    reply_to: m.reply_to,
    referenced,
    pinned: !!m.pinned,
    edited_at: m.edited_at,
    created_at: m.created_at,
    reactions: reactionsOf(m.id),
    expires_at: m.expires_at || null, // -1 = okununca imha
    rarity: m.rarity || null,
  };
}

function friendList(uid) {
  return q.all('SELECT * FROM friendships WHERE requester_id=? OR addressee_id=?', uid, uid).map((f) => {
    const other = f.requester_id === uid ? f.addressee_id : f.requester_id;
    return {
      user: publicUser(getUser(other)),
      type: f.status === 'accepted' ? 'friend' : (f.requester_id === uid ? 'outgoing' : 'incoming'),
      since: f.created_at,
    };
  });
}

function myUser(u) {
  return { ...publicUser(u), status_setting: u.status || 'online', bot_owner_id: u.bot_owner_id || null };
}

function buildReady(uid) {
  const me = getUser(uid);
  const serverIds = q.all('SELECT server_id FROM members WHERE user_id=? ORDER BY joined_at', uid).map((r) => r.server_id);
  const sset = new Set(serverIds);
  const ready = {
    user: myUser(me),
    servers: serverIds.map(serverPayload).filter(Boolean),
    dms: q.all(
      'SELECT c.* FROM channels c JOIN dm_participants p ON p.channel_id=c.id WHERE p.user_id=? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC', uid,
    ).map(dmPayload),
    friends: friendList(uid),
    read_states: q.all('SELECT channel_id, last_message_id FROM read_states WHERE user_id=?', uid),
    voice_states: [...voice.values()].filter((v) => (v.server_id ? sset.has(v.server_id) : isDmParticipant(v.channel_id, uid))).map(voicePublic),
  };
  runHooks('ready', ready, uid, sset);
  return ready;
}

// ---------------------------------------------------------------- mesaj oluşturma
const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/uploads\/)/i.test(u) ? u.slice(0, 2048) : undefined);

function sanitizeEmbeds(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 5).map((e) => ({
    title: clean(e?.title, 256) || undefined,
    description: clean(e?.description, 4096) || undefined,
    url: safeUrl(e?.url),
    color: Number.isInteger(e?.color) ? e.color : undefined,
    image: safeUrl(e?.image?.url || e?.image),
    thumbnail: safeUrl(e?.thumbnail?.url || e?.thumbnail),
    footer: clean(e?.footer?.text || e?.footer, 2048) || undefined,
    author: clean(e?.author?.name || e?.author, 256) || undefined,
    fields: Array.isArray(e?.fields)
      ? e.fields.slice(0, 25).map((f) => ({ name: clean(f?.name, 256), value: clean(f?.value, 1024), inline: !!f?.inline }))
      : undefined,
    timestamp: e?.timestamp ? String(e.timestamp).slice(0, 40) : undefined,
  })).filter((e) => e.title || e.description || e.image || e.fields?.length);
}

function extractMentions(ch, content) {
  const names = [...new Set([...content.matchAll(/@([a-zA-Z0-9_.]{2,32})/g)].map((m) => m[1].toLowerCase()))].slice(0, 20);
  if (!names.length) return [];
  const ph = names.map(() => '?').join(',');
  if (ch.server_id) {
    return q.all(`SELECT u.id FROM users u JOIN members m ON m.user_id=u.id AND m.server_id=? WHERE lower(u.username) IN (${ph})`, ch.server_id, ...names).map((r) => r.id);
  }
  return q.all(`SELECT u.id FROM users u JOIN dm_participants p ON p.user_id=u.id AND p.channel_id=? WHERE lower(u.username) IN (${ph})`, ch.id, ...names).map((r) => r.id);
}

function createMessage(ch, authorId, { content = '', type = 0, attachments = [], embeds = [], reply_to = null, components = null, expires_at = null, rarity = null } = {}) {
  const id = newId();
  const t = now();
  const mentions = content && !ch.anon ? extractMentions(ch, content) : [];
  const everyone = !!ch.server_id && !ch.anon && /@(everyone|here)\b/.test(content) && has(ch.server_id, authorId, P.MENTION_EVERYONE);
  q.run(
    'INSERT INTO messages(id,channel_id,author_id,content,type,attachments,embeds,components,mentions,mention_everyone,reply_to,created_at,expires_at,rarity) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, ch.id, authorId, content, type, JSON.stringify(attachments), JSON.stringify(embeds), components ? JSON.stringify(components) : null,
    JSON.stringify(mentions), everyone ? 1 : 0, reply_to, t, expires_at, rarity,
  );
  q.run('UPDATE channels SET last_message_id=?, last_message_at=? WHERE id=?', id, t, ch.id);
  q.run(
    'INSERT INTO read_states(user_id,channel_id,last_message_id) VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_message_id=excluded.last_message_id',
    authorId, ch.id, id,
  );
  const msg = messagePayload(q.get('SELECT * FROM messages WHERE id=?', id), ch);
  toChannel(ch, 'MESSAGE_CREATE', msg);
  runHooks('message', msg, ch, getUser(authorId));
  return msg;
}

// ---------------------------------------------------------------- üyelik
function addMember(sid, uid) {
  if (isMember(sid, uid)) return false;
  q.run('INSERT INTO members(server_id,user_id,joined_at) VALUES(?,?,?)', sid, uid, now());
  toServer(sid, 'MEMBER_ADD', { server_id: sid, member: memberPayload(sid, uid) });
  io.in('user:' + uid).socketsJoin('server:' + sid);
  toUser(uid, 'SERVER_CREATE', serverPayload(sid));
  const s = q.get('SELECT system_channel_id FROM servers WHERE id=?', sid);
  const sys = s?.system_channel_id && q.get("SELECT * FROM channels WHERE id=? AND type='text'", s.system_channel_id);
  if (sys) createMessage(sys, uid, { type: 7 });
  runHooks('memberJoin', sid, uid);
  return true;
}

function removeMember(sid, uid) {
  q.run('DELETE FROM members WHERE server_id=? AND user_id=?', sid, uid);
  const v = voice.get(uid);
  if (v && v.server_id === sid) leaveVoice(uid, true);
  io.in('user:' + uid).socketsLeave('server:' + sid);
  toUser(uid, 'SERVER_DELETE', { id: sid });
  toServer(sid, 'MEMBER_REMOVE', { server_id: sid, user_id: uid });
}

// ---------------------------------------------------------------- kimlik doğrulama
function userFromToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u;
  if (raw.startsWith('Bot ')) u = q.get('SELECT * FROM users WHERE bot_token_hash=? AND is_bot=1', sha(raw.slice(4).trim()));
  else {
    const s = q.get('SELECT user_id FROM sessions WHERE token_hash=?', sha(raw.replace(/^Bearer /, '').trim()));
    u = s && getUser(s.user_id);
  }
  return u && !u.banned ? u : null;
}

// Şifresini değiştirmek zorunda olan hesap (ör. ilk yönetici girişi) yalnızca bunları kullanabilir
const MUST_CHANGE_ALLOWED = new Set(['/users/@me', '/auth/logout', '/config']);

function auth(req, res, next) {
  const user = userFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Oturum geçersiz, lütfen tekrar giriş yap' });
  if (user.must_change_password && !MUST_CHANGE_ALLOWED.has(req.path)) {
    return res.status(403).json({ error: 'Devam etmeden önce şifreni değiştirmelisin', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  next();
}
const humanOnly = (req, res, next) => (req.user.is_bot ? res.status(403).json({ error: 'Botlar bu işlemi yapamaz' }) : next());

function newSession(uid) {
  const token = rand(32);
  q.run('INSERT INTO sessions(token_hash,user_id,created_at) VALUES(?,?,?)', sha(token), uid, now());
  return token;
}

const api = express.Router();

api.get('/config', (req, res) => {
  res.json({ iceServers: ICE_SERVERS, permissions: P, allPermissions: ALL_PERMS, maxUploadMB: MAX_UPLOAD_MB });
});

// Kayıt, giriş, 2FA ve şifre sıfırlama: server/security.js

api.post('/auth/logout', auth, (req, res) => {
  q.run('DELETE FROM sessions WHERE token_hash=?', sha(String(req.headers.authorization || '').replace(/^Bearer /, '')));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- kullanıcılar
api.get('/users/@me', auth, (req, res) => res.json(myUser(req.user)));

api.patch('/users/@me', auth, ah(async (req, res) => {
  const u = req.user;
  const b = req.body;
  if (u.must_change_password && b.new_password === undefined) fail(403, 'Önce şifreni değiştirmelisin', 'PASSWORD_CHANGE_REQUIRED');
  if (b.username !== undefined && !u.is_bot) {
    const name = clean(b.username, 32).toLowerCase();
    if (!USERNAME_RE.test(name)) fail(400, 'Geçersiz kullanıcı adı');
    if (RESERVED_NAMES.has(name) && name !== u.username) fail(400, 'Bu kullanıcı adı ayrılmış');
    const ex = q.get('SELECT id FROM users WHERE username=?', name);
    if (ex && ex.id !== u.id) fail(409, 'Bu kullanıcı adı alınmış');
    q.run('UPDATE users SET username=? WHERE id=?', name, u.id);
  }
  if (b.new_password !== undefined && !u.is_bot) {
    if (!(await bcrypt.compare(String(b.password || ''), u.password_hash || ''))) fail(400, 'Mevcut şifre hatalı');
    const np = String(b.new_password);
    if (np.length < 8) fail(400, 'Yeni şifre en az 8 karakter olmalı');
    if (np === String(b.password)) fail(400, 'Yeni şifre eskisinden farklı olmalı');
    if (u.must_change_password && /^admin/i.test(np)) fail(400, 'Daha güçlü bir şifre seç');
    q.run('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', await bcrypt.hash(np, 10), u.id);
    // diğer cihazlardaki oturumları kapat
    const current = sha(String(req.headers.authorization || '').replace(/^Bearer /, '').trim());
    q.run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', u.id, current);
  }
  if (b.presence !== undefined) q.run('UPDATE users SET presence=? WHERE id=?', sanitizePresence(b.presence), u.id);
  if (b.display_name !== undefined) q.run('UPDATE users SET display_name=? WHERE id=?', clean(b.display_name, 32) || u.username, u.id);
  if (b.about !== undefined) q.run('UPDATE users SET about=? WHERE id=?', clean(b.about, 190), u.id);
  if (b.custom_status !== undefined) q.run('UPDATE users SET custom_status=? WHERE id=?', clean(b.custom_status, 128), u.id);
  if (b.banner_color !== undefined) q.run('UPDATE users SET banner_color=? WHERE id=?', COLOR_RE.test(b.banner_color) ? b.banner_color : null, u.id);
  if (b.status !== undefined) {
    if (!['online', 'idle', 'dnd', 'invisible'].includes(b.status)) fail(400, 'Geçersiz durum');
    q.run('UPDATE users SET status=? WHERE id=?', b.status, u.id);
  }
  if (b.avatar === null) q.run('UPDATE users SET avatar=NULL WHERE id=?', u.id);
  const fresh = getUser(u.id);
  broadcastUser(u.id);
  toUser(u.id, 'ME_UPDATE', myUser(fresh));
  res.json(myUser(fresh));
}));

// Zengin durum: { emoji, text, details, started_at, expires_at }
function sanitizePresence(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    emoji: clean(p.emoji, 16) || null,
    text: clean(p.text, 64),
    details: clean(p.details, 128) || null,
    started_at: p.timer ? (Number(p.started_at) || now()) : null,
    expires_at: Number(p.expires_in) > 0 ? now() + Math.min(Number(p.expires_in), 7 * 86400) * 1000 : null,
  };
  return out.text || out.emoji ? JSON.stringify(out) : null;
}

api.post('/users/@me/avatar', auth, imageUpload.single('file'), (req, res) => {
  if (!req.file) fail(400, 'Geçerli bir resim yükle (png, jpg, gif, webp)');
  q.run('UPDATE users SET avatar=? WHERE id=?', '/uploads/' + req.file.filename, req.user.id);
  broadcastUser(req.user.id);
  const fresh = getUser(req.user.id);
  toUser(req.user.id, 'ME_UPDATE', myUser(fresh));
  res.json(myUser(fresh));
});

api.get('/users/:id', auth, (req, res) => {
  const u = getUser(req.params.id);
  if (!u) fail(404, 'Kullanıcı bulunamadı');
  const mutual = q.all(
    'SELECT m1.server_id FROM members m1 JOIN members m2 ON m2.server_id=m1.server_id WHERE m1.user_id=? AND m2.user_id=?', req.user.id, u.id,
  ).map((r) => r.server_id);
  res.json({ ...publicUser(u), mutual_servers: mutual, bot_owner_id: u.is_bot ? u.bot_owner_id : undefined });
});

// ---------------------------------------------------------------- sunucular
function createServerRecord(name, ownerId) {
  const sid = newId();
  const t = now();
  return tx(() => {
    q.run('INSERT INTO servers(id,name,owner_id,created_at) VALUES(?,?,?,?)', sid, name, ownerId, t);
    q.run('INSERT INTO roles(id,server_id,name,permissions,position) VALUES(?,?,?,?,0)', sid, sid, '@everyone', DEFAULT_PERMS);
    q.run('INSERT INTO members(server_id,user_id,joined_at) VALUES(?,?,?)', sid, ownerId, t);
    const textCat = newId(), voiceCat = newId(), general = newId();
    q.run("INSERT INTO channels(id,server_id,type,name,position,created_at) VALUES(?,?,'category','Metin Kanalları',0,?)", textCat, sid, t);
    q.run("INSERT INTO channels(id,server_id,type,name,parent_id,position,created_at) VALUES(?,?,'text','genel',?,0,?)", general, sid, textCat, t);
    q.run("INSERT INTO channels(id,server_id,type,name,position,created_at) VALUES(?,?,'category','Ses Kanalları',1,?)", voiceCat, sid, t);
    q.run("INSERT INTO channels(id,server_id,type,name,parent_id,position,created_at) VALUES(?,?,'voice','Genel',?,0,?)", newId(), sid, voiceCat, t);
    q.run('UPDATE servers SET system_channel_id=? WHERE id=?', general, sid);
    return sid;
  });
}

api.post('/servers', auth, humanOnly, (req, res) => {
  const name = clean(req.body.name, 100);
  if (!name) fail(400, 'Sunucu adı gerekli');
  if (q.get('SELECT COUNT(*) AS n FROM members WHERE user_id=?', req.user.id).n >= 100) fail(400, 'En fazla 100 sunucuda bulunabilirsin');
  const sid = createServerRecord(name, req.user.id);
  io.in('user:' + req.user.id).socketsJoin('server:' + sid);
  const payload = serverPayload(sid);
  toUser(req.user.id, 'SERVER_CREATE', payload);
  res.json(payload);
});

api.get('/servers/:sid', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id);
  res.json(serverPayload(req.params.sid));
});

api.patch('/servers/:sid', auth, (req, res) => {
  const sid = req.params.sid;
  requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
  if (req.body.name !== undefined) {
    const name = clean(req.body.name, 100);
    if (!name) fail(400, 'Sunucu adı boş olamaz');
    q.run('UPDATE servers SET name=? WHERE id=?', name, sid);
  }
  if (req.body.system_channel_id !== undefined) {
    const c = req.body.system_channel_id && q.get("SELECT id FROM channels WHERE id=? AND server_id=? AND type='text'", req.body.system_channel_id, sid);
    q.run('UPDATE servers SET system_channel_id=? WHERE id=?', c ? c.id : null, sid);
  }
  if (req.body.icon === null) q.run('UPDATE servers SET icon=NULL WHERE id=?', sid);
  for (const k of ['economy', 'watch_party', 'activities']) {
    if (req.body[k] !== undefined) q.run(`UPDATE servers SET ${k}=? WHERE id=?`, req.body[k] ? 1 : 0, sid);
  }
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  toServer(sid, 'SERVER_UPDATE', s);
  res.json(s);
});

api.post('/servers/:sid/icon', auth, imageUpload.single('file'), (req, res) => {
  const sid = req.params.sid;
  requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
  if (!req.file) fail(400, 'Geçerli bir resim yükle');
  q.run('UPDATE servers SET icon=? WHERE id=?', '/uploads/' + req.file.filename, sid);
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  toServer(sid, 'SERVER_UPDATE', s);
  res.json(s);
});

api.delete('/servers/:sid', auth, (req, res) => {
  const sid = req.params.sid;
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  if (!s) fail(404, 'Sunucu bulunamadı');
  if (s.owner_id !== req.user.id) fail(403, 'Sadece sunucu sahibi silebilir');
  for (const v of [...voice.values()]) if (v.server_id === sid) leaveVoice(v.user_id, true);
  toServer(sid, 'SERVER_DELETE', { id: sid });
  io.in('server:' + sid).socketsLeave('server:' + sid);
  q.run('DELETE FROM servers WHERE id=?', sid);
  res.json({ ok: true });
});

api.post('/servers/:sid/transfer', auth, (req, res) => {
  const sid = req.params.sid;
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  if (!s || s.owner_id !== req.user.id) fail(403, 'Sadece sunucu sahibi devredebilir');
  const target = String(req.body.user_id || '');
  if (!isMember(sid, target) || getUser(target)?.is_bot) fail(400, 'Geçersiz üye');
  q.run('UPDATE servers SET owner_id=? WHERE id=?', target, sid);
  toServer(sid, 'SERVER_UPDATE', q.get('SELECT * FROM servers WHERE id=?', sid));
  res.json({ ok: true });
});

// üyeler
api.get('/servers/:sid/members', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id);
  res.json(serverPayload(req.params.sid).members);
});

api.delete('/servers/:sid/members/@me', auth, (req, res) => {
  const sid = req.params.sid;
  const s = q.get('SELECT * FROM servers WHERE id=?', sid);
  if (!s) fail(404, 'Sunucu bulunamadı');
  if (s.owner_id === req.user.id) fail(400, 'Sunucu sahibi ayrılamaz; önce sunucuyu sil veya devret');
  removeMember(sid, req.user.id);
  res.json({ ok: true });
});

api.patch('/servers/:sid/members/:uid', auth, (req, res) => {
  const { sid, uid } = req.params;
  requireServerPerm(sid, req.user.id);
  if (!isMember(sid, uid)) fail(404, 'Üye bulunamadı');
  const self = uid === req.user.id;
  if (req.body.nickname !== undefined) {
    if (self ? !has(sid, uid, P.CHANGE_NICKNAME) : !(has(sid, req.user.id, P.MANAGE_ROLES) && outranks(sid, req.user.id, uid))) {
      fail(403, 'Takma adı değiştirme yetkin yok');
    }
    q.run('UPDATE members SET nickname=? WHERE server_id=? AND user_id=?', clean(req.body.nickname, 32) || null, sid, uid);
  }
  if (Array.isArray(req.body.roles)) {
    if (!has(sid, req.user.id, P.MANAGE_ROLES)) fail(403, 'Rolleri yönetme yetkin yok');
    const myTop = topRole(sid, req.user.id);
    if (!self && !outranks(sid, req.user.id, uid)) fail(403, 'Bu üyenin rollerini değiştiremezsin');
    const current = new Set(q.all('SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?', sid, uid).map((r) => r.role_id));
    const wanted = new Set(req.body.roles.map(String));
    tx(() => {
      for (const rid of new Set([...current, ...wanted])) {
        if (rid === sid || current.has(rid) === wanted.has(rid)) continue;
        const role = q.get('SELECT * FROM roles WHERE id=? AND server_id=?', rid, sid);
        if (!role) continue;
        if (role.position >= myTop) fail(403, `"${role.name}" rolünü yönetemezsin`);
        if (wanted.has(rid)) q.run('INSERT OR IGNORE INTO member_roles(server_id,user_id,role_id) VALUES(?,?,?)', sid, uid, rid);
        else q.run('DELETE FROM member_roles WHERE server_id=? AND user_id=? AND role_id=?', sid, uid, rid);
      }
    });
  }
  const m = memberPayload(sid, uid);
  toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: m });
  res.json(m);
});

api.delete('/servers/:sid/members/:uid', auth, (req, res) => {
  const { sid, uid } = req.params;
  requireServerPerm(sid, req.user.id, P.KICK_MEMBERS);
  if (!isMember(sid, uid)) fail(404, 'Üye bulunamadı');
  if (!outranks(sid, req.user.id, uid)) fail(403, 'Bu üyeyi atamazsın');
  removeMember(sid, uid);
  res.json({ ok: true });
});

// yasaklar
api.get('/servers/:sid/bans', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id, P.BAN_MEMBERS);
  res.json(q.all('SELECT * FROM bans WHERE server_id=? ORDER BY created_at DESC', req.params.sid).map((b) => ({ ...b, user: publicUser(getUser(b.user_id)) })));
});

api.put('/servers/:sid/bans/:uid', auth, (req, res) => {
  const { sid, uid } = req.params;
  requireServerPerm(sid, req.user.id, P.BAN_MEMBERS);
  if (!getUser(uid)) fail(404, 'Kullanıcı bulunamadı');
  if (q.get('SELECT owner_id FROM servers WHERE id=?', sid).owner_id === uid) fail(403, 'Sunucu sahibi yasaklanamaz');
  if (isMember(sid, uid) && !outranks(sid, req.user.id, uid)) fail(403, 'Bu üyeyi yasaklayamazsın');
  q.run('INSERT OR REPLACE INTO bans(server_id,user_id,reason,created_at) VALUES(?,?,?,?)', sid, uid, clean(req.body.reason, 512), now());
  if (req.body.delete_messages) {
    const ids = q.all('SELECT m.id, m.channel_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=? AND m.author_id=? AND m.created_at>?', sid, uid, now() - 7 * 86400e3);
    for (const m of ids) {
      q.run('DELETE FROM messages WHERE id=?', m.id);
      toServer(sid, 'MESSAGE_DELETE', { id: m.id, channel_id: m.channel_id, server_id: sid });
    }
  }
  if (isMember(sid, uid)) removeMember(sid, uid);
  res.json({ ok: true });
});

api.delete('/servers/:sid/bans/:uid', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id, P.BAN_MEMBERS);
  q.run('DELETE FROM bans WHERE server_id=? AND user_id=?', req.params.sid, req.params.uid);
  res.json({ ok: true });
});

// roller
function rolePayload(r) { return { ...r, hoist: !!r.hoist }; }

api.post('/servers/:sid/roles', auth, (req, res) => {
  const sid = req.params.sid;
  requireServerPerm(sid, req.user.id, P.MANAGE_ROLES);
  const max = q.get('SELECT MAX(position) AS p FROM roles WHERE server_id=?', sid).p || 0;
  const myTop = topRole(sid, req.user.id);
  const pos = myTop === Infinity ? max + 1 : Math.min(max + 1, myTop);
  if (myTop !== Infinity) q.run('UPDATE roles SET position=position+1 WHERE server_id=? AND position>=?', sid, pos);
  const id = newId();
  const perms = Number(req.body.permissions) & permsOf(sid, req.user.id);
  q.run('INSERT INTO roles(id,server_id,name,color,permissions,position,hoist) VALUES(?,?,?,?,?,?,?)',
    id, sid, clean(req.body.name, 100) || 'yeni rol', COLOR_RE.test(req.body.color || '') ? req.body.color : null, perms || 0, pos, req.body.hoist ? 1 : 0);
  for (const r of q.all('SELECT * FROM roles WHERE server_id=?', sid)) toServer(sid, 'ROLE_UPDATE', { server_id: sid, role: rolePayload(r) });
  res.json(rolePayload(q.get('SELECT * FROM roles WHERE id=?', id)));
});

api.patch('/servers/:sid/roles/:rid', auth, (req, res) => {
  const { sid, rid } = req.params;
  requireServerPerm(sid, req.user.id, P.MANAGE_ROLES);
  const role = q.get('SELECT * FROM roles WHERE id=? AND server_id=?', rid, sid);
  if (!role) fail(404, 'Rol bulunamadı');
  const myTop = topRole(sid, req.user.id);
  if (rid !== sid && role.position >= myTop) fail(403, 'Bu rolü düzenleyemezsin');
  const b = req.body;
  if (b.name !== undefined && rid !== sid) q.run('UPDATE roles SET name=? WHERE id=?', clean(b.name, 100) || role.name, rid);
  if (b.color !== undefined) q.run('UPDATE roles SET color=? WHERE id=?', COLOR_RE.test(b.color || '') ? b.color : null, rid);
  if (b.hoist !== undefined) q.run('UPDATE roles SET hoist=? WHERE id=?', b.hoist ? 1 : 0, rid);
  if (b.permissions !== undefined) {
    const mine = permsOf(sid, req.user.id);
    const keep = role.permissions & ~mine; // sahip olmadığın izinlere dokunamazsın
    q.run('UPDATE roles SET permissions=? WHERE id=?', keep | (Number(b.permissions) & mine), rid);
  }
  const r = rolePayload(q.get('SELECT * FROM roles WHERE id=?', rid));
  toServer(sid, 'ROLE_UPDATE', { server_id: sid, role: r });
  res.json(r);
});

api.delete('/servers/:sid/roles/:rid', auth, (req, res) => {
  const { sid, rid } = req.params;
  requireServerPerm(sid, req.user.id, P.MANAGE_ROLES);
  if (rid === sid) fail(400, '@everyone rolü silinemez');
  const role = q.get('SELECT * FROM roles WHERE id=? AND server_id=?', rid, sid);
  if (!role) fail(404, 'Rol bulunamadı');
  if (role.position >= topRole(sid, req.user.id)) fail(403, 'Bu rolü silemezsin');
  const affected = q.all('SELECT user_id FROM member_roles WHERE role_id=?', rid).map((r) => r.user_id);
  q.run('DELETE FROM roles WHERE id=?', rid);
  toServer(sid, 'ROLE_DELETE', { server_id: sid, role_id: rid });
  for (const uid of affected) toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: memberPayload(sid, uid) });
  res.json({ ok: true });
});

// davetler
const inviteCode = () => {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(8)) s += abc[b % abc.length];
  return s;
};

api.post('/servers/:sid/invites', auth, (req, res) => {
  const sid = req.params.sid;
  requireServerPerm(sid, req.user.id, P.CREATE_INVITE);
  const maxAge = Number(req.body.max_age ?? 7 * 86400); // saniye, 0 = süresiz
  const maxUses = Math.max(0, Math.min(1000, Number(req.body.max_uses) || 0));
  const code = inviteCode();
  q.run('INSERT INTO invites(code,server_id,creator_id,max_uses,expires_at,created_at) VALUES(?,?,?,?,?,?)',
    code, sid, req.user.id, maxUses, maxAge > 0 ? now() + maxAge * 1000 : null, now());
  res.json(q.get('SELECT * FROM invites WHERE code=?', code));
});

api.get('/servers/:sid/invites', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id, P.MANAGE_SERVER);
  res.json(q.all('SELECT * FROM invites WHERE server_id=? ORDER BY created_at DESC', req.params.sid).map((i) => ({ ...i, creator: publicUser(getUser(i.creator_id)) })));
});

api.delete('/invites/:code', auth, (req, res) => {
  const inv = q.get('SELECT * FROM invites WHERE code=?', req.params.code);
  if (!inv) fail(404, 'Davet bulunamadı');
  if (inv.creator_id !== req.user.id) requireServerPerm(inv.server_id, req.user.id, P.MANAGE_SERVER);
  q.run('DELETE FROM invites WHERE code=?', inv.code);
  res.json({ ok: true });
});

function validInvite(code) {
  const inv = q.get('SELECT * FROM invites WHERE code=?', code);
  if (!inv) fail(404, 'Davet geçersiz veya süresi dolmuş');
  if ((inv.expires_at && inv.expires_at < now()) || (inv.max_uses && inv.uses >= inv.max_uses)) {
    q.run('DELETE FROM invites WHERE code=?', code);
    fail(404, 'Davet geçersiz veya süresi dolmuş');
  }
  return inv;
}

api.get('/invites/:code', (req, res) => {
  const inv = validInvite(req.params.code);
  const s = q.get('SELECT id, name, icon FROM servers WHERE id=?', inv.server_id);
  const members = q.get('SELECT COUNT(*) AS n FROM members WHERE server_id=?', inv.server_id).n;
  const onlineCount = q.all('SELECT user_id FROM members WHERE server_id=?', inv.server_id).filter((m) => online.has(m.user_id)).length;
  res.json({ code: inv.code, server: s, member_count: members, online_count: onlineCount, inviter: publicUser(getUser(inv.creator_id)) });
});

api.post('/invites/:code', auth, humanOnly, (req, res) => {
  const inv = validInvite(req.params.code);
  if (q.get('SELECT 1 FROM bans WHERE server_id=? AND user_id=?', inv.server_id, req.user.id)) fail(403, 'Bu sunucudan yasaklandın');
  if (addMember(inv.server_id, req.user.id)) q.run('UPDATE invites SET uses=uses+1 WHERE code=?', inv.code);
  res.json(serverPayload(inv.server_id));
});

// ---------------------------------------------------------------- kanallar
const CHANNEL_TYPES = ['text', 'voice', 'category', 'ghost', 'lobby'];

api.post('/servers/:sid/channels', auth, ah(async (req, res) => {
  const sid = req.params.sid;
  requireServerPerm(sid, req.user.id, P.MANAGE_CHANNELS);
  const type = CHANNEL_TYPES.includes(req.body.type) ? req.body.type : 'text';
  let name = clean(req.body.name, 100);
  if (type === 'text' || type === 'ghost') name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
  if (!name) fail(400, 'Kanal adı gerekli');
  let pwHash = null;
  if (type === 'ghost') {
    const pw = String(req.body.password || '');
    if (pw.length < 4) fail(400, 'Hayalet kanal şifresi en az 4 karakter olmalı');
    pwHash = await bcrypt.hash(pw, 10);
  }
  const parent = type !== 'category' && type !== 'ghost' && req.body.parent_id
    ? q.get("SELECT id FROM channels WHERE id=? AND server_id=? AND type='category'", req.body.parent_id, sid) : null;
  const pos = (q.get('SELECT MAX(position) AS p FROM channels WHERE server_id=? AND parent_id IS ?', sid, parent ? parent.id : null).p ?? -1) + 1;
  const id = newId();
  q.run('INSERT INTO channels(id,server_id,type,name,topic,parent_id,position,password_hash,anon,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id, sid, type, name, clean(req.body.topic, 1024), parent ? parent.id : null, pos, pwHash, type === 'text' && req.body.anon ? 1 : 0, now());
  const ch = publicChannel(q.get('SELECT * FROM channels WHERE id=?', id));
  if (type === 'ghost') {
    // hayalet kanallar listede görünmez; yalnızca oluşturan kişiye açılır
    ctx.ghostUnlock(ch, req.user.id);
  } else toServer(sid, 'CHANNEL_CREATE', ch);
  res.json(ch);
}));

api.patch('/channels/:id', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  if (!ch.server_id) fail(400, 'DM kanalı düzenlenemez');
  requireServerPerm(ch.server_id, req.user.id, P.MANAGE_CHANNELS);
  if (req.body.name !== undefined) {
    let name = clean(req.body.name, 100);
    if (ch.type === 'text') name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
    if (name) q.run('UPDATE channels SET name=? WHERE id=?', name, ch.id);
  }
  if (req.body.topic !== undefined) q.run('UPDATE channels SET topic=? WHERE id=?', clean(req.body.topic, 1024), ch.id);
  if (req.body.position !== undefined) q.run('UPDATE channels SET position=? WHERE id=?', Number(req.body.position) || 0, ch.id);
  if (req.body.parent_id !== undefined && ch.type !== 'category') {
    const p = req.body.parent_id && q.get("SELECT id FROM channels WHERE id=? AND server_id=? AND type='category'", req.body.parent_id, ch.server_id);
    q.run('UPDATE channels SET parent_id=? WHERE id=?', p ? p.id : null, ch.id);
  }
  const fresh = publicChannel(q.get('SELECT * FROM channels WHERE id=?', ch.id));
  toChannel(fresh, 'CHANNEL_UPDATE', fresh);
  res.json(fresh);
});

api.delete('/channels/:id', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  if (!ch.server_id) fail(400, 'DM kanalı silinemez');
  requireServerPerm(ch.server_id, req.user.id, P.MANAGE_CHANNELS);
  for (const v of [...voice.values()]) if (v.channel_id === ch.id) leaveVoice(v.user_id, true);
  if (ch.type === 'category') {
    for (const c of q.all('SELECT * FROM channels WHERE parent_id=?', ch.id)) {
      q.run('UPDATE channels SET parent_id=NULL WHERE id=?', c.id);
      toServer(ch.server_id, 'CHANNEL_UPDATE', { ...c, parent_id: null });
    }
  }
  q.run('DELETE FROM channels WHERE id=?', ch.id);
  toChannel(ch, 'CHANNEL_DELETE', { id: ch.id, server_id: ch.server_id });
  if (ch.type === 'ghost') { io.in('ghost:' + ch.id).socketsLeave('ghost:' + ch.id); ghostAccess.delete(ch.id); }
  res.json({ ok: true });
});

// ---------------------------------------------------------------- mesajlar
api.get('/channels/:id/messages', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  if (ch.type === 'ghost') return res.json([]); // hayalet mesajlar hiçbir yerde saklanmaz
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const before = req.query.before ? q.get('SELECT rowid AS r FROM messages WHERE id=?', String(req.query.before)) : null;
  const rows = before
    ? q.all('SELECT * FROM messages WHERE channel_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?', ch.id, before.r, limit)
    : q.all('SELECT * FROM messages WHERE channel_id=? ORDER BY rowid DESC LIMIT ?', ch.id, limit);
  res.json(rows.reverse().map((m) => messagePayload(m, ch)));
});

api.post('/channels/:id/messages', auth, upload.array('files', 10), (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  try {
    if (!['text', 'dm', 'ghost'].includes(ch.type)) fail(400, 'Bu kanala mesaj gönderilemez');
    if (!chanHas(ch, req.user.id, P.SEND_MESSAGES)) fail(403, 'Bu kanala mesaj gönderme yetkin yok');
    if (files.length && !chanHas(ch, req.user.id, P.ATTACH_FILES)) fail(403, 'Dosya ekleme yetkin yok');
    if (req.user.muted_until && req.user.muted_until > now()) {
      fail(403, `Bir yönetici tarafından susturuldun (${Math.ceil((req.user.muted_until - now()) / 60e3)} dk kaldı)`);
    }
    if (ch.server_id && !has(ch.server_id, req.user.id, P.MANAGE_MESSAGES)) {
      const to = q.get('SELECT timeout_until FROM members WHERE server_id=? AND user_id=?', ch.server_id, req.user.id)?.timeout_until;
      if (to && to > now()) fail(403, `Bu sunucuda zaman aşımındasın (${Math.ceil((to - now()) / 60e3)} dk kaldı)`);
    }
    if (limited('msg:' + req.user.id, req.user.is_bot ? 50 : 10, 10e3)) fail(429, 'Çok hızlı mesaj gönderiyorsun, biraz yavaşla');
    const content = typeof req.body.content === 'string' ? req.body.content.slice(0, 4000).replace(/\s+$/, '') : '';
    const embeds = sanitizeEmbeds(req.body.embeds);
    const components = ctx.sanitizeComponents(req.body.components);
    if (!content.trim() && !files.length && !embeds.length && !components) fail(400, 'Boş mesaj gönderilemez');
    if (ch.type === 'ghost') {
      if (files.length || components) fail(400, 'Hayalet kanallarda dosya ve etkileşimli mesaj gönderilemez');
      return res.json(ctx.ghostSend(ch, req.user, content));
    }
    // Kendini imha eden mesaj: saniye ya da "read" (okununca)
    let expires_at = null;
    if (req.body.expire === 'read') expires_at = -1;
    else if (Number(req.body.expire) > 0) expires_at = now() + Math.min(86400, Number(req.body.expire)) * 1000;
    if (ch.anon) {
      // Anonim kanal: gerçek yazar hiçbir yerde saklanmaz
      if (files.length || (components && components.type !== 'fx' && components.type !== 'cipher')) fail(400, 'Anonim kanalda yalnızca metin gönderilebilir');
      return res.json(createMessage(ch, ctx.anonUserId, { content, embeds: [], components: ctx.anonMask(components), expires_at }));
    }
    let reply = null;
    if (req.body.reply_to) {
      const r = q.get('SELECT id FROM messages WHERE id=? AND channel_id=?', String(req.body.reply_to), ch.id);
      reply = r ? r.id : null;
    }
    const attachments = files.map((f) => ({
      id: newId(), filename: fixName(f.originalname).slice(0, 200), size: f.size, content_type: f.mimetype, url: '/uploads/' + f.filename,
    }));
    res.json(createMessage(ch, req.user.id, { content, attachments, embeds, reply_to: reply, components, expires_at, rarity: ctx.rollRarity(req.user, ch) }));
  } catch (e) { cleanup(); throw e; }
});

function messageAccess(uid, mid) {
  const m = q.get('SELECT * FROM messages WHERE id=?', mid);
  if (!m) fail(404, 'Mesaj bulunamadı');
  return { m, ch: channelAccess(uid, m.channel_id) };
}

api.patch('/messages/:id', auth, (req, res) => {
  const { m, ch } = messageAccess(req.user.id, req.params.id);
  if (m.author_id !== req.user.id) fail(403, 'Sadece kendi mesajını düzenleyebilirsin');
  const content = typeof req.body.content === 'string' ? req.body.content.slice(0, 4000).replace(/\s+$/, '') : m.content;
  const embeds = req.body.embeds !== undefined ? JSON.stringify(sanitizeEmbeds(req.body.embeds)) : m.embeds;
  if (!content.trim() && m.attachments === '[]' && embeds === '[]') fail(400, 'Mesaj boş olamaz');
  q.run('UPDATE messages SET content=?, embeds=?, mentions=?, edited_at=? WHERE id=?', content, embeds, JSON.stringify(extractMentions(ch, content)), now(), m.id);
  const msg = messagePayload(q.get('SELECT * FROM messages WHERE id=?', m.id), ch);
  toChannel(ch, 'MESSAGE_UPDATE', msg);
  res.json(msg);
});

function deleteMessage(m, ch) {
  q.run('DELETE FROM messages WHERE id=?', m.id);
  for (const a of JSON.parse(m.attachments || '[]')) fs.unlink(path.join(UPLOAD_DIR, path.basename(a.url)), () => {});
  toChannel(ch, 'MESSAGE_DELETE', { id: m.id, channel_id: ch.id, server_id: ch.server_id });
}

api.delete('/messages/:id', auth, (req, res) => {
  const { m, ch } = messageAccess(req.user.id, req.params.id);
  if (m.author_id !== req.user.id && !(ch.server_id && has(ch.server_id, req.user.id, P.MANAGE_MESSAGES))) fail(403, 'Bu mesajı silemezsin');
  deleteMessage(m, ch);
  res.json({ ok: true });
});

api.post('/channels/:id/messages/bulk-delete', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  if (!ch.server_id || !has(ch.server_id, req.user.id, P.MANAGE_MESSAGES)) fail(403, 'Mesajları yönetme yetkin yok');
  const ids = Array.isArray(req.body.messages) ? req.body.messages.slice(0, 100).map(String) : [];
  let n = 0;
  for (const id of ids) {
    const m = q.get('SELECT * FROM messages WHERE id=? AND channel_id=?', id, ch.id);
    if (m) { deleteMessage(m, ch); n++; }
  }
  res.json({ deleted: n });
});

api.put('/messages/:id/pin', auth, (req, res) => {
  const { m, ch } = messageAccess(req.user.id, req.params.id);
  if (ch.server_id && !has(ch.server_id, req.user.id, P.MANAGE_MESSAGES)) fail(403, 'Mesaj sabitleme yetkin yok');
  q.run('UPDATE messages SET pinned=? WHERE id=?', req.body.pinned === false ? 0 : 1, m.id);
  const msg = messagePayload(q.get('SELECT * FROM messages WHERE id=?', m.id), ch);
  toChannel(ch, 'MESSAGE_UPDATE', msg);
  res.json(msg);
});

api.get('/channels/:id/pins', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  res.json(q.all('SELECT * FROM messages WHERE channel_id=? AND pinned=1 ORDER BY rowid DESC', ch.id).map((m) => messagePayload(m, ch)));
});

function reactionChanged(m, ch) {
  toChannel(ch, 'REACTION_UPDATE', { message_id: m.id, channel_id: ch.id, server_id: ch.server_id, reactions: reactionsOf(m.id) });
}

api.put('/messages/:id/reactions/:emoji', auth, (req, res) => {
  const { m, ch } = messageAccess(req.user.id, req.params.id);
  if (!chanHas(ch, req.user.id, P.ADD_REACTIONS)) fail(403, 'Tepki ekleme yetkin yok');
  const emoji = String(req.params.emoji).slice(0, 32);
  if (!emoji.trim()) fail(400, 'Geçersiz emoji');
  if (q.get('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id=?', m.id).n >= 20 &&
      !q.get('SELECT 1 FROM reactions WHERE message_id=? AND emoji=?', m.id, emoji)) fail(400, 'Bir mesaja en fazla 20 farklı tepki eklenebilir');
  q.run('INSERT OR IGNORE INTO reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)', m.id, req.user.id, emoji, now());
  reactionChanged(m, ch);
  runHooks('reaction', m, ch, req.user);
  res.json({ ok: true });
});

api.delete('/messages/:id/reactions/:emoji', auth, (req, res) => {
  const { m, ch } = messageAccess(req.user.id, req.params.id);
  q.run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, String(req.params.emoji));
  reactionChanged(m, ch);
  res.json({ ok: true });
});

function typing(user, chId) {
  if (limited('typ:' + user.id, 10, 10e3)) return;
  const ch = channelAccess(user.id, chId);
  toChannel(ch, 'TYPING_START', { channel_id: ch.id, server_id: ch.server_id, user_id: user.id });
}
api.post('/channels/:id/typing', auth, (req, res) => { typing(req.user, req.params.id); res.json({ ok: true }); });

api.post('/channels/:id/ack', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  const mid = req.body.message_id ? String(req.body.message_id) : ch.last_message_id;
  q.run('INSERT INTO read_states(user_id,channel_id,last_message_id) VALUES(?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_message_id=excluded.last_message_id', req.user.id, ch.id, mid);
  toUser(req.user.id, 'MESSAGE_ACK', { channel_id: ch.id, message_id: mid });
  res.json({ ok: true });
});

api.get('/search', auth, (req, res) => {
  const text = clean(req.query.q, 200);
  if (text.length < 2) return res.json([]);
  const like = '%' + text.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  let rows;
  if (req.query.server_id) {
    requireServerPerm(String(req.query.server_id), req.user.id);
    rows = q.all("SELECT m.* FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=? AND m.content LIKE ? ESCAPE '\\' ORDER BY m.rowid DESC LIMIT 50", String(req.query.server_id), like);
  } else if (req.query.channel_id) {
    const ch = channelAccess(req.user.id, String(req.query.channel_id));
    rows = q.all("SELECT * FROM messages WHERE channel_id=? AND content LIKE ? ESCAPE '\\' ORDER BY rowid DESC LIMIT 50", ch.id, like);
  } else fail(400, 'server_id veya channel_id gerekli');
  res.json(rows.map((m) => messagePayload(m)));
});

// ---------------------------------------------------------------- arkadaşlar
function friendRow(a, b) {
  return q.get('SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)', a, b, b, a);
}
function notifyFriendship(a, b) {
  const f = friendRow(a, b);
  for (const [me, other] of [[a, b], [b, a]]) {
    if (!f) toUser(me, 'FRIEND_REMOVE', { user_id: other });
    else toUser(me, 'FRIEND_UPDATE', { user: publicUser(getUser(other)), type: f.status === 'accepted' ? 'friend' : (f.requester_id === me ? 'outgoing' : 'incoming'), since: f.created_at });
  }
}

api.get('/friends', auth, (req, res) => res.json(friendList(req.user.id)));

api.post('/friends', auth, humanOnly, (req, res) => {
  const target = req.body.user_id
    ? getUser(String(req.body.user_id))
    : q.get('SELECT * FROM users WHERE username=?', clean(req.body.username, 32).toLowerCase());
  if (!target || target.is_bot) fail(404, 'Böyle bir kullanıcı bulunamadı. Kullanıcı adını doğru yazdığından emin ol.');
  if (target.id === req.user.id) fail(400, 'Kendini arkadaş olarak ekleyemezsin');
  const f = friendRow(req.user.id, target.id);
  if (f) {
    if (f.status === 'accepted') fail(400, 'Zaten arkadaşsınız');
    if (f.requester_id === req.user.id) fail(400, 'Zaten istek gönderdin');
    q.run("UPDATE friendships SET status='accepted', created_at=? WHERE requester_id=? AND addressee_id=?", now(), target.id, req.user.id);
  } else {
    q.run("INSERT INTO friendships(requester_id,addressee_id,status,created_at) VALUES(?,?,'pending',?)", req.user.id, target.id, now());
    ctx.push(target.id, { title: 'Yeni arkadaşlık isteği', body: `${req.user.display_name || req.user.username} sana arkadaşlık isteği gönderdi`, url: '/channels/@me', tag: 'friend-' + req.user.id });
  }
  notifyFriendship(req.user.id, target.id);
  res.json({ ok: true });
});

api.put('/friends/:uid', auth, humanOnly, (req, res) => {
  const f = friendRow(req.user.id, req.params.uid);
  if (!f || f.status !== 'pending' || f.addressee_id !== req.user.id) fail(404, 'Bekleyen istek bulunamadı');
  q.run("UPDATE friendships SET status='accepted', created_at=? WHERE requester_id=? AND addressee_id=?", now(), f.requester_id, f.addressee_id);
  notifyFriendship(req.user.id, req.params.uid);
  res.json({ ok: true });
});

api.delete('/friends/:uid', auth, (req, res) => {
  q.run('DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)', req.user.id, req.params.uid, req.params.uid, req.user.id);
  notifyFriendship(req.user.id, req.params.uid);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- DM
api.post('/dms', auth, (req, res) => {
  const other = getUser(String(req.body.user_id || ''));
  if (!other) fail(404, 'Kullanıcı bulunamadı');
  if (other.id === req.user.id) fail(400, 'Kendine mesaj gönderemezsin');
  let ch = q.get(
    `SELECT c.* FROM channels c JOIN dm_participants a ON a.channel_id=c.id AND a.user_id=? JOIN dm_participants b ON b.channel_id=c.id AND b.user_id=? WHERE c.type='dm'`,
    req.user.id, other.id,
  );
  if (!ch) {
    const id = newId();
    tx(() => {
      q.run("INSERT INTO channels(id,type,created_at) VALUES(?,'dm',?)", id, now());
      q.run('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)', id, req.user.id);
      q.run('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)', id, other.id);
    });
    ch = q.get('SELECT * FROM channels WHERE id=?', id);
    const p = dmPayload(ch);
    toUser(req.user.id, 'DM_CREATE', p);
    toUser(other.id, 'DM_CREATE', p);
  }
  res.json(dmPayload(ch));
});

// ---------------------------------------------------------------- botlar
function botView(u) {
  return { ...publicUser(u), bot_public: !!u.bot_public, commands: JSON.parse(u.bot_commands || '[]') };
}
function ownedBot(req) {
  const b = q.get('SELECT * FROM users WHERE id=? AND is_bot=1 AND bot_owner_id=?', req.params.id, req.user.id);
  if (!b) fail(404, 'Bot bulunamadı');
  return b;
}
function issueBotToken(botId) {
  const token = Buffer.from(botId).toString('base64url') + '.' + rand(24);
  q.run('UPDATE users SET bot_token_hash=? WHERE id=?', sha(token), botId);
  for (const sid of online.get(botId) || []) io.sockets.sockets.get(sid)?.disconnect(true);
  return token;
}

api.get('/bots', auth, humanOnly, (req, res) => {
  res.json(q.all('SELECT * FROM users WHERE is_bot=1 AND bot_owner_id=? ORDER BY created_at', req.user.id).map(botView));
});

api.post('/bots', auth, humanOnly, (req, res) => {
  const name = clean(req.body.username, 32).toLowerCase();
  if (!USERNAME_RE.test(name)) fail(400, 'Bot kullanıcı adı 2-32 karakter, küçük harf/rakam/_/. olmalı');
  if (RESERVED_NAMES.has(name) || q.get('SELECT 1 FROM users WHERE username=?', name)) fail(409, 'Bu kullanıcı adı alınmış');
  if (q.get('SELECT COUNT(*) AS n FROM users WHERE bot_owner_id=?', req.user.id).n >= 25) fail(400, 'En fazla 25 bot oluşturabilirsin');
  const id = newId();
  q.run('INSERT INTO users(id,username,display_name,is_bot,bot_owner_id,status,created_at) VALUES(?,?,?,1,?,?,?)',
    id, name, clean(req.body.display_name, 32) || name, req.user.id, 'online', now());
  const token = issueBotToken(id);
  res.json({ bot: botView(getUser(id)), token });
});

api.patch('/bots/:id', auth, humanOnly, (req, res) => {
  const b = ownedBot(req);
  if (req.body.display_name !== undefined) q.run('UPDATE users SET display_name=? WHERE id=?', clean(req.body.display_name, 32) || b.username, b.id);
  if (req.body.about !== undefined) q.run('UPDATE users SET about=? WHERE id=?', clean(req.body.about, 190), b.id);
  if (req.body.bot_public !== undefined) q.run('UPDATE users SET bot_public=? WHERE id=?', req.body.bot_public ? 1 : 0, b.id);
  broadcastUser(b.id);
  res.json(botView(getUser(b.id)));
});

api.post('/bots/:id/avatar', auth, humanOnly, imageUpload.single('file'), (req, res) => {
  const b = ownedBot(req);
  if (!req.file) fail(400, 'Geçerli bir resim yükle');
  q.run('UPDATE users SET avatar=? WHERE id=?', '/uploads/' + req.file.filename, b.id);
  broadcastUser(b.id);
  res.json(botView(getUser(b.id)));
});

api.post('/bots/:id/token', auth, humanOnly, (req, res) => {
  const b = ownedBot(req);
  res.json({ token: issueBotToken(b.id) });
});

api.delete('/bots/:id', auth, humanOnly, (req, res) => {
  const b = ownedBot(req);
  for (const r of q.all('SELECT server_id FROM members WHERE user_id=?', b.id)) removeMember(r.server_id, b.id);
  for (const sid of online.get(b.id) || []) io.sockets.sockets.get(sid)?.disconnect(true);
  q.run('DELETE FROM users WHERE id=?', b.id);
  res.json({ ok: true });
});

// Botu bir sunucuya ekle (sunucuda "Sunucuyu Yönet" yetkisi gerekir)
api.post('/bots/:id/servers', auth, humanOnly, (req, res) => {
  const b = q.get('SELECT * FROM users WHERE id=? AND is_bot=1', req.params.id);
  if (!b || (b.bot_owner_id !== req.user.id && !b.bot_public)) fail(404, 'Bot bulunamadı veya herkese açık değil');
  const sid = String(req.body.server_id || '');
  requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
  if (q.get('SELECT 1 FROM bans WHERE server_id=? AND user_id=?', sid, b.id)) fail(403, 'Bu bot sunucudan yasaklı');
  if (!addMember(sid, b.id)) fail(400, 'Bot zaten bu sunucuda');
  res.json({ ok: true });
});

// Bot, kendi eğik çizgi (/) komutlarını kaydeder
api.put('/bots/@me/commands', auth, (req, res) => {
  if (!req.user.is_bot) fail(403, 'Sadece botlar komut kaydedebilir');
  const list = (Array.isArray(req.body) ? req.body : req.body.commands || []).slice(0, 100).map((c) => ({
    name: clean(c?.name, 32).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    description: clean(c?.description, 100),
    usage: clean(c?.usage, 100) || undefined,
  })).filter((c) => c.name);
  q.run('UPDATE users SET bot_commands=? WHERE id=?', JSON.stringify(list), req.user.id);
  res.json(list);
});

api.get('/servers/:sid/commands', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id);
  const out = [];
  for (const b of q.all('SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=? AND u.is_bot=1', req.params.sid)) {
    for (const c of JSON.parse(b.bot_commands || '[]')) out.push({ ...c, bot: publicUser(b) });
  }
  res.json(out);
});

api.get('/servers/:sid/channels', auth, (req, res) => {
  requireServerPerm(req.params.sid, req.user.id);
  res.json(q.all('SELECT * FROM channels WHERE server_id=? ORDER BY position, created_at', req.params.sid));
});

api.get('/channels/:id', auth, (req, res) => {
  const ch = channelAccess(req.user.id, req.params.id);
  res.json(ch.server_id ? ch : dmPayload(ch));
});

// ---------------------------------------------------------------- özellik modülleri
const settings = {
  get: (k, d = null) => q.get('SELECT value FROM settings WHERE key=?', k)?.value ?? d,
  set: (k, v) => (v == null
    ? q.run('DELETE FROM settings WHERE key=?', k)
    : q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v))),
};
const audit = (actorId, action, target, details) => q.run(
  'INSERT INTO audit_log(id,actor_id,action,target,details,created_at) VALUES(?,?,?,?,?,?)',
  newId(), actorId, action, target || null, details ? JSON.stringify(details) : null, now(),
);

const ctx = {
  app, api, io, q, tx, newId, P, ALL_PERMS, hooks, settings, audit, voice, ghostAccess, online, RESERVED_NAMES,
  USERNAME_RE, COLOR_RE, UPLOAD_DIR, upload, imageUpload, bcrypt,
  now, sha, rand, clean, fail, HttpError, ah, limited, auth, humanOnly, newSession, userFromToken,
  getUser, publicUser, myUser, broadcastUser, presenceOf,
  isMember, isDmParticipant, has, permsOf, chanHas, outranks, requireServerPerm, channelAccess, publicChannel,
  emit, toUser, toServer, toChannel, channelRooms, audienceRooms, dmRecipients,
  serverPayload, memberPayload, messagePayload, createMessage, deleteMessage, addMember, removeMember,
  leaveVoice, emitVoice: (...a) => emitVoice(...a), levelOf, xpForLevel,
  push: () => {},
  sanitizeComponents: () => null,
  ghostUnlock: () => {},
  ghostSend: () => fail(400, 'Hayalet kanallar devre dışı'),
  rollRarity: () => null,
  anonMask: (c) => c,
  anonUserId: null,
};
for (const mod of ['mail', 'security', 'admin', 'push', 'interactive', 'economy', 'ghost', 'soundboard', 'activities', 'p2p', 'automation', 'fun']) {
  require('./server/' + mod)(ctx);
}

api.use((req, res) => res.status(404).json({ error: 'Bulunamadı' }));
app.use('/api', api);

// ---------------------------------------------------------------- statik + SPA
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { maxAge: 0 })); // ETag ile doğrulanır; güncellemeler hemen yansır
app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.code).json({ error: err.message, code: err.errCode });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Dosya çok büyük (en fazla ${MAX_UPLOAD_MB} MB)` : 'Dosya yükleme hatası' });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON' });
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

// ---------------------------------------------------------------- ses durumu
function voicePublic(v) {
  return {
    user_id: v.user_id, channel_id: v.channel_id, server_id: v.server_id,
    self_mute: v.self_mute, self_deaf: v.self_deaf, self_video: v.self_video, self_stream: v.self_stream,
    server_mute: v.server_mute, joined_at: v.joined_at,
  };
}
function voiceRooms(v) {
  return v.server_id ? ['server:' + v.server_id] : dmRecipients(v.channel_id).map((u) => 'user:' + u);
}
const emitVoice = (v, d) => emit(voiceRooms(v), 'VOICE_STATE_UPDATE', d || voicePublic(v));

function leaveVoice(uid, forced) {
  const v = voice.get(uid);
  if (!v) return;
  voice.delete(uid);
  const sock = io.sockets.sockets.get(v.socket_id);
  if (sock) {
    sock.leave('voice:' + v.channel_id);
    if (forced) sock.emit('voice:force-leave');
  }
  emitVoice(v, { user_id: uid, channel_id: null, server_id: v.server_id, prev_channel_id: v.channel_id });
}

// ---------------------------------------------------------------- socket.io geçidi
io.use((socket, next) => {
  const user = userFromToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  if (user.must_change_password) return next(new Error('password_change_required'));
  socket.data.uid = user.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.data.uid;
  const me = () => getUser(uid);
  const safe = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    try {
      const r = fn(...args);
      if (cb) cb(r ?? { ok: true });
    } catch (e) {
      if (cb) cb({ ok: false, error: e instanceof HttpError ? e.message : 'Hata oluştu' });
      if (!(e instanceof HttpError)) console.error(e);
    }
  };

  socket.join('user:' + uid);
  for (const r of q.all('SELECT server_id FROM members WHERE user_id=?', uid)) socket.join('server:' + r.server_id);

  const wasOnline = online.has(uid);
  if (!wasOnline) online.set(uid, new Set());
  online.get(uid).add(socket.id);
  socket.emit('dispatch', { t: 'READY', d: buildReady(uid) });
  if (!wasOnline) emit(audienceRooms(uid), 'PRESENCE_UPDATE', { user_id: uid, status: presenceOf(me()) });

  socket.on('typing', safe((chId) => { typing(me(), String(chId)); }));
  for (const fn of hooks.socket) {
    try { fn(socket, uid, safe); } catch (e) { console.error('[kanca:socket]', e); }
  }

  socket.on('voice:join', safe((data) => {
    const ch = channelAccess(uid, String(data?.channel_id));
    if (ch.type !== 'voice' && ch.type !== 'dm' && ch.type !== 'lobby') fail(400, 'Bu bir ses kanalı değil');
    if (ch.server_id && !has(ch.server_id, uid, P.CONNECT)) fail(403, 'Bu ses kanalına bağlanma yetkin yok');
    const inChannel = [...voice.values()].filter((v) => v.channel_id === ch.id && v.user_id !== uid);
    if (inChannel.length >= 24) fail(400, 'Ses kanalı dolu (en fazla 25 kişi)');
    if (voice.has(uid)) leaveVoice(uid, voice.get(uid).socket_id !== socket.id);
    const v = {
      user_id: uid, channel_id: ch.id, server_id: ch.server_id || null, socket_id: socket.id,
      self_mute: !!data.self_mute, self_deaf: !!data.self_deaf, self_video: false, self_stream: false,
      server_mute: !!(me().muted_until && me().muted_until > now()), joined_at: now(),
    };
    voice.set(uid, v);
    socket.join('voice:' + ch.id);
    emitVoice(v);
    if (!ch.server_id && !inChannel.length) {
      // DM araması başladı: karşı taraf çevrimdışıysa bildirim gönder
      for (const other of dmRecipients(ch.id)) {
        if (other !== uid) ctx.push(other, { title: me().display_name || me().username, body: '📞 Seni arıyor', url: `/channels/@me/${ch.id}`, tag: 'call-' + ch.id });
      }
    }
    return {
      ok: true, channel_id: ch.id, server_id: v.server_id, peers: inChannel.map((p) => p.user_id),
      can_speak: ch.server_id ? has(ch.server_id, uid, P.SPEAK) : true,
      can_video: ch.server_id ? has(ch.server_id, uid, P.VIDEO) : true,
    };
  }));

  socket.on('voice:leave', safe(() => {
    const v = voice.get(uid);
    if (v && v.socket_id === socket.id) leaveVoice(uid, false);
  }));

  socket.on('voice:update', safe((data) => {
    const v = voice.get(uid);
    if (!v || v.socket_id !== socket.id) return;
    for (const k of ['self_mute', 'self_deaf', 'self_video', 'self_stream']) if (k in (data || {})) v[k] = !!data[k];
    if (v.server_id && (v.self_video || v.self_stream) && !has(v.server_id, uid, P.VIDEO)) { v.self_video = v.self_stream = false; }
    emitVoice(v);
  }));

  socket.on('voice:signal', safe((data) => {
    const from = voice.get(uid);
    const to = voice.get(String(data?.to));
    if (!from || !to || from.channel_id !== to.channel_id || from.socket_id !== socket.id) return;
    io.to(to.socket_id).emit('voice:signal', { from: uid, data: data.data });
  }));

  socket.on('voice:moderate', safe((data) => {
    const target = voice.get(String(data?.user_id));
    if (!target || !target.server_id) fail(404, 'Kullanıcı seste değil');
    if (data.action === 'mute') {
      if (!has(target.server_id, uid, P.MUTE_MEMBERS)) fail(403, 'Susturma yetkin yok');
      target.server_mute = !!data.value;
      emitVoice(target);
    } else if (data.action === 'disconnect') {
      if (!has(target.server_id, uid, P.MOVE_MEMBERS)) fail(403, 'Bağlantı kesme yetkin yok');
      leaveVoice(target.user_id, true);
    }
  }));

  socket.on('disconnect', () => {
    const v = voice.get(uid);
    if (v && v.socket_id === socket.id) leaveVoice(uid, false);
    const set = online.get(uid);
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        online.delete(uid);
        const u = me();
        if (u) emit(audienceRooms(uid), 'PRESENCE_UPDATE', { user_id: uid, status: 'offline' });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  Biscord çalışıyor →  http://localhost:${PORT}\n`);
});
