// Biscord istemcisi
import { api } from './api.js';
import {
  $, $$, esc, icon, avatar, fmtTime, fmtDay, timeHM, isSameDay, fmtSize, markdown, isEmojiOnly,
  playSound, debounce, store, STATUS_LABEL, colorFor,
} from './util.js';
import { VoiceClient } from './voice.js';
import { EMOJI_CATEGORIES, QUICK_REACTIONS } from './emoji.js';
import { ctx } from './ctx.js';
import * as security from './f/security.js';
import { openAdminPanel } from './f/admin.js';
import * as pwa from './f/pwa.js';
import { applyTheme, appearancePage } from './f/theme.js';
import { presenceLine, presenceCard, presenceEditor } from './f/presence.js';
import { componentHTML, interact, pollModal, todoModal } from './f/interactive.js';
import { shopModal, claimDaily } from './f/economy.js';
import { soundboardPanel, invalidateSounds, keyName } from './f/soundboard.js';
import * as acts from './f/activities.js';
import { highlightIn, runBlock, sandboxModal } from './f/coderun.js';
import * as files from './f/files.js';
import * as clips from './f/clips.js';
import { automationPage } from './f/automation.js';
import { VOICE_FILTERS } from './voice.js';

const root = $('#root');
const layers = $('#layers');
let CONFIG = null;
let P = {};
let socket = null;
let voice = null;

const S = {
  me: null,
  users: new Map(),
  servers: new Map(),
  channels: new Map(),
  friends: new Map(),
  voice: new Map(),
  read: new Map(),
  mentions: new Map(),
  messages: new Map(),
  typing: new Map(),
  drafts: new Map(),
  commands: new Map(),
  view: { sid: '@me', cid: null },
  friendsTab: 'online',
  lastChannel: store.get('lastChannel', {}),
  collapsed: new Set(store.get('collapsed', [])),
  showMembers: store.get('showMembers', true),
  reply: null,
  editing: null,
  pending: [],
  panel: null,
  focusTile: null,
  ready: false,
  stick: true,
  activities: new Map(),   // kanal id -> etkinlik özeti
  ghostPresence: new Map(), // hayalet kanal id -> içerideki kullanıcılar
  announcement: null,
};

const ss = {
  get: (k) => { try { return sessionStorage.getItem('bis:' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem('bis:' + k) : sessionStorage.setItem('bis:' + k, v); } catch { /* yok */ } },
};

// ======================================================================= yardımcılar
const user = (id) => S.users.get(id);
const server = (sid) => S.servers.get(sid);
const member = (sid, uid) => server(sid)?.members.get(uid);
const curChannel = () => S.channels.get(S.view.cid);
const cmpId = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);

function upsertUser(u) {
  if (!u) return null;
  const old = S.users.get(u.id);
  if (old) Object.assign(old, u); else S.users.set(u.id, { ...u });
  return S.users.get(u.id);
}

function displayName(uid, sid) {
  const m = sid && member(sid, uid);
  const u = user(uid);
  return m?.nickname || u?.display_name || u?.username || 'Bilinmeyen Kullanıcı';
}

function memberRoles(sid, uid) {
  const s = server(sid);
  const m = s?.members.get(uid);
  if (!m) return [];
  return m.roles.map((r) => s.roles.get(r)).filter(Boolean).sort((a, b) => b.position - a.position);
}
const nameColor = (uid, sid) => (sid ? member(sid, uid)?.name_color || memberRoles(sid, uid).find((r) => r.color)?.color || '' : '');
// Mağazadan alınan unvan ve parıltı
function nameExtras(uid, sid) {
  const m = sid && member(sid, uid);
  const u = user(uid);
  return `${m?.title ? `<span class="title-chip">${esc(m.title)}</span>` : ''}${u?.is_admin ? '<span class="admin-tag" title="Biscord Yöneticisi">🛡️</span>' : ''}`;
}
const glowCls = (uid, sid) => (sid && member(sid, uid)?.glow ? ' glow' : '');

function permsIn(sid, uid = S.me.id) {
  const s = server(sid);
  if (!s) return 0;
  if (s.owner_id === uid) return CONFIG.allPermissions;
  let p = s.roles.get(s.id)?.permissions || 0;
  for (const r of memberRoles(sid, uid)) p |= r.permissions;
  return (p & P.ADMINISTRATOR) ? CONFIG.allPermissions : p;
}
const can = (sid, perm) => !sid || (permsIn(sid) & perm) === perm;
const topPos = (sid, uid) => (server(sid)?.owner_id === uid ? Infinity : (memberRoles(sid, uid)[0]?.position ?? 0));
const outranks = (sid, uid) => topPos(sid, S.me.id) > topPos(sid, uid);

function serverChannels(sid) {
  return [...S.channels.values()].filter((c) => c.server_id === sid)
    .sort((a, b) => (a.position - b.position) || cmpId(a.id, b.id));
}
const dmList = () => [...S.channels.values()].filter((c) => c.type === 'dm')
  .sort((a, b) => (b.last_message_at || b.created_at) - (a.last_message_at || a.created_at));
const dmOther = (ch) => user(ch.recipients.find((id) => id !== S.me.id) || ch.recipients[0]);
const firstText = (sid) => serverChannels(sid).find((c) => c.type === 'text');

function channelLabel(ch) {
  if (!ch) return '';
  return ch.type === 'dm' ? '@' + displayName(dmOther(ch)?.id) : (ch.type === 'voice' ? '' : '#') + ch.name;
}

function isUnread(ch) {
  if (!ch || ch.type === 'voice' || ch.type === 'category' || !ch.last_message_id) return false;
  if (ch.id === S.view.cid && document.hasFocus()) return false;
  return S.read.get(ch.id) !== ch.last_message_id;
}
const serverUnread = (sid) => serverChannels(sid).some(isUnread);
const serverMentions = (sid) => serverChannels(sid).reduce((n, c) => n + (S.mentions.get(c.id) || 0), 0);

function voiceIn(chId) {
  return [...S.voice.values()].filter((v) => v.channel_id === chId).sort((a, b) => a.joined_at - b.joined_at);
}

function serverIcon(s, size = 48) {
  if (s.icon) return `<img src="${esc(s.icon)}" alt="">`;
  const letters = s.name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => [...w][0]).join('');
  return `<span style="font-size:${letters.length > 2 ? 12 : 15}px">${esc(letters)}</span>`;
}

function copy(text, msg = 'Panoya kopyalandı') {
  navigator.clipboard?.writeText(text).then(() => toast(msg, 'ok'), () => toast('Kopyalanamadı', 'error'));
}

// ======================================================================= katmanlar
function toast(msg, type = '', action) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = action.label;
    b.onclick = () => { t.remove(); action.onClick(); };
    t.appendChild(b);
  }
  box.appendChild(t);
  setTimeout(() => t.remove(), action ? 15000 : 3500);
}
const fail = (e) => toast(e?.message || String(e), 'error');

function modal({ title, sub = '', body = '', foot = '', wide = false, center = false, onMount }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head ${center ? 'center' : ''}"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}
      <button class="modal-close" data-close aria-label="Kapat">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  layers.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  const m = ov.querySelector('.modal');
  onMount?.(m, close);
  setTimeout(() => m.querySelector('input:not([type=file]):not([type=checkbox]):not([type=radio]),textarea')?.focus(), 30);
  return { el: m, close };
}

function confirmDialog(title, text, ok = 'Onayla', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = modal({
      title, sub: text,
      foot: `<button class="btn ghost" data-close>İptal</button><button class="btn ${danger ? 'red' : ''}" data-ok>${esc(ok)}</button>`,
      onMount(m, c) { m.querySelector('[data-ok]').onclick = () => { done = true; c(); resolve(true); }; },
    });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } }).observe(layers, { childList: true });
    void close;
  });
}

function promptDialog(title, label, value = '', { sub = '', ok = 'Kaydet', max = 100 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { el } = modal({
      title, sub,
      body: `<form id="pf"><label class="field"><span>${esc(label)}</span><input class="input" name="v" maxlength="${max}" value="${esc(value)}"></label></form>`,
      foot: `<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>${esc(ok)}</button>`,
      onMount(m, c) {
        const submit = (e) => { e?.preventDefault(); done = true; const v = m.querySelector('input').value; c(); resolve(v); };
        m.querySelector('#pf').onsubmit = submit;
        m.querySelector('[data-ok]').onclick = submit;
      },
    });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(null); } }).observe(layers, { childList: true });
  });
}

function closeFloating() { $$('.menu, .popover, .emoji-picker', layers).forEach((e) => e.remove()); }

function place(el, x, y, { alignRight = false, above = false } = {}) {
  layers.appendChild(el);
  const r = el.getBoundingClientRect();
  let left = alignRight ? x - r.width : x;
  let top = above ? y - r.height : y;
  left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
  top = Math.max(8, Math.min(top, innerHeight - r.height - 8));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function menu(x, y, items, opts) {
  closeFloating();
  const list = items.filter(Boolean);
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = list.map((it, i) => {
    if (it === '-') return '<hr>';
    if (it.html) return it.html;
    return `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}${it.icon ? icon(it.icon, 'sm') : ''}</button>`;
  }).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = list[b.dataset.i];
    closeFloating();
    it.action?.();
  });
  place(el, x, y, opts);
  list.forEach((it) => it.mount?.(el));
  return el;
}
const menuAt = (anchor, items, opts = {}) => {
  const r = anchor.getBoundingClientRect();
  return menu(opts.alignRight ? r.right : r.left, opts.above ? r.top - 6 : r.bottom + 6, items, opts);
};

function emojiPicker(anchor, onPick) {
  closeFloating();
  const el = document.createElement('div');
  el.className = 'emoji-picker';
  const recent = store.get('recentEmoji', []);
  const cats = recent.length ? [{ icon: '🕘', name: 'Son Kullanılanlar', list: recent.map((e) => [e, '']) }, ...EMOJI_CATEGORIES] : EMOJI_CATEGORIES;
  el.innerHTML = `<input class="input" placeholder="Emoji ara…">
    <div class="cats">${cats.map((c, i) => `<button data-cat="${i}" title="${esc(c.name)}">${c.icon}</button>`).join('')}</div>
    <div class="emoji-grid scroll"></div>`;
  const grid = el.querySelector('.emoji-grid');
  const draw = (filter = '') => {
    const f = filter.toLocaleLowerCase('tr');
    grid.innerHTML = cats.map((c, i) => {
      const items = c.list.filter(([e, k]) => !f || k.includes(f));
      if (!items.length) return '';
      return `<h6 id="ecat-${i}">${esc(c.name)}</h6>${items.map(([e, k]) => `<button data-e="${e}" title="${esc(k.split(' ')[0])}">${e}</button>`).join('')}`;
    }).join('') || '<p class="muted" style="grid-column:1/-1;text-align:center">Emoji bulunamadı</p>';
  };
  draw();
  el.querySelector('input').oninput = (e) => draw(e.target.value.trim());
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { grid.querySelector('#ecat-' + c.dataset.cat)?.scrollIntoView(); return; }
    const b = e.target.closest('[data-e]');
    if (!b) return;
    const em = b.dataset.e;
    store.set('recentEmoji', [em, ...store.get('recentEmoji', []).filter((x) => x !== em)].slice(0, 18));
    onPick(em);
    if (!e.shiftKey) closeFloating();
  });
  const r = anchor.getBoundingClientRect();
  place(el, r.right, r.top - 8, { alignRight: true, above: true });
  setTimeout(() => el.querySelector('input').focus(), 20);
}

function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<div><img src="${esc(src)}" alt=""><a href="${esc(src)}" target="_blank" rel="noopener">Orijinalini aç</a></div>`;
  el.onclick = (e) => { if (e.target.tagName !== 'A') el.remove(); };
  layers.appendChild(el);
}

// ======================================================================= açılış / giriş
async function boot() {
  applyTheme();
  pwa.initPwa();
  const m = location.pathname.match(/^\/invite\/([A-Za-z0-9]+)/);
  if (m) { ss.set('invite', m[1]); history.replaceState(null, '', '/channels/@me'); }
  try {
    CONFIG = await fetch('/api/config').then((r) => r.json());
  } catch {
    root.innerHTML = '<div class="boot"><p>Sunucuya bağlanılamadı. Sayfayı yenile.</p></div>';
    return;
  }
  P = CONFIG.permissions;
  ctx.CONFIG = CONFIG;
  ctx.P = P;
  if (!api.token) return showAuth(m ? 'register' : 'login');
  connect();
}

function startApp() {
  root.innerHTML = '<div class="boot"><div class="boot-logo"></div><p>Bağlanılıyor…</p></div>';
  connect();
}

async function showAuth(mode = 'login') {
  const code = ss.get('invite');
  let inv = null;
  if (code) { try { inv = await api.get('/invites/' + code); } catch { ss.set('invite', null); } }
  const reg = mode === 'register';
  root.innerHTML = `<div class="auth"><form class="auth-card" id="auth-form" novalidate>
    <div class="auth-brand"><img src="/favicon.svg" alt="">Biscord</div>
    ${inv ? `<p class="sub"><b>${esc(inv.inviter?.display_name || 'Biri')}</b> seni <b>${esc(inv.server.name)}</b> sunucusuna davet etti 🎉</p>` : ''}
    <h1>${reg ? 'Hesap oluştur' : 'Tekrar hoş geldin!'}</h1>
    <p class="sub">${reg ? 'Arkadaşlarınla konuşmaya hemen başla' : 'Seni tekrar gördüğümüze çok sevindik!'}</p>
    ${reg ? '<label class="field"><span>Görünen Ad</span><input class="input" name="display_name" maxlength="32" autocomplete="nickname"></label>' : ''}
    ${reg ? '<label class="field"><span>E-posta <small style="display:inline;text-transform:none">(isteğe bağlı — şifreni unutursan gerekir)</small></span><input class="input" type="email" name="email" maxlength="254" autocomplete="email"></label>' : ''}
    <label class="field"><span>${reg ? 'Kullanıcı Adı' : 'Kullanıcı Adı veya E-posta'} <i class="req">*</i></span><input class="input" name="username" maxlength="${reg ? 32 : 254}" autocomplete="username" autocapitalize="none" required>
      ${reg ? '<small>Küçük harf, rakam, alt çizgi ve nokta kullanabilirsin.</small>' : ''}</label>
    <label class="field"><span>Şifre <i class="req">*</i></span><input class="input" type="password" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
      ${reg ? '<small>En az 8 karakter.</small>' : '<a class="forgot" data-forgot>Şifreni mi unuttun?</a>'}</label>
    <div class="form-error" id="auth-error"></div>
    <button class="btn block" type="submit">${reg ? 'Devam Et' : 'Giriş Yap'}</button>
    <div class="auth-switch">${reg ? '<a data-mode="login">Zaten bir hesabın var mı?</a>' : 'Bir hesaba mı ihtiyacın var? <a data-mode="register">Kaydol</a>'}</div>
  </form></div>`;
  const form = $('#auth-form');
  form.querySelector('[data-mode]').onclick = (e) => showAuth(e.target.dataset.mode);
  form.querySelector('[data-forgot]')?.addEventListener('click', () => security.showForgot());
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(form));
    if (reg) data.username = data.username.trim().toLowerCase();
    btn.disabled = true;
    try {
      const res = await api.post(reg ? '/auth/register' : '/auth/login', data);
      if (res.email_verification_sent) toast('E-postana bir doğrulama kodu gönderdik. Ayarlar → Gizlilik ve Güvenlik bölümünden doğrulayabilirsin.');
      security.handleLogin(res);
    } catch (err) {
      $('#auth-error').textContent = err.message;
      btn.disabled = false;
    }
  };
  form.querySelector('input').focus();
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* yine de çık */ }
  voice?.leave();
  api.setToken(null);
  location.href = '/';
}

// ======================================================================= gerçek zamanlı bağlantı
function connect() {
  if (socket) { socket.auth = { token: api.token }; socket.connect(); return; }
  socket = io({ auth: { token: api.token } });
  socket.on('connect_error', (e) => {
    if (e.message === 'unauthorized') { api.setToken(null); socket.disconnect(); showAuth('login'); }
    if (e.message === 'password_change_required') { socket.disconnect(); security.showForcedChange(); }
  });
  socket.on('disconnect', () => $('#conn-banner')?.classList.remove('hidden'));
  socket.on('connect', () => $('#conn-banner')?.classList.add('hidden'));
  socket.on('dispatch', ({ t, d }) => {
    try { H[t]?.(d); } catch (e) { console.error('olay hatası', t, e); }
  });
  acts.initActivities(socket);
  files.initFiles(socket);
}

const H = {};

H.READY = (d) => {
  saveDraft();
  for (const k of ['users', 'servers', 'channels', 'friends', 'voice', 'read', 'messages', 'typing', 'commands']) S[k].clear();
  S.me = upsertUser(d.user);
  d.servers.forEach(addServer);
  d.dms.forEach(addDm);
  d.friends.forEach((f) => { upsertUser(f.user); S.friends.set(f.user.id, f.type); });
  d.read_states.forEach((r) => S.read.set(r.channel_id, r.last_message_id));
  d.voice_states.forEach((v) => S.voice.set(v.user_id, v));
  (d.ghosts || []).forEach((c) => S.channels.set(c.id, c));
  S.activities.clear();
  (d.activities || []).forEach((a) => S.activities.set(a.channel_id, a));
  S.announcement = d.announcement || null;
  pwa.syncPush();

  if (!voice) {
    voice = new VoiceClient({
      socket, meId: S.me.id, iceServers: CONFIG.iceServers, toast,
      onChange: () => { renderVoicePanel(); renderUserPanel(); renderStage(); renderSidebar(); },
      onSpeaking: (uid, on) => $$(`[data-speak-uid="${uid}"]`).forEach((el) => el.classList.toggle('speaking', on)),
    });
  } else if (voice.connected) {
    const ch = voice.channelId;
    voice.cleanup();
    voice.join(ch);
  }

  if (!S.ready) {
    S.ready = true;
    renderApp();
    routeFromUrl(true);
    const code = ss.get('invite');
    if (code) { ss.set('invite', null); acceptInviteModal(code); }
  } else {
    if (S.view.sid !== '@me' && !server(S.view.sid)) S.view = { sid: '@me', cid: null };
    if (S.view.cid && !S.channels.has(S.view.cid)) S.view.cid = null;
    renderAll();
    if (S.view.cid) openChannel(S.view.cid);
  }
};

function addServer(s) {
  const srv = {
    id: s.id, name: s.name, icon: s.icon, owner_id: s.owner_id, system_channel_id: s.system_channel_id, created_at: s.created_at,
    roles: new Map(s.roles.map((r) => [r.id, r])), members: new Map(),
  };
  Object.assign(srv, { economy: !!s.economy, watch_party: !!s.watch_party, activities: !!s.activities });
  for (const m of s.members) {
    upsertUser(m.user);
    srv.members.set(m.user.id, memberRecord(m));
  }
  for (const c of s.channels) S.channels.set(c.id, c);
  S.servers.set(s.id, srv);
}

function memberRecord(m) {
  return {
    user_id: m.user.id, nickname: m.nickname, roles: m.roles, joined_at: m.joined_at,
    xp: m.xp, level: m.level, coins: m.coins, name_color: m.name_color, title: m.title, glow: m.glow, timeout_until: m.timeout_until,
  };
}

function addDm(c) {
  c.recipients.forEach(upsertUser);
  S.channels.set(c.id, { ...c, recipients: c.recipients.map((u) => u.id) });
}

function mergeMessages(list, add) {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of add) map.set(m.id, m);
  return [...map.values()].sort((a, b) => cmpId(a.id, b.id));
}

function onNewMessage(m) {
  const ch = S.channels.get(m.channel_id);
  if (!ch) return;
  upsertUser(m.author);
  ch.last_message_id = m.id;
  ch.last_message_at = m.created_at;
  const st = S.messages.get(ch.id);
  const isNew = st && !st.list.some((x) => x.id === m.id);
  if (st && isNew) {
    st.list.push(m);
    // düşük donanım modunda bellekte daha az mesaj tut
    if (document.documentElement.dataset.lowend && st.list.length > 150 && S.view.cid !== ch.id) { st.list.splice(0, st.list.length - 100); st.hasMore = true; }
  }
  S.typing.get(ch.id)?.delete(m.author.id);

  const mine = m.author.id === S.me.id;
  const viewing = S.view.cid === ch.id;
  if (mine) S.read.set(ch.id, m.id);
  if (viewing && isNew) { appendMessage(m); renderTyping(); }
  if (viewing && document.hasFocus()) ackSoon(ch.id);
  else if (!mine) {
    const mentioned = m.mention_everyone || m.mentions.includes(S.me.id) || m.referenced?.author?.id === S.me.id;
    if (ch.type === 'dm' || mentioned) {
      S.mentions.set(ch.id, (S.mentions.get(ch.id) || 0) + 1);
      notify(m, ch);
    }
  }
  renderGuilds();
  if ((ch.server_id || '@me') === S.view.sid) renderSidebar();
}

function notify(m, ch) {
  if (S.me.status_setting === 'dnd') return;
  playSound('message');
  if (!document.hidden || store.get('notifications', true) === false) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = ch.type === 'dm' ? displayName(m.author.id) : `${displayName(m.author.id, ch.server_id)} (#${ch.name}, ${server(ch.server_id)?.name})`;
  const n = new Notification(title, { body: m.content || (m.attachments.length ? '📎 Ek gönderdi' : ''), icon: m.author.avatar || '/favicon.svg', tag: ch.id });
  n.onclick = () => { window.focus(); navigate(ch.server_id || '@me', ch.id); n.close(); };
}

H.MESSAGE_CREATE = onNewMessage;

H.MESSAGE_UPDATE = (m) => {
  upsertUser(m.author);
  const st = S.messages.get(m.channel_id);
  if (!st) return;
  const i = st.list.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  st.list[i] = m;
  if (S.view.cid === m.channel_id) replaceMessage(m.id);
  if (S.panel?.type === 'pins' && S.panel.cid === m.channel_id) openPins();
};

H.MESSAGE_DELETE = (d) => {
  const st = S.messages.get(d.channel_id);
  if (st) st.list = st.list.filter((m) => m.id !== d.id);
  if (S.view.cid === d.channel_id) renderMessages();
  if (S.reply === d.id) { S.reply = null; renderComposerExtra(); }
};

H.REACTION_UPDATE = (d) => {
  const m = S.messages.get(d.channel_id)?.list.find((x) => x.id === d.message_id);
  if (!m) return;
  m.reactions = d.reactions;
  if (S.view.cid === d.channel_id) replaceMessage(m.id);
};

H.MESSAGE_ACK = (d) => {
  S.read.set(d.channel_id, d.message_id);
  S.mentions.delete(d.channel_id);
  renderGuilds();
  renderSidebar();
};

H.TYPING_START = (d) => {
  if (d.user_id === S.me.id) return;
  if (!S.typing.has(d.channel_id)) S.typing.set(d.channel_id, new Map());
  const map = S.typing.get(d.channel_id);
  clearTimeout(map.get(d.user_id));
  map.set(d.user_id, setTimeout(() => { map.delete(d.user_id); if (S.view.cid === d.channel_id) renderTyping(); }, 9000));
  if (S.view.cid === d.channel_id) renderTyping();
};

H.SERVER_CREATE = (s) => {
  addServer(s);
  renderGuilds();
};

H.SERVER_UPDATE = (s) => {
  const srv = server(s.id);
  if (!srv) return;
  Object.assign(srv, { name: s.name, icon: s.icon, owner_id: s.owner_id, system_channel_id: s.system_channel_id, economy: !!s.economy, watch_party: !!s.watch_party, activities: !!s.activities });
  renderGuilds();
  if (S.view.sid === s.id) { renderSidebar(); renderMembers(); }
};

H.SERVER_DELETE = (d) => {
  if (!server(d.id)) return;
  if (voice?.serverId === d.id) voice.cleanup();
  for (const c of serverChannels(d.id)) S.channels.delete(c.id);
  S.servers.delete(d.id);
  if (S.view.sid === d.id) navigate('@me', null, false);
  else renderGuilds();
};

H.CHANNEL_CREATE = H.CHANNEL_UPDATE = (c) => {
  if (!server(c.server_id)) return;
  const old = S.channels.get(c.id);
  S.channels.set(c.id, old ? Object.assign(old, c) : c);
  if (S.view.sid === c.server_id) {
    renderSidebar();
    if (S.view.cid === c.id) renderHeader();
  }
};

H.CHANNEL_DELETE = (d) => {
  S.channels.delete(d.id);
  S.messages.delete(d.id);
  if (S.view.cid === d.id) navigate(d.server_id, null, false);
  else if (S.view.sid === d.server_id) renderSidebar();
};

H.MEMBER_ADD = H.MEMBER_UPDATE = (d) => {
  const s = server(d.server_id);
  if (!s) return;
  upsertUser(d.member.user);
  s.members.set(d.member.user.id, memberRecord(d.member));
  if (S.view.sid === d.server_id) { renderMembers(); renderSidebar(); }
};

H.MEMBER_REMOVE = (d) => {
  server(d.server_id)?.members.delete(d.user_id);
  if (S.view.sid === d.server_id) renderMembers();
};

H.ROLE_UPDATE = (d) => {
  const s = server(d.server_id);
  if (!s) return;
  s.roles.set(d.role.id, d.role);
  if (S.view.sid === d.server_id) { renderMembers(); renderSidebar(); renderComposerState(); }
};

H.ROLE_DELETE = (d) => {
  const s = server(d.server_id);
  if (!s) return;
  s.roles.delete(d.role_id);
  for (const m of s.members.values()) m.roles = m.roles.filter((r) => r !== d.role_id);
  if (S.view.sid === d.server_id) renderMembers();
};

const friendsPageVisible = () => S.view.sid === '@me' && !S.view.cid && S.friendsTab !== 'add';

function refreshUserViews() {
  renderUserPanel();
  renderSidebar();
  renderMembers();
  if (friendsPageVisible()) renderMain();
  else if (curChannel()?.type === 'dm') renderHeader();
}

H.USER_UPDATE = (u) => { upsertUser(u); refreshUserViews(); };
H.ME_UPDATE = (u) => { S.me = upsertUser(u); refreshUserViews(); };
H.PRESENCE_UPDATE = (d) => {
  const u = user(d.user_id);
  if (!u) return;
  u.status = d.status;
  refreshUserViews();
};

H.FRIEND_UPDATE = (f) => {
  const prev = S.friends.get(f.user.id);
  upsertUser(f.user);
  S.friends.set(f.user.id, f.type);
  if (f.type === 'incoming' && prev !== 'incoming') { playSound('message'); toast(`${f.user.display_name} sana arkadaşlık isteği gönderdi`); }
  if (f.type === 'friend' && prev === 'outgoing') toast(`${f.user.display_name} arkadaşlık isteğini kabul etti`, 'ok');
  renderGuilds();
  if (S.view.sid === '@me') { renderSidebar(); if (friendsPageVisible()) renderMain(); }
};

H.FRIEND_REMOVE = (d) => {
  S.friends.delete(d.user_id);
  renderGuilds();
  if (S.view.sid === '@me') { renderSidebar(); if (friendsPageVisible()) renderMain(); }
};

H.DM_CREATE = (c) => {
  addDm(c);
  if (S.view.sid === '@me') renderSidebar();
};

H.NOTICE = (d) => toast(d.text, d.level === 'warn' ? 'error' : 'ok');

H.ANNOUNCEMENT = (d) => { S.announcement = d; renderAnnouncement(); };

H.GHOST_OPEN = (c) => {
  S.channels.set(c.id, c);
  if (S.view.sid === c.server_id) renderSidebar();
};

H.GHOST_CLOSE = (d) => {
  const c = S.channels.get(d.channel_id);
  S.channels.delete(d.channel_id);
  S.messages.delete(d.channel_id);
  S.ghostPresence.delete(d.channel_id);
  if (S.view.cid === d.channel_id) navigate(c?.server_id || S.view.sid, null, false);
  else if (c && S.view.sid === c.server_id) renderSidebar();
};

H.GHOST_PRESENCE = (d) => {
  S.ghostPresence.set(d.channel_id, d.users);
  d.users.forEach((id) => { if (!user(id)) api.get('/users/' + id).then(upsertUser).catch(() => {}); });
  if (S.view.cid === d.channel_id) renderHeader();
};

H.ACTIVITY_UPDATE = (d) => {
  if (d.activity) S.activities.set(d.channel_id, d.activity); else S.activities.delete(d.channel_id);
  if ((d.server_id || '@me') === S.view.sid) renderSidebar();
  if (S.view.cid === d.channel_id) acts.renderActivityArea();
};

H.P2P_OFFER = (o) => {
  upsertUser(o.from);
  const list = files.p2pOffers.get(o.channel_id) || [];
  list.push(o);
  files.p2pOffers.set(o.channel_id, list.slice(-5));
  if (S.view.cid === o.channel_id) renderP2P();
};

H.P2P_CANCEL = (d) => {
  files.p2pOffers.set(d.channel_id, (files.p2pOffers.get(d.channel_id) || []).filter((o) => o.id !== d.id));
  if (S.view.cid === d.channel_id) renderP2P();
};

H.SOUND_CREATE = H.SOUND_DELETE = (d) => invalidateSounds(d.server_id);

H.SOUND_PLAYED = (d) => {
  if (d.user_id !== S.me.id && !document.documentElement.dataset.lowend) toast(`${d.emoji || '🔊'} ${displayName(d.user_id, voice?.serverId)}: ${d.name}`);
};

function renderP2P() {
  const el = $('#p2p-area');
  if (el) el.innerHTML = files.p2pCardsHTML(S.view.cid);
}

function renderAnnouncement() {
  let el = $('#announce');
  const a = S.announcement;
  const dismissed = store.get('annDismissed', 0);
  if (!a || dismissed === a.at) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'announce'; document.body.prepend(el); }
  el.className = `announce ${a.level}`;
  el.innerHTML = `<span>${a.level === 'warn' ? '⚠️' : a.level === 'success' ? '🎉' : '📢'}</span><div class="grow msg-text">${markdown(a.text)}</div><button class="icon-btn" title="Kapat">${icon('x', 'sm')}</button>`;
  el.querySelector('button').onclick = () => { store.set('annDismissed', a.at); el.remove(); };
}

H.VOICE_STATE_UPDATE = (d) => {
  const prev = S.voice.get(d.user_id);
  if (d.channel_id) S.voice.set(d.user_id, d); else S.voice.delete(d.user_id);
  voice?.onVoiceState(d);
  const ch = d.channel_id && S.channels.get(d.channel_id);
  if (ch?.type === 'dm' && d.user_id !== S.me.id && prev?.channel_id !== d.channel_id && voice?.channelId !== ch.id) {
    playSound('ring');
    toast(`${displayName(d.user_id)} seni arıyor`, '', { label: 'Katıl', onClick: () => { navigate('@me', ch.id); voice.join(ch.id); } });
  }
  renderSidebar();
  renderStage();
  if (S.view.cid && (S.view.cid === d.channel_id || S.view.cid === d.prev_channel_id)) renderCallBanner();
};

// ======================================================================= yönlendirme
function routeFromUrl(replace) {
  const m = location.pathname.match(/^\/channels\/([^/]+)(?:\/([^/]+))?/);
  let sid = m?.[1] || '@me';
  let cid = m?.[2] || null;
  if (sid !== '@me' && !server(sid)) { sid = '@me'; cid = null; }
  if (cid && !S.channels.has(cid)) cid = null;
  navigate(sid, cid, !replace);
}
window.addEventListener('popstate', () => routeFromUrl(true));

function saveDraft() {
  const ta = $('#input');
  if (ta && S.view.cid) S.drafts.set(S.view.cid, ta.value);
}

function navigate(sid, cid = null, push = true) {
  saveDraft();
  if (sid !== '@me' && !cid) {
    const last = S.lastChannel[sid];
    const lc = last && S.channels.get(last);
    cid = lc && lc.server_id === sid && lc.type === 'text' ? last : firstText(sid)?.id || null;
  }
  const ch = cid && S.channels.get(cid);
  if (sid !== '@me' && ch?.type === 'text') { S.lastChannel[sid] = cid; store.set('lastChannel', S.lastChannel); }
  S.view = { sid, cid };
  S.reply = null;
  S.editing = null;
  S.pending = [];
  S.panel = null;
  S.focusTile = null;
  S.stick = true;
  const url = `/channels/${sid}${cid ? '/' + cid : ''}`;
  if (location.pathname !== url) history[push ? 'pushState' : 'replaceState'](null, '', url);
  $('#app')?.classList.remove('nav-open');
  document.title = ch ? `${channelLabel(ch)} | Biscord` : (sid === '@me' ? 'Arkadaşlar | Biscord' : 'Biscord');
  renderGuilds();
  renderSidebar();
  renderMain();
  acts.renderActivityArea();
  if (cid) openChannel(cid);
}

function openChannel(cid) {
  const ch = S.channels.get(cid);
  if (!ch || !['text', 'dm', 'ghost'].includes(ch.type)) return;
  loadMessages(cid);
  if (ch.type !== 'ghost') ackSoon(cid);
  refreshCommands(ch.server_id);
}

// Botların / komutlarını önbelleğe al (30 sn'de bir tazelenir)
function refreshCommands(sid) {
  if (!sid) return;
  const c = S.commands.get(sid);
  if (c && Date.now() - c.at < 30000) return;
  S.commands.set(sid, { list: c?.list || [], at: Date.now() });
  api.get(`/servers/${sid}/commands`).then((list) => S.commands.set(sid, { list, at: Date.now() })).catch(() => {});
}

async function loadMessages(cid, older = false) {
  let st = S.messages.get(cid);
  if (st?.loading) return;
  if (st && !older) { if (S.view.cid === cid) renderMessages('bottom'); return; }
  if (!st) { st = { list: [], hasMore: true, loading: false, loaded: false }; S.messages.set(cid, st); }
  if (older && !st.hasMore) return;
  st.loading = true;
  try {
    const before = older && st.list[0] ? `&before=${st.list[0].id}` : '';
    const list = await api.get(`/channels/${cid}/messages?limit=50${before}`);
    list.forEach((m) => upsertUser(m.author));
    st.list = mergeMessages(st.list, list);
    st.hasMore = list.length === 50;
    st.loaded = true;
  } catch (e) {
    fail(e);
    S.messages.delete(cid);
    return;
  } finally { st.loading = false; }
  if (S.view.cid === cid) renderMessages(older ? 'prepend' : 'bottom');
}

const ackTimers = new Map();
function ackSoon(cid) {
  clearTimeout(ackTimers.get(cid));
  ackTimers.set(cid, setTimeout(() => {
    const ch = S.channels.get(cid);
    if (!ch?.last_message_id || ch.type === 'ghost' || S.read.get(cid) === ch.last_message_id) { S.mentions.delete(cid); return; }
    S.read.set(cid, ch.last_message_id);
    S.mentions.delete(cid);
    api.post(`/channels/${cid}/ack`, { message_id: ch.last_message_id }).catch(() => {});
    renderGuilds();
    renderSidebar();
  }, 400));
}
window.addEventListener('focus', () => { if (S.view.cid) ackSoon(S.view.cid); });

// ======================================================================= ana çizim
function renderApp() {
  root.innerHTML = `<div class="app" id="app">
    <nav class="guilds" id="guilds" aria-label="Sunucular"></nav>
    <aside class="sidebar">
      <div id="side-header"></div>
      <div class="side-body scroll" id="side-body"></div>
      <div id="voice-panel"></div>
      <div class="user-panel" id="user-panel"></div>
    </aside>
    <main class="main" id="main"></main>
    <div class="scrim" data-action="nav-close"></div>
  </div>
  <div id="conn-banner" class="toasts hidden" style="top:12px;bottom:auto"><div class="toast error">Bağlantı koptu, yeniden bağlanılıyor…</div></div>`;
  renderAll();
  renderAnnouncement();
}

function renderAll() {
  renderGuilds();
  renderSidebar();
  renderVoicePanel();
  renderUserPanel();
  renderMain();
}

function renderGuilds() {
  const el = $('#guilds');
  if (!el) return;
  const dmUnread = dmList().filter((c) => (S.mentions.get(c.id) || 0) > 0);
  const pending = [...S.friends.values()].filter((t) => t === 'incoming').length;
  const homeBadge = dmUnread.reduce((n, c) => n + S.mentions.get(c.id), 0) + pending;
  let html = `<div class="guild home ${S.view.sid === '@me' ? 'active' : ''}" title="Direkt Mesajlar">
      <span class="guild-pill"></span>
      <button class="guild-btn" data-action="home" aria-label="Ana sayfa"><img src="/favicon.svg" alt=""></button>
      ${homeBadge ? `<span class="badge">${homeBadge}</span>` : ''}
    </div>`;
  for (const c of dmUnread.slice(0, 5)) {
    const o = dmOther(c);
    html += `<div class="guild unread" title="${esc(displayName(o?.id))}"><span class="guild-pill"></span>
      <button class="guild-btn" data-action="dm" data-cid="${c.id}">${avatar(o, 48)}</button><span class="badge">${S.mentions.get(c.id)}</span></div>`;
  }
  html += '<div class="guild-sep"></div>';
  for (const s of S.servers.values()) {
    const mentions = serverMentions(s.id);
    html += `<div class="guild ${S.view.sid === s.id ? 'active' : ''} ${serverUnread(s.id) ? 'unread' : ''}" title="${esc(s.name)}" data-ctx="server" data-sid="${s.id}">
      <span class="guild-pill"></span>
      <button class="guild-btn" data-action="server" data-sid="${s.id}" aria-label="${esc(s.name)}">${serverIcon(s)}</button>
      ${mentions ? `<span class="badge">${mentions}</span>` : ''}
    </div>`;
  }
  html += `<div class="guild add" title="Sunucu Ekle"><button class="guild-btn" data-action="add-server" aria-label="Sunucu ekle">${icon('plus')}</button></div>`;
  if (pwa.canShowInstall()) html += `<div class="guild add" title="Uygulamayı İndir"><button class="guild-btn" data-action="install" aria-label="Uygulamayı indir">${icon('download')}</button></div>`;
  el.innerHTML = html;
}

function renderSidebar() {
  const head = $('#side-header');
  const body = $('#side-body');
  if (!head || !body) return;
  const top = body.scrollTop;
  if (S.view.sid === '@me') {
    head.innerHTML = `<div class="side-header"><button class="side-search" data-action="quick-switch">Sohbet bul ya da başlat</button></div>`;
    const pending = [...S.friends.values()].filter((t) => t === 'incoming').length;
    let html = `<button class="nav-item ${!S.view.cid ? 'active' : ''}" data-action="friends">${icon('users')} Arkadaşlar ${pending ? `<span class="badge">${pending}</span>` : ''}</button>
      <div class="side-label"><span>Direkt Mesajlar</span><button data-action="new-dm" title="DM Oluştur">${icon('plus', 'sm')}</button></div>`;
    const dms = dmList();
    if (!dms.length) html += '<p class="muted" style="padding:0 10px;font-size:13px">Henüz direkt mesajın yok. Bir arkadaşına mesaj göndererek başla!</p>';
    for (const c of dms) {
      const o = dmOther(c);
      const unread = isUnread(c);
      const n = S.mentions.get(c.id);
      const inCall = voiceIn(c.id).length;
      html += `<button class="dm-item ${S.view.cid === c.id ? 'active' : ''} ${unread ? 'unread' : ''}" data-action="dm" data-cid="${c.id}" data-ctx="user" data-uid="${o?.id}">
        ${avatar(o, 32, { status: true })}
        <div class="meta"><div>${esc(displayName(o?.id))}</div>${inCall ? `<small style="color:var(--green)">🔊 Sesli aramada</small>` : (presenceLine(o) ? `<small>${esc(presenceLine(o))}</small>` : '')}</div>
        ${n ? `<span class="badge">${n}</span>` : ''}
      </button>`;
    }
    body.innerHTML = html;
  } else {
    const s = server(S.view.sid);
    if (!s) return;
    head.innerHTML = `<div class="side-header clickable" data-action="server-menu"><span class="name">${esc(s.name)}</span>${icon('chevron', 'sm')}</div>`;
    const chans = serverChannels(s.id);
    const manage = can(s.id, P.MANAGE_CHANNELS);
    const cats = chans.filter((c) => c.type === 'category');
    const loose = chans.filter((c) => c.type !== 'category' && (!c.parent_id || !S.channels.has(c.parent_id)));
    const ghosts = chans.filter((c) => c.type === 'ghost');
    let html = ghosts.length ? `<div class="category ghost-cat"><span class="name">👻 Hayalet Kanallar</span></div>${ghosts.map(channelItem).join('')}` : '';
    html += loose.filter((c) => c.type !== 'ghost').map(channelItem).join('');
    for (const cat of cats) {
      const kids = chans.filter((c) => c.parent_id === cat.id);
      const collapsed = S.collapsed.has(cat.id);
      html += `<div class="category ${collapsed ? 'collapsed' : ''}" data-action="category-toggle" data-cid="${cat.id}" data-ctx="channel">
        <span class="chev">${icon('chevron', 'xs')}</span><span class="name">${esc(cat.name)}</span>
        ${manage ? `<button class="add" data-action="create-channel" data-parent="${cat.id}" title="Kanal Oluştur">${icon('plus', 'sm')}</button>` : ''}
      </div>`;
      html += kids.filter((c) => !collapsed || c.id === S.view.cid || isUnread(c) || voiceIn(c.id).length).map(channelItem).join('');
    }
    if (!chans.length) html = '<p class="muted" style="padding:10px;font-size:13px">Bu sunucuda henüz kanal yok.</p>';
    body.innerHTML = html;
  }
  body.scrollTop = top;
}

function channelItem(c) {
  const isVoice = c.type === 'voice';
  const n = S.mentions.get(c.id);
  const manage = can(c.server_id, P.MANAGE_CHANNELS);
  const act = S.activities.get(c.id);
  let html = `<div class="channel ${S.view.cid === c.id ? 'active' : ''} ${isUnread(c) ? 'unread' : ''} ${c.type === 'ghost' ? 'ghost' : ''}" data-action="channel" data-cid="${c.id}" data-ctx="channel">
    ${c.type === 'ghost' ? '<span class="ghost-ic">👻</span>' : icon(isVoice ? 'speaker' : 'hash')}<span class="name">${esc(c.name)}</span>
    ${act ? `<span class="act-ind" title="${esc(acts.GAMES[act.type]?.name || '')}">${acts.GAMES[act.type]?.emoji || '🎮'}</span>` : ''}
    ${n ? `<span class="badge">${n}</span>` : ''}
    <span class="tools">
      ${can(c.server_id, P.CREATE_INVITE) ? `<button data-action="invite" data-sid="${c.server_id}" title="Davet Oluştur">${icon('userPlus', 'sm')}</button>` : ''}
      ${manage ? `<button data-action="channel-settings" data-cid="${c.id}" title="Kanalı Düzenle">${icon('gear', 'sm')}</button>` : ''}
    </span></div>`;
  if (isVoice) {
    const vs = voiceIn(c.id);
    if (vs.length) {
      html += '<div class="voice-users">' + vs.map((v) => {
        const u = user(v.user_id);
        return `<div class="voice-user" data-action="profile" data-uid="${v.user_id}" data-ctx="user" data-sid="${c.server_id}">
          ${avatar(u, 24, { cls: voice?.speaking.has(v.user_id) ? 'speaking' : '' }).replace('class="avatar', `data-speak-uid="${v.user_id}" class="avatar`)}
          <span class="name">${esc(displayName(v.user_id, c.server_id))}</span>
          <span class="icons">${v.self_stream ? '<span class="live">CANLI</span>' : ''}${v.self_video ? icon('video', 'xs') : ''}
          ${v.server_mute || v.self_mute ? `<span class="${v.server_mute ? 'danger' : ''}">${icon('micOff', 'xs')}</span>` : ''}${v.self_deaf ? icon('headphonesOff', 'xs') : ''}</span>
        </div>`;
      }).join('') + '</div>';
    }
  }
  return html;
}

function renderVoicePanel() {
  const el = $('#voice-panel');
  if (!el) return;
  if (!voice?.connected) { el.innerHTML = ''; return; }
  const ch = S.channels.get(voice.channelId);
  const where = ch?.type === 'dm' ? displayName(dmOther(ch)?.id) : `${ch?.name || ''} / ${server(ch?.server_id)?.name || ''}`;
  el.innerHTML = `<div class="voice-panel">
    <div class="status"><div class="grow" style="min-width:0"><b>${icon('signal', 'sm')} Ses Bağlandı</b>
      <small data-action="goto-voice">${esc(where)}</small></div>
      <button class="icon-btn" data-action="voice-leave" title="Bağlantıyı Kes">${icon('phoneOff')}</button></div>
    <div class="acts">
      <button class="${voice.videoKind === 'camera' ? 'on' : ''}" data-action="voice-camera" title="Kamera">${icon('video', 'sm')}</button>
      <button class="${voice.videoKind === 'screen' ? 'on' : ''}" data-action="voice-screen" title="Ekran Paylaş">${icon('screen', 'sm')}</button>
      <button class="${voice.filter !== 'none' || voice.mode !== 'vad' ? 'on' : ''}" data-action="soundboard" title="Ses Efektleri, Filtreler ve Telsiz">🔊</button>
      <button class="${clips.clipActive() ? 'rec' : ''}" data-action="clip-toggle" title="${clips.clipActive() ? 'Klip modu açık — Alt+C ile kaydet, kapatmak için tıkla' : 'Klip Modu (son 30 sn kaydedici)'}">🎬</button>
      <button data-action="goto-voice" title="Aramayı Göster">${icon('maximize', 'sm')}</button>
    </div>
    ${voice.mode !== 'vad' ? `<button class="ptt-btn ${voice.pttActive ? 'on' : ''}" id="ptt-btn">${voice.mode === 'walkie' ? '📻' : '🎙️'} ${voice.pttActive ? 'Konuşuyorsun…' : `Konuşmak için basılı tut (${esc(keyName(voice.pttKey))})`}</button>` : ''}
    ${clips.clipActive() ? '<button class="clip-save" data-action="clip-save">● Son 30 sn\'yi kaydet (Alt+C)</button>' : ''}
    ${VOICE_FILTERS[voice.filter] && voice.filter !== 'none' ? `<small class="muted" style="display:block;margin-top:4px">Filtre: ${VOICE_FILTERS[voice.filter]}</small>` : ''}</div>`;
  const ptt = $('#ptt-btn');
  if (ptt) {
    ptt.onpointerdown = (e) => { e.preventDefault(); voice.setPtt(true); };
    ptt.onpointerup = ptt.onpointerleave = ptt.onpointercancel = () => voice.setPtt(false);
  }
}

function renderUserPanel() {
  const el = $('#user-panel');
  if (!el || !S.me) return;
  const me = S.me;
  const muted = voice?.muted || voice?.deafened;
  const deaf = voice?.deafened;
  el.innerHTML = `<div class="me" data-action="status-menu" title="Durumunu ayarla">
      ${avatar({ ...me, status: me.status_setting === 'invisible' ? 'offline' : me.status_setting }, 32, { status: true })}
      <div class="meta"><b>${esc(me.display_name)}</b><small>${esc(me.muted_until && me.muted_until > Date.now() ? '🔇 Susturuldun' : presenceLine(me) || STATUS_LABEL[me.status_setting] || me.username)}</small></div>
    </div>
    <button class="icon-btn ${muted ? 'red' : ''}" data-action="toggle-mute" title="${muted ? 'Sesi Aç' : 'Sustur'}">${icon(muted ? 'micOff' : 'mic')}</button>
    <button class="icon-btn ${deaf ? 'red' : ''}" data-action="toggle-deafen" title="${deaf ? 'Sağırlaştırmayı Kaldır' : 'Sağırlaştır'}">${icon(deaf ? 'headphonesOff' : 'headphones')}</button>
    <button class="icon-btn" data-action="user-settings" title="Kullanıcı Ayarları">${icon('gear')}</button>`;
}

const menuBtn = `<button class="icon-btn mobile-only" data-action="nav-open" aria-label="Menü">${icon('menu')}</button>`;

function renderMain() {
  const el = $('#main');
  if (!el) return;
  const ch = curChannel();
  if (!ch) {
    if (S.view.sid === '@me') return renderFriends();
    el.innerHTML = `<header class="main-header">${menuBtn}</header><div class="empty"><div class="art">🌌</div><p>Bu sunucuda metin kanalı yok.</p></div>`;
    return;
  }
  if (ch.type === 'voice') { renderVoiceView(ch); acts.renderActivityArea(); return; }
  const isServer = !!ch.server_id && ch.type !== 'ghost';
  el.innerHTML = `<header class="main-header" id="main-header"></header>
    <div id="call-banner"></div>
    <div id="activity-area" class="activity-area"></div>
    <div class="main-body">
      <section class="chat ${ch.type === 'ghost' ? 'ghost-chat' : ''}" id="chat">
        <div class="messages scroll" id="messages"><div class="load-more">Yükleniyor…</div></div>
        <div id="p2p-area"></div>
        <div class="composer-wrap" id="composer-wrap">
          <div id="autocomplete"></div>
          <div id="composer-extra"></div>
          <div class="composer" id="composer">
            <button class="cbtn" data-action="attach" title="Dosya yükle">${icon('plusCircle')}</button>
            <textarea id="input" rows="1" maxlength="4000"></textarea>
            <button class="cbtn" data-action="composer-emoji" title="Emoji">${icon('smile')}</button>
          </div>
          <div class="typing" id="typing"></div>
          <input type="file" id="file-input" multiple hidden>
        </div>
      </section>
      ${isServer ? `<aside class="members scroll ${S.showMembers ? '' : 'hidden'}" id="members"></aside>` : ''}
      <aside class="side-panel hidden" id="side-panel"></aside>
    </div>`;
  renderHeader();
  renderCallBanner();
  renderMembers();
  setupComposer(ch);
  renderP2P();
  acts.renderActivityArea();
  const box = $('#messages');
  box.addEventListener('scroll', () => {
    S.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (box.scrollTop < 300) {
      const st = S.messages.get(ch.id);
      if (st?.hasMore && !st.loading && st.loaded) loadMessages(ch.id, true);
    }
  }, { passive: true });
  if (S.messages.get(ch.id)?.loaded) renderMessages('bottom');
}

function renderHeader() {
  const el = $('#main-header');
  const ch = curChannel();
  if (!el || !ch || ch.type === 'voice') return;
  if (ch.type === 'dm') {
    const o = dmOther(ch);
    el.innerHTML = `${menuBtn}<div class="title">${avatar(o, 24, { status: true })}<span data-user="${o?.id}" style="cursor:pointer">${esc(displayName(o?.id))}</span>${o?.is_bot ? '<span class="bot-tag">BOT</span>' : ''}</div>
      ${presenceLine(o) ? `<div class="topic">${esc(presenceLine(o))}</div>` : '<div class="spacer"></div>'}
      <div class="tools">
        <button class="icon-btn" data-action="call" title="Sesli Arama Başlat">${icon('phone')}</button>
        <button class="icon-btn" data-action="call-video" title="Görüntülü Arama Başlat">${icon('video')}</button>
        <button class="icon-btn" data-action="act-start" title="Etkinlik Başlat (oyun / birlikte izle)">🎮</button>
        <button class="icon-btn" data-action="pins" title="Sabitlenmiş Mesajlar">${icon('pin')}</button>
        <button class="icon-btn" data-action="profile" data-uid="${o?.id}" title="Kullanıcı Profili">${icon('users')}</button>
        <input class="search" id="search" placeholder="Ara">
      </div>`;
  } else if (ch.type === 'ghost') {
    const inside = S.ghostPresence.get(ch.id) || [];
    el.innerHTML = `${menuBtn}<div class="title"><span>👻</span><span>${esc(ch.name)}</span></div>
      <div class="topic">Hayalet kanal • mesajlar hiçbir yere kaydedilmez • içeride: ${inside.map((id) => esc(displayName(id, ch.server_id))).join(', ') || 'yalnızca sen'}</div>
      <div class="tools"><button class="btn red sm" data-action="ghost-leave">Kanaldan Çık ve Sil</button></div>`;
    return;
  } else {
    el.innerHTML = `${menuBtn}<div class="title">${icon('hash')}<span>${esc(ch.name)}</span></div>
      ${ch.topic ? `<div class="topic" data-action="show-topic" title="${esc(ch.topic)}">${esc(ch.topic)}</div>` : '<div class="spacer"></div>'}
      <div class="tools">
        <button class="icon-btn" data-action="act-start" title="Etkinlik Başlat (oyun / birlikte izle)">🎮</button>
        ${server(ch.server_id)?.economy ? `<button class="icon-btn" data-action="shop" title="Coin, Seviye ve Mağaza">🪙</button>` : ''}
        <button class="icon-btn" data-action="pins" title="Sabitlenmiş Mesajlar">${icon('pin')}</button>
        <button class="icon-btn ${S.showMembers ? 'active' : ''}" data-action="toggle-members" title="Üye Listesi">${icon('users')}</button>
        <input class="search" id="search" placeholder="${esc(server(ch.server_id)?.name || '')} içinde ara">
      </div>`;
  }
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) openSearch(e.target.value.trim()); });
}

// ---------------------------------------------------------------- mesajlar
function chatStart(ch) {
  if (ch.type === 'dm') {
    const o = dmOther(ch);
    return `<div class="chat-start">${avatar(o, 80)}<h2>${esc(displayName(o?.id))}</h2>
      <p>Bu, <b>@${esc(o?.username)}</b> ile olan direkt mesaj geçmişinin başlangıcı.</p></div>`;
  }
  if (ch.type === 'ghost') {
    return `<div class="chat-start"><div class="big-icon" style="font-size:40px">👻</div><h2>#${esc(ch.name)} — Hayalet Kanal</h2>
      <p>Burada yazılanlar <b>hiçbir yere kaydedilmez</b>. Yalnızca şu an kanalın içinde olanlar görür; kanaldan çıktığında mesajlar ekranından da silinir.</p></div>`;
  }
  return `<div class="chat-start"><div class="big-icon">${icon('hash')}</div><h2>#${esc(ch.name)} kanalına hoş geldin!</h2>
    <p>Bu, #${esc(ch.name)} kanalının başlangıcı.${ch.topic ? ' ' + esc(ch.topic) : ''}</p></div>`;
}

function renderMessages(mode) {
  const box = $('#messages');
  const ch = curChannel();
  if (!box || !ch) return;
  const st = S.messages.get(ch.id);
  if (!st?.loaded) { box.innerHTML = '<div class="load-more">Yükleniyor…</div>'; return; }
  const prevH = box.scrollHeight;
  const prevTop = box.scrollTop;
  const stick = S.stick;
  let html = st.hasMore ? '<div class="load-more">Eski mesajlar yükleniyor…</div>' : chatStart(ch);
  let prev = null;
  for (const m of st.list) {
    if (!prev || !isSameDay(prev.created_at, m.created_at)) html += `<div class="divider"><span>${fmtDay(m.created_at)}</span></div>`;
    html += messageHTML(m, prev, ch);
    prev = m;
  }
  box.innerHTML = html;
  if (mode === 'bottom' || (mode !== 'prepend' && stick)) { box.scrollTop = box.scrollHeight; S.stick = true; }
  else if (mode === 'prepend') box.scrollTop = box.scrollHeight - prevH + prevTop;
  else box.scrollTop = prevTop;
  watchMedia(box);
  highlightIn(box);
}

function watchMedia(box) {
  $$('img, video', box).forEach((m) => {
    if (m.dataset.watched) return;
    m.dataset.watched = 1;
    m.addEventListener(m.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => { if (S.stick) box.scrollTop = box.scrollHeight; }, { once: true });
  });
}

function appendMessage(m) {
  const box = $('#messages');
  const ch = curChannel();
  const st = S.messages.get(ch?.id);
  if (!box || !st?.loaded) return;
  const idx = st.list.findIndex((x) => x.id === m.id);
  if (idx !== st.list.length - 1) return renderMessages();
  const prev = st.list[idx - 1];
  const stick = S.stick || m.author.id === S.me.id;
  let html = '';
  if (!prev || !isSameDay(prev.created_at, m.created_at)) html += `<div class="divider"><span>${fmtDay(m.created_at)}</span></div>`;
  box.insertAdjacentHTML('beforeend', html + messageHTML(m, prev, ch));
  if (stick) { box.scrollTop = box.scrollHeight; S.stick = true; }
  watchMedia(box);
  highlightIn(box);
}

function replaceMessage(id) {
  const box = $('#messages');
  const ch = curChannel();
  const st = S.messages.get(ch?.id);
  const el = box?.querySelector(`[data-mid="${id}"]`);
  if (!el || !st) return;
  const i = st.list.findIndex((x) => x.id === id);
  const editingText = S.editing === id ? el.querySelector('.edit-box textarea')?.value : null;
  el.outerHTML = messageHTML(st.list[i], st.list[i - 1], ch);
  if (editingText != null) {
    const ta = box.querySelector(`[data-mid="${id}"] .edit-box textarea`);
    if (ta) ta.value = editingText;
  }
  watchMedia(box);
  highlightIn(box);
}

function attachmentHTML(a) {
  const url = esc(a.url);
  const ct = a.content_type || '';
  if (/^image\/(png|jpe?g|gif|webp)/.test(ct)) return `<img class="att-img" src="${url}" alt="${esc(a.filename)}" loading="lazy" data-action="lightbox" data-src="${url}">`;
  if (/^video\/(mp4|webm|quicktime)/.test(ct)) return `<video class="att-video" src="${url}" controls preload="metadata"></video>`;
  if (/^audio\//.test(ct)) return `<div class="att-file"><span class="fi">${icon('file')}</span><div class="grow"><a href="${url}" target="_blank" rel="noopener">${esc(a.filename)}</a><audio class="att-audio" src="${url}" controls preload="none"></audio></div></div>`;
  const pk = files.previewKind(a);
  const pv = pk ? `<button class="btn secondary sm" data-action="${pk === '3d' ? 'preview-3d' : 'preview-code'}" data-url="${url}" data-name="${esc(a.filename)}" data-size="${a.size}">${pk === '3d' ? '🧊 3D Önizle' : '👁 Önizle'}</button>` : '';
  return `<div class="att-file"><span class="fi">${pk === '3d' ? '🧊' : icon('file')}</span><div class="grow"><a href="${url}" target="_blank" rel="noopener" download="${esc(a.filename)}">${esc(a.filename)}</a><small>${fmtSize(a.size)}</small></div>
    ${pv}<a class="icon-btn" href="${url}" download="${esc(a.filename)}" title="İndir">${icon('download')}</a></div>`;
}

function embedHTML(e, ctx) {
  const color = Number.isInteger(e.color) ? '#' + e.color.toString(16).padStart(6, '0') : 'var(--brand)';
  const title = e.title ? (e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)) : '';
  return `<div class="embed" style="border-left-color:${color}"><div class="e-main">
    ${e.author ? `<div class="e-author">${esc(e.author)}</div>` : ''}
    ${title ? `<div class="e-title">${title}</div>` : ''}
    ${e.description ? `<div class="e-desc msg-text">${markdown(e.description, ctx)}</div>` : ''}
    ${e.fields?.length ? `<div class="e-fields">${e.fields.map((f) => `<div class="e-field ${f.inline ? 'inline' : ''}"><b>${esc(f.name)}</b><div class="msg-text">${markdown(f.value, ctx)}</div></div>`).join('')}</div>` : ''}
    ${e.image ? `<img class="e-image" src="${esc(e.image)}" alt="" loading="lazy" data-action="lightbox" data-src="${esc(e.image)}">` : ''}
    ${e.footer || e.timestamp ? `<div class="e-footer">${esc(e.footer || '')}${e.footer && e.timestamp ? ' • ' : ''}${e.timestamp ? esc(fmtTime(Date.parse(e.timestamp) || Date.now())) : ''}</div>` : ''}
  </div>${e.thumbnail ? `<img class="e-thumb" src="${esc(e.thumbnail)}" alt="">` : ''}</div>`;
}

function messageHTML(m, prev, ch) {
  const sid = ch.server_id;
  const u = user(m.author.id) || m.author;
  const name = esc(displayName(u.id, sid));
  const color = nameColor(u.id, sid);
  const style = color ? ` style="color:${esc(color)}"` : '';
  if (m.type === 7) {
    return `<div class="msg system" data-mid="${m.id}"><div class="sys-icon">${icon('arrowJoin')}</div>
      <div class="msg-body"><b data-user="${u.id}"${style}>${name}</b> sunucuya katıldı. Hoş geldin! 👋 <span class="msg-time">${fmtTime(m.created_at)}</span></div></div>`;
  }
  if (m.type === 8) {
    return `<div class="msg system" data-mid="${m.id}"><div class="sys-icon">⭐</div>
      <div class="msg-body"><b data-user="${u.id}"${style}>${name}</b> ${componentHTML(m, sid)} <span class="msg-time">${fmtTime(m.created_at)}</span></div></div>`;
  }
  const grouped = prev && prev.type === 0 && prev.author.id === u.id && !m.reply_to && m.created_at - prev.created_at < 7 * 60e3 && isSameDay(prev.created_at, m.created_at);
  const ctx = { mentionNames: new Set(m.mentions.map((id) => user(id)?.username).filter(Boolean)), everyone: m.mention_everyone };
  const mentioned = m.mention_everyone || m.mentions.includes(S.me.id) || (m.referenced?.author?.id === S.me.id && u.id !== S.me.id);
  const mine = u.id === S.me.id;
  const jumbo = isEmojiOnly(m.content) && !m.attachments.length;
  let reply = '';
  if (m.reply_to) {
    const r = m.referenced;
    reply = r
      ? `<div class="reply-ctx" data-action="jump" data-mid="${r.id}">${avatar(r.author, 16)}<b${nameColor(r.author.id, sid) ? ` style="color:${esc(nameColor(r.author.id, sid))}"` : ''}>@${esc(displayName(r.author.id, sid))}</b><span>${esc(r.content) || '<i>Eki görüntülemek için tıkla</i>'}</span></div>`
      : '<div class="reply-ctx"><span><i>Orijinal mesaj silindi</i></span></div>';
  }
  const editing = S.editing === m.id;
  const text = editing
    ? `<div class="edit-box"><textarea rows="1" data-edit="${m.id}">${esc(m.content)}</textarea>
        <small>Kaydetmek için Enter • İptal için Esc • <a data-action="edit-cancel">iptal</a> • <a data-action="edit-save" data-mid="${m.id}">kaydet</a></small></div>`
    : (m.content ? `<div class="msg-text ${jumbo ? 'jumbo' : ''}">${markdown(m.content, ctx)}${m.edited_at ? `<span class="edited" title="${esc(fmtTime(m.edited_at))}">(düzenlendi)</span>` : ''}</div>` : '');
  const reactions = m.reactions.length ? `<div class="reactions">${m.reactions.map((r) => `<button class="reaction ${r.users.includes(S.me.id) ? 'me' : ''}" data-action="toggle-react" data-mid="${m.id}" data-emoji="${esc(r.emoji)}" title="${esc(r.users.slice(0, 10).map((id) => displayName(id, sid)).join(', '))}">${esc(r.emoji)}<b>${r.count}</b></button>`).join('')}
    <button class="reaction add" data-action="react-picker" data-mid="${m.id}" title="Tepki Ekle">${icon('smilePlus', 'sm')}</button></div>` : '';
  const canManage = !sid || can(sid, P.MANAGE_MESSAGES);
  if (m.ghost) {
    return `<div class="msg ghost-msg ${grouped ? 'grouped' : ''} ${mentioned ? 'mentioned' : ''}" data-mid="${m.id}">
      ${grouped ? `<div class="msg-side">${timeHM(m.created_at)}</div>` : `<div class="msg-avatar" data-user="${u.id}">${avatar(u, 40)}</div>`}
      <div class="msg-body">${grouped ? '' : `<div class="msg-head"><span class="msg-author${glowCls(u.id, sid)}" data-user="${u.id}"${style}>${name}</span><span class="msg-time">${fmtTime(m.created_at)} • 👻 kaydedilmiyor</span></div>`}${text}</div></div>`;
  }
  return `<div class="msg ${grouped ? 'grouped' : ''} ${mentioned ? 'mentioned' : ''} ${editing ? 'editing' : ''}" data-mid="${m.id}" data-ctx="message">
    ${reply}
    ${grouped
      ? `<div class="msg-side" title="${esc(fmtTime(m.created_at))}">${timeHM(m.created_at)}</div>`
      : `<div class="msg-avatar" data-user="${u.id}">${avatar(u, 40)}</div>`}
    <div class="msg-body">
      ${grouped ? '' : `<div class="msg-head"><span class="msg-author${glowCls(u.id, sid)}" data-user="${u.id}"${style}>${name}</span>${nameExtras(u.id, sid)}${u.is_bot ? `<span class="bot-tag">${icon('check', 'xs')}BOT</span>` : ''}<span class="msg-time" title="${esc(new Date(m.created_at).toLocaleString('tr-TR'))}">${fmtTime(m.created_at)}</span></div>`}
      ${text}
      ${m.attachments.length ? `<div class="attachments">${m.attachments.map(attachmentHTML).join('')}</div>` : ''}
      ${m.embeds.map((e) => embedHTML(e, ctx)).join('')}
      ${m.components ? componentHTML(m, sid) : ''}
      ${reactions}
    </div>
    <div class="msg-actions">
      ${QUICK_REACTIONS.slice(0, 3).map((e) => `<button class="quick" data-action="quick-react" data-mid="${m.id}" data-emoji="${e}" title="${e}">${e}</button>`).join('')}
      <button data-action="react-picker" data-mid="${m.id}" title="Tepki Ekle">${icon('smilePlus', 'sm')}</button>
      <button data-action="reply" data-mid="${m.id}" title="Yanıtla">${icon('reply', 'sm')}</button>
      ${mine ? `<button data-action="edit" data-mid="${m.id}" title="Düzenle">${icon('edit', 'sm')}</button>` : ''}
      ${mine || canManage ? `<button data-action="delete-msg" data-mid="${m.id}" title="Sil" class="danger">${icon('trash', 'sm')}</button>` : ''}
      <button data-action="msg-menu" data-mid="${m.id}" title="Diğer">${icon('more', 'sm')}</button>
    </div>
  </div>`;
}

const findMsg = (id) => S.messages.get(S.view.cid)?.list.find((m) => m.id === id);

function startEdit(id) {
  const m = findMsg(id);
  if (!m || m.author.id !== S.me.id) return;
  S.editing = id;
  replaceMessage(id);
  const ta = $(`[data-edit="${id}"]`);
  if (!ta) return;
  autosize(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(id); }
  });
}
function cancelEdit() {
  const id = S.editing;
  S.editing = null;
  if (id) replaceMessage(id);
  $('#input')?.focus();
}
async function saveEdit(id) {
  const ta = $(`[data-edit="${id}"]`);
  const m = findMsg(id);
  if (!ta || !m) return cancelEdit();
  const content = ta.value;
  if (!content.trim() && !m.attachments.length) {
    S.editing = null;
    replaceMessage(id);
    return deleteMsg(id);
  }
  S.editing = null;
  if (content !== m.content) {
    try { const upd = await api.patch(`/messages/${id}`, { content }); H.MESSAGE_UPDATE(upd); } catch (e) { fail(e); }
  }
  replaceMessage(id);
  $('#input')?.focus();
}

async function deleteMsg(id, skipConfirm) {
  if (!skipConfirm && !(await confirmDialog('Mesajı Sil', 'Bu mesajı silmek istediğinden emin misin? (Shift basılıyken tıklarsan onay sorulmaz)', 'Sil'))) return;
  try { await api.del(`/messages/${id}`); } catch (e) { fail(e); }
}

async function toggleReaction(mid, emoji) {
  const m = findMsg(mid);
  const mineR = m?.reactions.find((r) => r.emoji === emoji)?.users.includes(S.me.id);
  try {
    await (mineR ? api.del(`/messages/${mid}/reactions/${encodeURIComponent(emoji)}`) : api.put(`/messages/${mid}/reactions/${encodeURIComponent(emoji)}`));
  } catch (e) { fail(e); }
}

function jumpTo(mid) {
  const el = $(`#messages [data-mid="${mid}"]`);
  if (!el) return toast('Mesaj yüklü değil — yukarı kaydırarak bulabilirsin');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 1600);
}

// ---------------------------------------------------------------- yazma alanı
function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, innerHeight * 0.5) + 'px';
}

const BUILTIN_COMMANDS = [
  { name: 'shrug', description: 'Mesajının sonuna ¯\\_(ツ)_/¯ ekler', run: (t) => `${t} ¯\\_(ツ)_/¯`.trim() },
  { name: 'tableflip', description: 'Masayı devirir (╯°□°)╯︵ ┻━┻', run: (t) => `${t} (╯°□°)╯︵ ┻━┻`.trim() },
  { name: 'unflip', description: 'Masayı düzeltir ┬─┬ノ( º _ ºノ)', run: (t) => `${t} ┬─┬ノ( º _ ºノ)`.trim() },
  { name: 'spoiler', description: 'Mesajını spoiler olarak gönderir', run: (t) => (t ? `||${t}||` : '') },
  { name: 'me', description: 'Mesajını italik yapar', run: (t) => (t ? `*${t}*` : '') },
  { name: 'nick', description: 'Bu sunucudaki takma adını değiştirir', server: true, run: (t, ch) => { changeNick(ch.server_id, S.me.id, t); return null; } },
  { name: 'anket', description: 'Canlı anket oluşturur', run: (t, ch) => { pollModal(ch); return null; } },
  { name: 'yapilacaklar', description: 'Ortak yapılacaklar listesi oluşturur', run: (t, ch) => { todoModal(ch); return null; } },
  { name: 'oyun', description: 'Mini oyun veya birlikte izleme başlatır', run: (t, ch) => { acts.pickActivity(ch); return null; } },
  { name: 'izle', description: 'Birlikte izleme başlatır', usage: '[bağlantı]', run: (t, ch) => { startWatch(ch, t); return null; } },
  { name: 'kod', description: 'Kod çalıştırıcıyı açar (JS / Python)', run: (t, ch) => { sandboxModal(ch); return null; } },
  { name: 'gunluk', description: 'Günlük coin ödülünü alır', server: true, run: (t, ch) => { claimDaily(ch.server_id); return null; } },
  { name: 'bakiye', description: 'Coin, seviye ve mağaza', server: true, run: (t, ch) => { shopModal(ch.server_id, 'me'); return null; } },
  { name: 'magaza', description: 'Coin mağazasını açar', server: true, run: (t, ch) => { shopModal(ch.server_id, 'shop'); return null; } },
  { name: 'siralama', description: 'Seviye sıralamasını gösterir', server: true, run: (t, ch) => { shopModal(ch.server_id, 'top'); return null; } },
  { name: 'ghost', description: 'Şifreyle hayalet kanal açar', usage: '<şifre>', server: true, run: (t, ch) => { unlockGhost(ch.server_id, t); return null; } },
  { name: 'hayalet', description: 'Şifreyle hayalet kanal açar', usage: '<şifre>', server: true, run: (t, ch) => { unlockGhost(ch.server_id, t); return null; } },
  { name: 'durum', description: 'Özel durumunu (rich presence) tasarlar', run: () => { presenceEditor(); return null; } },
];

async function unlockGhost(sid, password) {
  if (!password) {
    password = await promptDialog('👻 Hayalet Kanala Gir', 'Gizli şifre', '', { sub: 'Bu sunucudaki bir hayalet kanalın şifresini gir.', ok: 'Gir', max: 64 });
    if (!password) return;
  }
  try {
    const c = await api.post(`/servers/${sid}/ghost/unlock`, { password });
    S.channels.set(c.id, c);
    navigate(sid, c.id);
  } catch (e) { fail(e); }
}

async function startWatch(ch, url) {
  if (!S.activities.has(ch.id)) {
    const r = await new Promise((res) => socket.emit('act:start', { channel_id: ch.id, type: 'watch' }, res));
    if (!r?.ok) return toast(r?.error || 'Başlatılamadı', 'error');
    S.activities.set(ch.id, r.activity);
    acts.renderActivityArea();
    await acts.joinActivity(ch.id, true);
  } else await acts.joinActivity(ch.id, true);
  if (url) setTimeout(() => socket.emit('act:input', { channel_id: ch.id, data: { cmd: 'load', url } }), 300);
}

function renderComposerState() {
  const ch = curChannel();
  const comp = $('#composer');
  const ta = $('#input');
  if (!ch || !comp || !ta) return;
  const canSend = ch.type === 'dm' || can(ch.server_id, P.SEND_MESSAGES);
  comp.classList.toggle('disabled', !canSend);
  ta.disabled = !canSend;
  ta.placeholder = !canSend ? 'Bu kanalda mesaj gönderme iznin yok'
    : ch.type === 'dm' ? `@${displayName(dmOther(ch)?.id)} kullanıcısına mesaj gönder` : `#${ch.name} kanalına mesaj gönder`;
}

function renderComposerExtra() {
  const el = $('#composer-extra');
  if (!el) return;
  const ch = curChannel();
  let html = '';
  if (S.reply) {
    const m = findMsg(S.reply);
    if (m) html += `<div class="composer-bar"><span><b>${esc(displayName(m.author.id, ch?.server_id))}</b> kullanıcısına yanıt veriliyor</span><button data-action="cancel-reply" title="İptal">${icon('x', 'sm')}</button></div>`;
  }
  if (S.pending.length) {
    html += `<div class="pending-files">${S.pending.map((p, i) => `<div class="pending-file">
      ${p.preview ? `<img class="thumb" src="${p.preview}" alt="">` : `<div class="thumb">${icon('file')}</div>`}
      <div class="name" title="${esc(p.file.name)}">${esc(p.file.name)}</div><small class="muted">${fmtSize(p.file.size)}</small>
      <button data-action="remove-pending" data-i="${i}" title="Kaldır">${icon('trash', 'sm')}</button></div>`).join('')}</div>`;
  }
  el.innerHTML = html;
  $('#composer')?.style.setProperty('border-radius', html ? '0 0 8px 8px' : '8px');
}

function addFiles(files) {
  const ch = curChannel();
  if (!ch) return;
  if (ch.server_id && !can(ch.server_id, P.ATTACH_FILES)) return toast('Bu kanalda dosya ekleme iznin yok', 'error');
  for (const f of files) {
    if (S.pending.length >= 10) { toast('En fazla 10 dosya ekleyebilirsin', 'error'); break; }
    if (f.size > CONFIG.maxUploadMB * 1048576) { toast(`${f.name} çok büyük (en fazla ${CONFIG.maxUploadMB} MB)`, 'error'); continue; }
    S.pending.push({ file: f, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null });
  }
  renderComposerExtra();
  $('#input')?.focus();
}

let lastTypingSent = 0;
function setupComposer(ch) {
  const ta = $('#input');
  const fileInput = $('#file-input');
  ta.value = S.drafts.get(ch.id) || '';
  renderComposerState();
  renderComposerExtra();
  autosize(ta);
  if (matchMedia('(pointer:fine)').matches) ta.focus();

  fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
  ta.addEventListener('input', () => {
    autosize(ta);
    if (ta.value.trim() && !ta.value.startsWith('/') && Date.now() - lastTypingSent > 7000) {
      lastTypingSent = Date.now();
      socket.emit('typing', ch.id);
    }
    updateAutocomplete();
  });
  ta.addEventListener('keydown', (e) => {
    if (acState.items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        acState.sel = (acState.sel + (e.key === 'ArrowDown' ? 1 : -1) + acState.items.length) % acState.items.length;
        drawAutocomplete();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAutocomplete(acState.sel); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAutocomplete(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    else if (e.key === 'Escape' && S.reply) { e.stopPropagation(); S.reply = null; renderComposerExtra(); }
    else if (e.key === 'ArrowUp' && !ta.value) {
      const mine = [...(S.messages.get(ch.id)?.list || [])].reverse().find((m) => m.author.id === S.me.id && m.type === 0);
      if (mine) { e.preventDefault(); startEdit(mine.id); }
    }
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  ta.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));

  const chat = $('#chat');
  let dragDepth = 0;
  chat.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    if (dragDepth++ === 0) chat.insertAdjacentHTML('beforeend', `<div class="drop-overlay">${esc(channelLabel(ch))} kanalına yükle</div>`);
  });
  chat.addEventListener('dragover', (e) => e.preventDefault());
  chat.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('.drop-overlay', chat)?.remove(); } });
  chat.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('.drop-overlay', chat)?.remove();
    if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
  });
}

async function sendMessage() {
  const ta = $('#input');
  const ch = curChannel();
  if (!ta || !ch) return;
  let text = ta.value;
  const cmd = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
  if (cmd) {
    const b = BUILTIN_COMMANDS.find((c) => c.name === cmd[1].toLowerCase() && (!c.server || ch.server_id));
    if (b) {
      const out = b.run((cmd[2] || '').trim(), ch);
      if (out === null) { ta.value = ''; autosize(ta); return; }
      text = out;
    }
  }
  if (!text.trim() && !S.pending.length) return;
  const fd = new FormData();
  fd.append('content', text);
  if (S.reply) fd.append('reply_to', S.reply);
  for (const p of S.pending) fd.append('files', p.file, p.file.name);
  const saved = { text: ta.value, pending: S.pending, reply: S.reply };
  const hadFiles = S.pending.length > 0;
  ta.value = '';
  autosize(ta);
  S.drafts.delete(ch.id);
  S.pending = [];
  S.reply = null;
  renderComposerExtra();
  closeAutocomplete();
  if (hadFiles) toast('Yükleniyor…');
  try {
    const m = await api.post(`/channels/${ch.id}/messages`, fd);
    onNewMessage(m);
    saved.pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
  } catch (e) {
    fail(e);
    if (S.view.cid === ch.id && !ta.value) {
      ta.value = saved.text;
      S.pending = saved.pending;
      S.reply = saved.reply;
      autosize(ta);
      renderComposerExtra();
    }
  }
}

// otomatik tamamlama: @bahsetme, /komut, :emoji
const acState = { items: [], sel: 0, start: 0, end: 0, kind: '' };
function closeAutocomplete() { acState.items = []; const el = $('#autocomplete'); if (el) el.innerHTML = ''; }

function updateAutocomplete() {
  const ta = $('#input');
  const ch = curChannel();
  if (!ta || !ch) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  let m;
  acState.items = [];
  if ((m = before.match(/^\/(\w*)$/))) {
    const q = m[1].toLowerCase();
    refreshCommands(ch.server_id);
    const list = [
      ...BUILTIN_COMMANDS.filter((c) => !c.server || ch.server_id).map((c) => ({ name: c.name, description: c.description, usage: c.usage, src: 'Biscord' })),
      ...(S.commands.get(ch.server_id)?.list || []).map((c) => ({ name: c.name, description: c.description, usage: c.usage, src: c.bot.display_name })),
    ];
    acState.items = list.filter((c) => c.name.startsWith(q)).slice(0, 12).map((c) => ({
      html: `<b>/${esc(c.name)}</b>${c.usage ? ` <span class="muted">${esc(c.usage)}</span>` : ''}<span class="muted" style="margin-left:6px">${esc(c.description || '')}</span><small>${esc(c.src)}</small>`,
      insert: `/${c.name} `,
    }));
    acState.kind = 'Komutlar';
    acState.start = 0;
  } else if ((m = before.match(/(^|\s)@([\w.]{0,32})$/))) {
    const q = m[2].toLowerCase();
    let ids = ch.server_id ? [...server(ch.server_id).members.keys()] : ch.recipients;
    ids = ids.filter((id) => {
      const u = user(id);
      return u && (u.username.startsWith(q) || displayName(id, ch.server_id).toLocaleLowerCase('tr').startsWith(q));
    }).slice(0, 10);
    acState.items = ids.map((id) => {
      const u = user(id);
      return { html: `${avatar(u, 24)}<b>${esc(displayName(id, ch.server_id))}</b><small>${esc(u.username)}</small>`, insert: `@${u.username} ` };
    });
    if (ch.server_id && can(ch.server_id, P.MENTION_EVERYONE)) {
      for (const k of ['everyone', 'here']) if (k.startsWith(q)) acState.items.push({ html: `<b>@${k}</b><small>${k === 'everyone' ? 'Herkesi bilgilendirir' : 'Çevrimiçi herkesi bilgilendirir'}</small>`, insert: `@${k} ` });
    }
    acState.kind = 'Üyeler';
    acState.start = pos - m[2].length - 1;
  } else if ((m = before.match(/(^|\s):([\p{L}_]{2,})$/u))) {
    const q = m[2].toLocaleLowerCase('tr');
    const found = [];
    for (const c of EMOJI_CATEGORIES) for (const [e, k] of c.list) if (k.includes(q) && found.length < 10) found.push([e, k]);
    acState.items = found.map(([e, k]) => ({ html: `<span style="font-size:20px">${e}</span><b>:${esc(k.split(' ')[0])}:</b>`, insert: e }));
    acState.kind = 'Emoji';
    acState.start = pos - m[2].length - 1;
  }
  acState.end = pos;
  acState.sel = 0;
  drawAutocomplete();
}

function drawAutocomplete() {
  const el = $('#autocomplete');
  if (!el) return;
  if (!acState.items.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="autocomplete"><h4>${acState.kind}</h4>${acState.items.map((it, i) => `<div class="ac-item ${i === acState.sel ? 'sel' : ''}" data-ac="${i}">${it.html}</div>`).join('')}</div>`;
  el.querySelectorAll('[data-ac]').forEach((d) => d.addEventListener('mousedown', (e) => { e.preventDefault(); pickAutocomplete(+d.dataset.ac); }));
  el.querySelector('.ac-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function pickAutocomplete(i) {
  const ta = $('#input');
  const it = acState.items[i];
  if (!ta || !it) return;
  ta.value = ta.value.slice(0, acState.start) + it.insert + ta.value.slice(acState.end);
  const p = acState.start + it.insert.length;
  ta.setSelectionRange(p, p);
  ta.focus();
  closeAutocomplete();
  autosize(ta);
}

function renderTyping() {
  const el = $('#typing');
  const ch = curChannel();
  if (!el || !ch) return;
  const ids = [...(S.typing.get(ch.id)?.keys() || [])].filter((id) => id !== S.me.id);
  if (!ids.length) { el.innerHTML = ''; return; }
  const names = ids.map((id) => `<b>${esc(displayName(id, ch.server_id))}</b>`);
  const text = ids.length === 1 ? `${names[0]} yazıyor…`
    : ids.length === 2 ? `${names[0]} ve ${names[1]} yazıyor…`
      : ids.length === 3 ? `${names[0]}, ${names[1]} ve ${names[2]} yazıyor…` : 'Birkaç kişi yazıyor…';
  el.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span>${text}</span>`;
}

// ---------------------------------------------------------------- üye listesi
function renderMembers() {
  const el = $('#members');
  const s = server(S.view.sid);
  if (!el || !s) return;
  const hoisted = [...s.roles.values()].filter((r) => r.hoist && r.id !== s.id).sort((a, b) => b.position - a.position);
  const groups = new Map(hoisted.map((r) => [r.id, []]));
  const onlineList = [];
  const offlineList = [];
  for (const m of s.members.values()) {
    const u = user(m.user_id);
    if (!u) continue;
    if (u.status === 'offline') { offlineList.push(m); continue; }
    const r = memberRoles(s.id, m.user_id).find((x) => x.hoist);
    (r && groups.has(r.id) ? groups.get(r.id) : onlineList).push(m);
  }
  const sortFn = (a, b) => displayName(a.user_id, s.id).localeCompare(displayName(b.user_id, s.id), 'tr');
  const row = (m) => {
    const u = user(m.user_id);
    const color = nameColor(m.user_id, s.id);
    const v = S.voice.get(m.user_id);
    return `<div class="member ${u.status === 'offline' ? 'offline' : ''}" data-action="profile" data-uid="${u.id}" data-ctx="user" data-sid="${s.id}">
      ${avatar(u, 32, { status: true })}
      <div class="meta"><div><span class="${glowCls(u.id, s.id)}"${color ? ` style="color:${esc(color)}"` : ''}>${esc(displayName(u.id, s.id))}</span>
        ${u.is_bot ? '<span class="bot-tag">BOT</span>' : ''}${s.owner_id === u.id ? `<span class="crown" title="Sunucu Sahibi">${icon('crown', 'xs')}</span>` : ''}${m.title ? `<span class="title-chip">${esc(m.title)}</span>` : ''}</div>
        ${v?.server_id === s.id ? `<small>🔊 ${esc(S.channels.get(v.channel_id)?.name || 'Seste')}</small>` : presenceLine(u) ? `<small>${esc(presenceLine(u))}</small>` : ''}</div>
    </div>`;
  };
  let html = '';
  for (const r of hoisted) {
    const list = groups.get(r.id);
    if (list.length) html += `<h3>${esc(r.name)} — ${list.length}</h3>` + list.sort(sortFn).map(row).join('');
  }
  if (onlineList.length) html += `<h3>Çevrimiçi — ${onlineList.length}</h3>` + onlineList.sort(sortFn).map(row).join('');
  if (offlineList.length) html += `<h3>Çevrimdışı — ${offlineList.length}</h3>` + offlineList.sort(sortFn).map(row).join('');
  el.innerHTML = html;
}

// ---------------------------------------------------------------- arkadaşlar
function renderFriends() {
  const el = $('#main');
  const tab = S.friendsTab;
  const counts = { incoming: 0, outgoing: 0 };
  for (const t of S.friends.values()) if (t in counts) counts[t]++;
  const tabs = [['online', 'Çevrimiçi'], ['all', 'Tümü'], ['pending', 'Bekleyen']];
  el.innerHTML = `<header class="main-header">${menuBtn}<div class="title">${icon('users')} Arkadaşlar</div>
    <div class="friends-tabs" style="margin-left:12px">${tabs.map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-action="friends-tab" data-tab="${k}">${l}${k === 'pending' && counts.incoming ? ` <span class="badge">${counts.incoming}</span>` : ''}</button>`).join('')}
    <button class="add ${tab === 'add' ? 'active' : ''}" data-action="friends-tab" data-tab="add">Arkadaş Ekle</button></div>
    <div class="spacer"></div><button class="icon-btn" data-action="new-dm" title="Yeni Grup DM">${icon('message')}</button></header>
    <div class="main-body"><div class="friends-page scroll" id="friends-page"></div><aside class="home-side scroll" id="home-side"></aside></div>`;
  const page = $('#friends-page');
  if (tab === 'add') {
    page.innerHTML = `<div class="add-friend"><h3>ARKADAŞ EKLE</h3><p>Biscord kullanıcı adıyla arkadaşlarını ekleyebilirsin.</p>
      <form id="add-friend"><input name="username" placeholder="Biscord kullanıcı adını girerek arkadaş ekleyebilirsin." autocomplete="off" maxlength="32">
      <button class="btn sm" type="submit">Arkadaşlık İsteği Gönder</button></form><p id="af-msg" style="margin-top:8px;font-size:14px"></p>
      <div class="empty"><div class="art">🧑‍🤝‍🧑</div><p>Biscord, arkadaşlarınla birlikte daha eğlenceli. Kullanıcı adını öğren, ekle ve konuşmaya başla!</p></div></div>`;
    $('#add-friend').onsubmit = async (e) => {
      e.preventDefault();
      const inp = e.target.username;
      const msg = $('#af-msg');
      try {
        await api.post('/friends', { username: inp.value.trim() });
        msg.style.color = 'var(--green)';
        msg.textContent = `Başarılı! ${inp.value.trim()} kullanıcısına arkadaşlık isteği gönderildi.`;
        inp.value = '';
      } catch (err) { msg.style.color = 'var(--red)'; msg.textContent = err.message; }
    };
    setTimeout(() => $('#add-friend input')?.focus(), 20);
  } else {
    let list = [...S.friends.entries()].map(([id, type]) => ({ u: user(id), type })).filter((x) => x.u);
    if (tab === 'online') list = list.filter((x) => x.type === 'friend' && x.u.status !== 'offline');
    else if (tab === 'all') list = list.filter((x) => x.type === 'friend');
    else list = list.filter((x) => x.type !== 'friend');
    list.sort((a, b) => a.u.display_name.localeCompare(b.u.display_name, 'tr'));
    const title = { online: 'Çevrimiçi', all: 'Tüm Arkadaşlar', pending: 'Bekleyen' }[tab];
    page.innerHTML = list.length
      ? `<h4>${title} — ${list.length}</h4>` + list.map(({ u, type }) => `<div class="friend-row" data-action="open-dm" data-uid="${u.id}" data-ctx="user">
          ${avatar(u, 36, { status: true })}
          <div class="meta"><b>${esc(u.display_name)} <span class="muted" style="font-weight:400;font-size:13px">${esc(u.username)}</span></b>
          <small>${type === 'incoming' ? 'Gelen Arkadaşlık İsteği' : type === 'outgoing' ? 'Giden Arkadaşlık İsteği' : esc(u.custom_status || STATUS_LABEL[u.status])}</small></div>
          <div class="acts">${type === 'friend'
            ? `<button class="round-btn" data-action="open-dm" data-uid="${u.id}" title="Mesaj">${icon('message', 'sm')}</button><button class="round-btn" data-action="friend-menu" data-uid="${u.id}" title="Diğer">${icon('moreV', 'sm')}</button>`
            : `${type === 'incoming' ? `<button class="round-btn ok" data-action="friend-accept" data-uid="${u.id}" title="Kabul Et">${icon('check', 'sm')}</button>` : ''}<button class="round-btn no" data-action="friend-remove" data-uid="${u.id}" title="${type === 'incoming' ? 'Reddet' : 'İptal Et'}">${icon('x', 'sm')}</button>`}</div>
        </div>`).join('')
      : `<div class="empty"><div class="art">${tab === 'pending' ? '📭' : '🌙'}</div><p>${tab === 'pending' ? 'Bekleyen arkadaşlık isteği yok.' : tab === 'online' ? 'Şu anda çevrimiçi arkadaşın yok.' : 'Henüz arkadaşın yok. "Arkadaş Ekle" ile başla!'}</p></div>`;
  }
  const side = $('#home-side');
  const active = [...S.voice.values()].filter((v) => S.friends.get(v.user_id) === 'friend' && v.server_id && server(v.server_id));
  side.innerHTML = `<h3>Şu An Aktif</h3>` + (active.length
    ? active.map((v) => {
      const u = user(v.user_id);
      const ch = S.channels.get(v.channel_id);
      return `<div class="active-card"><div class="row">${avatar(u, 32, { status: true })}<div class="grow"><b>${esc(u.display_name)}</b><div class="muted" style="font-size:13px">🔊 ${esc(ch?.name)} — ${esc(server(v.server_id)?.name)}</div></div></div>
        <button class="btn secondary sm block" style="margin-top:10px" data-action="voice-join" data-cid="${v.channel_id}">Kanala Katıl</button></div>`;
    }).join('')
    : '<div class="active-card" style="text-align:center"><b>Şimdilik sessiz…</b><p class="muted" style="font-size:13px;margin:6px 0 0">Bir arkadaşın sesli sohbete katıldığında burada göreceksin.</p></div>');
}

async function openDm(uid) {
  const existing = dmList().find((c) => c.recipients.includes(uid) && c.recipients.length === 2);
  if (existing) return navigate('@me', existing.id);
  try {
    const ch = await api.post('/dms', { user_id: uid });
    addDm(ch);
    navigate('@me', ch.id);
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------- ses görünümü
function renderVoiceView(ch) {
  const el = $('#main');
  el.innerHTML = `<header class="main-header">${menuBtn}<div class="title">${icon('speaker')}<span>${esc(ch.name)}</span></div><div class="spacer"></div>
    <div class="tools"><button class="icon-btn" data-action="act-start" title="Etkinlik Başlat (oyun / birlikte izle)">🎮</button>
    ${can(ch.server_id, P.CREATE_INVITE) ? `<button class="icon-btn" data-action="invite" data-sid="${ch.server_id}" title="Davet Et">${icon('userPlus')}</button>` : ''}</div></header>
    <div id="activity-area" class="activity-area"></div>
    <div class="voice-view" id="stage" data-stage="${ch.id}"></div>`;
  renderStage();
}

function renderCallBanner() {
  const el = $('#call-banner');
  const ch = curChannel();
  if (!el || ch?.type !== 'dm') return;
  const vs = voiceIn(ch.id);
  if (!vs.length) { el.innerHTML = ''; return; }
  if (voice?.channelId === ch.id) {
    el.innerHTML = `<div class="voice-view" id="stage" data-stage="${ch.id}" style="max-height:52vh;min-height:280px"></div>`;
    renderStage();
  } else {
    const names = vs.map((v) => displayName(v.user_id)).join(', ');
    el.innerHTML = `<div class="call-banner"><div class="row">${vs.map((v) => avatar(user(v.user_id), 28)).join('')}</div>
      <div class="grow">${esc(names)} sesli aramada</div>
      <button class="btn green sm" data-action="voice-join" data-cid="${ch.id}">${icon('phone', 'sm')} Katıl</button></div>`;
  }
}

function renderStage() {
  const el = $('#stage');
  if (!el) return;
  const chId = el.dataset.stage;
  const ch = S.channels.get(chId);
  if (!ch) return;
  const vs = voiceIn(chId);
  const connected = voice?.channelId === chId;
  if (!connected) {
    el.innerHTML = `<div class="voice-join">
      <div style="font-size:54px">🔊</div><h2>${esc(ch.name || 'Sesli Arama')}</h2>
      <p style="color:#b4b6bd;margin:0">${vs.length ? `${vs.map((v) => esc(displayName(v.user_id, ch.server_id))).join(', ')} şu anda burada.` : 'Şu anda kimse sesli kanalda değil.'}</p>
      <button class="btn green" data-action="voice-join" data-cid="${chId}">Sese Katıl</button></div>`;
    return;
  }
  const focus = S.focusTile && vs.some((v) => v.user_id === S.focusTile) ? S.focusTile : null;
  const tiles = vs.filter((v) => !focus || v.user_id === focus).map((v) => {
    const u = user(v.user_id);
    const stream = voice.videoFor(v.user_id);
    const showVideo = (v.self_video || v.self_stream) && stream;
    const self = v.user_id === S.me.id;
    return `<div class="tile ${voice.speaking.has(v.user_id) ? 'speaking' : ''}" data-speak-uid="${v.user_id}" data-action="tile-focus" data-uid="${v.user_id}" data-ctx="user" data-sid="${ch.server_id || ''}">
      ${showVideo ? `<video autoplay playsinline muted data-video="${v.user_id}" class="${self && v.self_video ? 'mirror' : ''}"></video>` : avatar(u, 84)}
      ${v.self_stream ? '<span class="live">CANLI</span>' : ''}
      <div class="label">${v.server_mute || v.self_mute ? icon('micOff', 'xs') : ''}${v.self_deaf ? icon('headphonesOff', 'xs') : ''}<span>${esc(displayName(v.user_id, ch.server_id))}</span></div>
    </div>`;
  }).join('');
  const muted = voice.muted || voice.deafened;
  el.innerHTML = `<div class="voice-grid scroll ${focus ? 'focus' : ''}">${tiles}</div>
    <div class="voice-controls">
      <button class="vc-btn ${voice.videoKind === 'camera' ? 'on' : ''}" data-action="voice-camera" title="Kamera">${icon(voice.videoKind === 'camera' ? 'video' : 'videoOff')}</button>
      <button class="vc-btn ${voice.videoKind === 'screen' ? 'on' : ''}" data-action="voice-screen" title="Ekran Paylaş">${icon('screen')}</button>
      <button class="vc-btn ${muted ? 'off' : ''}" data-action="toggle-mute" title="Mikrofon">${icon(muted ? 'micOff' : 'mic')}</button>
      <button class="vc-btn ${voice.deafened ? 'off' : ''}" data-action="toggle-deafen" title="Ses">${icon(voice.deafened ? 'headphonesOff' : 'headphones')}</button>
      <button class="vc-btn ${voice.filter !== 'none' || voice.mode !== 'vad' ? 'on' : ''}" data-action="soundboard" title="Ses Efektleri ve Filtreler"><span style="font-size:22px">🔊</span></button>
      <button class="vc-btn ${clips.clipActive() ? 'off' : ''}" data-action="${clips.clipActive() ? 'clip-save' : 'clip-toggle'}" title="${clips.clipActive() ? 'Son 30 saniyeyi kaydet (Alt+C)' : 'Klip Modu'}"><span style="font-size:22px">🎬</span></button>
      <button class="vc-btn leave" data-action="voice-leave" title="Bağlantıyı Kes">${icon('phoneOff')}</button>
    </div>`;
  $$('video[data-video]', el).forEach((v) => {
    v.srcObject = voice.videoFor(v.dataset.video);
    v.play().catch(() => {});
    v.ondblclick = () => v.requestFullscreen?.();
  });
}

async function joinVoice(cid) {
  const ch = S.channels.get(cid);
  if (!ch) return;
  await voice.join(cid);
  if (voice.channelId === cid && ch.type === 'voice' && S.view.cid !== cid) navigate(ch.server_id, cid);
}

// ---------------------------------------------------------------- yan panel (arama, sabitler)
function showSidePanel(title, html) {
  const el = $('#side-panel');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<header><span>${title}</span><button class="icon-btn" data-action="close-panel">${icon('x')}</button></header><div class="list scroll">${html}</div>`;
}

function resultHTML(m) {
  const ch = S.channels.get(m.channel_id);
  upsertUser(m.author);
  return `<div class="msg" data-action="goto-msg" data-cid="${m.channel_id}" data-mid="${m.id}">
    <div class="msg-avatar">${avatar(m.author, 36)}</div><div class="msg-body">
    ${ch?.server_id ? `<div class="ch-name">#${esc(ch.name)}</div>` : ''}
    <div class="msg-head"><span class="msg-author">${esc(displayName(m.author.id, ch?.server_id))}</span><span class="msg-time">${fmtTime(m.created_at)}</span></div>
    <div class="msg-text">${markdown(m.content)}</div>${m.attachments.length ? `<small class="muted">📎 ${m.attachments.length} ek</small>` : ''}</div></div>`;
}

async function openSearch(q) {
  const ch = curChannel();
  S.panel = { type: 'search', cid: ch.id };
  showSidePanel('Aranıyor…', '<p class="muted" style="padding:16px">Aranıyor…</p>');
  try {
    const list = await api.get(`/search?q=${encodeURIComponent(q)}&${ch.server_id ? 'server_id=' + ch.server_id : 'channel_id=' + ch.id}`);
    showSidePanel(`${list.length} sonuç`, list.length ? list.map(resultHTML).join('') : '<div class="empty"><div class="art">🔍</div><p>Sonuç bulunamadı.</p></div>');
  } catch (e) { fail(e); }
}

async function openPins() {
  const ch = curChannel();
  if (!ch) return;
  S.panel = { type: 'pins', cid: ch.id };
  try {
    const list = await api.get(`/channels/${ch.id}/pins`);
    showSidePanel('Sabitlenmiş Mesajlar', list.length ? list.map(resultHTML).join('') : '<div class="empty"><div class="art">📌</div><p>Bu kanalda henüz sabitlenmiş mesaj yok.</p></div>');
  } catch (e) { fail(e); }
}

// ======================================================================= profil
function showProfile(uid, anchor, sid = S.view.sid !== '@me' ? S.view.sid : null) {
  closeFloating();
  const u = user(uid);
  if (!u) return;
  const roles = sid ? memberRoles(sid, uid) : [];
  const m = sid && member(sid, uid);
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = `<div class="profile-banner" style="background:${esc(u.banner_color || colorFor(u.id))}"></div>
    <div class="profile-head">${avatar(u, 80, { status: true })}
      ${uid !== S.me.id ? `<div class="row" style="margin-bottom:8px">${S.friends.get(uid) === 'friend' || u.is_bot ? '' : `<button class="btn sm green" data-pa="friend">${icon('userPlus', 'sm')}</button>`}</div>` : `<button class="btn sm secondary" data-pa="edit" style="margin-bottom:8px">Profili Düzenle</button>`}</div>
    <div class="profile-card">
      <h3><span class="${glowCls(uid, sid)}">${esc(displayName(uid, sid))}</span>${u.is_bot ? '<span class="bot-tag">BOT</span>' : ''}${nameExtras(uid, sid)}</h3>
      <div class="uname">${esc(u.username)}${m?.nickname ? ` • ${esc(u.display_name)}` : ''}</div>
      ${presenceCard(u)}
      <hr>
      ${u.about ? `<h5>Hakkımda</h5><p>${markdown(u.about)}</p>` : ''}
      ${m && server(sid)?.economy && !u.is_bot ? `<h5>Seviye</h5><p>⭐ Seviye ${m.level || 0} • 🪙 ${Number(m.coins || 0).toLocaleString('tr-TR')} coin</p>` : ''}
      <h5>Biscord Üyeliği</h5><p>${fmtDay(u.created_at)}${m ? ` • Sunucuya katılım: ${fmtDay(m.joined_at)}` : ''}</p>
      ${sid && m ? `<h5>Roller</h5><div class="role-chips">${roles.map((r) => `<span class="role-chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`).join('') || '<span class="muted" style="font-size:13px">Rol yok</span>'}
        ${can(sid, P.MANAGE_ROLES) && (uid === S.me.id || outranks(sid, uid)) ? `<button class="role-chip" data-pa="roles" title="Rolleri düzenle">${icon('plus', 'xs')}</button>` : ''}</div>` : ''}
      ${uid !== S.me.id ? `<input class="input" style="margin-top:14px" placeholder="@${esc(u.username)} kullanıcısına mesaj gönder" data-pa-msg>` : ''}
    </div>`;
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-pa]')?.dataset.pa;
    if (a === 'friend') { try { await api.post('/friends', { user_id: uid }); toast('Arkadaşlık isteği gönderildi', 'ok'); closeFloating(); } catch (err) { fail(err); } }
    if (a === 'edit') { closeFloating(); openUserSettings('profile'); }
    if (a === 'roles') { closeFloating(); memberRolesModal(sid, uid); }
  });
  el.querySelector('[data-pa-msg]')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const text = e.target.value;
    closeFloating();
    try {
      const ch = await api.post('/dms', { user_id: uid });
      addDm(ch);
      await api.post(`/channels/${ch.id}/messages`, { content: text });
      navigate('@me', ch.id);
    } catch (err) { fail(err); }
  });
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    const right = r.right + 320 + 16 < innerWidth;
    place(el, right ? r.right + 10 : r.left - 330, r.top);
  } else place(el, anchor?.x ?? innerWidth / 2 - 160, anchor?.y ?? 80);
  api.get('/users/' + uid).then((full) => { upsertUser(full); }).catch(() => {});
}

// ======================================================================= menüler
function serverMenu(anchor) {
  const s = server(S.view.sid);
  if (!s) return;
  const owner = s.owner_id === S.me.id;
  const settingsAccess = can(s.id, P.MANAGE_SERVER) || can(s.id, P.MANAGE_ROLES) || can(s.id, P.KICK_MEMBERS) || can(s.id, P.BAN_MEMBERS);
  menuAt(anchor, [
    can(s.id, P.CREATE_INVITE) && { label: 'İnsanları Davet Et', icon: 'userPlus', action: () => inviteModal(s.id) },
    settingsAccess && { label: 'Sunucu Ayarları', icon: 'gear', action: () => openServerSettings(s.id) },
    can(s.id, P.MANAGE_CHANNELS) && { label: 'Kanal Oluştur', icon: 'plusCircle', action: () => createChannelModal(s.id) },
    can(s.id, P.MANAGE_CHANNELS) && { label: 'Kategori Oluştur', icon: 'plus', action: () => createChannelModal(s.id, null, 'category') },
    can(s.id, P.MANAGE_CHANNELS) && { label: 'Hayalet Kanal Oluştur', icon: 'shield', action: () => createChannelModal(s.id, null, 'ghost') },
    '-',
    s.economy && { label: 'Coin, Seviye ve Mağaza', icon: 'crown', action: () => shopModal(s.id) },
    { label: 'Hayalet Kanala Gir…', icon: 'shield', action: () => unlockGhost(s.id) },
    '-',
    { label: 'Takma Adı Değiştir', icon: 'edit', action: () => changeNick(s.id, S.me.id) },
    { label: 'Tümünü Okundu İşaretle', icon: 'check', action: () => markServerRead(s.id) },
    { label: 'Sunucu Kimliğini Kopyala', icon: 'copy', action: () => copy(s.id) },
    !owner && '-',
    !owner && { label: 'Sunucudan Ayrıl', danger: true, icon: 'logout', action: () => leaveServer(s.id) },
  ]);
}

function markServerRead(sid) {
  for (const c of serverChannels(sid)) if (isUnread(c) || S.mentions.get(c.id)) ackSoon(c.id);
}

async function leaveServer(sid) {
  const s = server(sid);
  if (!(await confirmDialog(`'${esc(s.name)}' sunucusundan ayrıl`, `<b>${esc(s.name)}</b> sunucusundan ayrılmak istediğine emin misin? Tekrar davet edilmedikçe geri katılamayacaksın.`, 'Sunucudan Ayrıl'))) return;
  try { await api.del(`/servers/${sid}/members/@me`); } catch (e) { fail(e); }
}

async function changeNick(sid, uid, preset) {
  const m = member(sid, uid);
  const v = preset !== undefined ? preset : await promptDialog('Takma Adı Değiştir', 'Takma Ad', m?.nickname || '', { sub: 'Boş bırakırsan takma ad sıfırlanır.', max: 32 });
  if (v === null || v === undefined) return;
  try { await api.patch(`/servers/${sid}/members/${uid}`, { nickname: v }); toast('Takma ad güncellendi', 'ok'); } catch (e) { fail(e); }
}

function userMenu(x, y, uid, sid) {
  const u = user(uid);
  if (!u) return;
  const me = uid === S.me.id;
  const fr = S.friends.get(uid);
  const s = sid && server(sid);
  const inSrv = s && member(sid, uid);
  const v = S.voice.get(uid);
  const sameVoice = !me && v && voice?.channelId === v.channel_id;
  const items = [
    { label: 'Profil', icon: 'users', action: () => showProfile(uid, { x, y }, sid) },
    !me && { label: 'Mesaj Gönder', icon: 'message', action: () => openDm(uid) },
    !me && !u.is_bot && !fr && { label: 'Arkadaş Ekle', icon: 'userPlus', action: () => api.post('/friends', { user_id: uid }).then(() => toast('İstek gönderildi', 'ok'), fail) },
    !me && fr === 'incoming' && { label: 'İsteği Kabul Et', icon: 'check', action: () => api.put('/friends/' + uid).catch(fail) },
    !me && fr === 'friend' && { label: 'Arkadaşlıktan Çıkar', danger: true, action: () => removeFriend(uid) },
  ];
  if (sameVoice) {
    const vol = voice.volumes[uid] ?? 100;
    items.push('-', { html: `<div class="range">Kullanıcı Ses Seviyesi: <b data-vol-label>${vol}%</b><input type="range" min="0" max="100" value="${vol}" data-vol></div>`, mount: (el) => {
      const r = el.querySelector('[data-vol]');
      r.oninput = () => { voice.setVolume(uid, +r.value); el.querySelector('[data-vol-label]').textContent = r.value + '%'; };
    } });
  }
  if (inSrv) {
    items.push('-');
    if (me ? can(sid, P.CHANGE_NICKNAME) : can(sid, P.MANAGE_ROLES) && outranks(sid, uid)) items.push({ label: 'Takma Adı Değiştir', icon: 'edit', action: () => changeNick(sid, uid) });
    if (can(sid, P.MANAGE_ROLES) && (me || outranks(sid, uid))) items.push({ label: 'Roller', icon: 'shield', action: () => memberRolesModal(sid, uid) });
    if (v?.server_id === sid && !me) {
      if (can(sid, P.MUTE_MEMBERS)) items.push({ label: v.server_mute ? 'Sunucu Susturmasını Kaldır' : 'Sunucuda Sustur', icon: 'micOff', action: () => socket.emit('voice:moderate', { user_id: uid, action: 'mute', value: !v.server_mute }, (r) => r?.ok === false && fail(r.error)) });
      if (can(sid, P.MOVE_MEMBERS)) items.push({ label: 'Sesten Bağlantısını Kes', icon: 'phoneOff', danger: true, action: () => socket.emit('voice:moderate', { user_id: uid, action: 'disconnect' }, (r) => r?.ok === false && fail(r.error)) });
    }
    if (!me && outranks(sid, uid)) {
      if (can(sid, P.KICK_MEMBERS)) items.push({ label: `${displayName(uid, sid)} kullanıcısını at`, danger: true, action: () => kickMember(sid, uid) });
      if (can(sid, P.BAN_MEMBERS)) items.push({ label: `${displayName(uid, sid)} kullanıcısını yasakla`, danger: true, action: () => banMember(sid, uid) });
    }
  }
  items.push('-', { label: 'Kullanıcı Kimliğini Kopyala', icon: 'copy', action: () => copy(uid) });
  menu(x, y, items);
}

async function removeFriend(uid) {
  if (!(await confirmDialog(`'${esc(displayName(uid))}' kullanıcısını çıkar`, 'Bu kişiyi arkadaşlarından çıkarmak istediğine emin misin?', 'Arkadaşı Çıkar'))) return;
  api.del('/friends/' + uid).catch(fail);
}

async function kickMember(sid, uid) {
  if (!(await confirmDialog(`'${esc(displayName(uid, sid))}' kullanıcısını at`, 'Bu kullanıcıyı sunucudan atmak istediğine emin misin? Yeni bir davetle geri katılabilir.', 'At'))) return;
  api.del(`/servers/${sid}/members/${uid}`).then(() => toast('Üye atıldı', 'ok'), fail);
}

function banMember(sid, uid) {
  modal({
    title: `'${esc(displayName(uid, sid))}' kullanıcısını yasakla`,
    body: `<label class="field"><span>Yasaklama Sebebi</span><input class="input" id="ban-reason" maxlength="512"></label>
      <label class="check"><input type="checkbox" id="ban-del"><div><b>Son 7 günün mesajlarını sil</b></div></label>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn red" data-ok>Yasakla</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = () => {
        api.put(`/servers/${sid}/bans/${uid}`, { reason: m.querySelector('#ban-reason').value, delete_messages: m.querySelector('#ban-del').checked })
          .then(() => { toast('Kullanıcı yasaklandı', 'ok'); close(); }, fail);
      };
    },
  });
}

function messageMenu(x, y, mid) {
  const m = findMsg(mid);
  const ch = curChannel();
  if (!m || !ch) return;
  const mine = m.author.id === S.me.id;
  const manage = !ch.server_id || can(ch.server_id, P.MANAGE_MESSAGES);
  menu(x, y, [
    { label: 'Tepki Ekle', icon: 'smilePlus', action: () => { const el = $(`[data-mid="${mid}"]`); el && emojiPicker(el.querySelector('.msg-actions') || el, (e) => toggleReaction(mid, e)); } },
    { label: 'Yanıtla', icon: 'reply', action: () => startReply(mid) },
    mine && m.type === 0 && { label: 'Mesajı Düzenle', icon: 'edit', action: () => startEdit(mid) },
    manage && { label: m.pinned ? 'Sabitlemeyi Kaldır' : 'Mesajı Sabitle', icon: 'pin', action: () => api.put(`/messages/${mid}/pin`, { pinned: !m.pinned }).then(() => toast(m.pinned ? 'Sabitleme kaldırıldı' : 'Mesaj sabitlendi', 'ok'), fail) },
    m.content && { label: 'Metni Kopyala', icon: 'copy', action: () => copy(m.content) },
    { label: 'Okunmadı Olarak İşaretle', icon: 'bell', action: () => { const st = S.messages.get(ch.id); const i = st.list.findIndex((x) => x.id === mid); S.read.set(ch.id, st.list[i - 1]?.id || null); api.post(`/channels/${ch.id}/ack`, { message_id: st.list[i - 1]?.id || '0' }).catch(() => {}); renderSidebar(); renderGuilds(); } },
    '-',
    { label: 'Mesaj Kimliğini Kopyala', icon: 'copy', action: () => copy(mid) },
    (mine || manage) && { label: 'Mesajı Sil', danger: true, icon: 'trash', action: () => deleteMsg(mid) },
  ]);
}

function startReply(mid) {
  S.reply = mid;
  renderComposerExtra();
  $('#input')?.focus();
}

function channelMenu(x, y, cid) {
  const c = S.channels.get(cid);
  if (!c) return;
  const manage = can(c.server_id, P.MANAGE_CHANNELS);
  menu(x, y, [
    c.type !== 'category' && c.type !== 'voice' && { label: 'Okundu Olarak İşaretle', icon: 'check', action: () => ackSoon(cid) },
    c.type === 'voice' && { label: 'Sese Katıl', icon: 'speaker', action: () => joinVoice(cid) },
    can(c.server_id, P.CREATE_INVITE) && { label: 'İnsanları Davet Et', icon: 'userPlus', action: () => inviteModal(c.server_id) },
    manage && c.type === 'category' && { label: 'Kanal Oluştur', icon: 'plus', action: () => createChannelModal(c.server_id, c.id) },
    manage && { label: c.type === 'category' ? 'Kategoriyi Düzenle' : 'Kanalı Düzenle', icon: 'gear', action: () => channelSettingsModal(cid) },
    manage && { label: c.type === 'category' ? 'Kategoriyi Sil' : 'Kanalı Sil', danger: true, icon: 'trash', action: () => deleteChannel(cid) },
    '-',
    { label: 'Kanal Kimliğini Kopyala', icon: 'copy', action: () => copy(cid) },
  ]);
}

async function deleteChannel(cid) {
  const c = S.channels.get(cid);
  if (!(await confirmDialog(c.type === 'category' ? 'Kategoriyi Sil' : 'Kanalı Sil', `<b>${esc(c.name)}</b> silinsin mi? Bu işlem geri alınamaz.`, 'Sil'))) return;
  api.del('/channels/' + cid).then(() => toast('Silindi', 'ok'), fail);
}

function statusMenu(anchor) {
  const st = S.me.status_setting;
  const set = (s) => api.patch('/users/@me', { status: s }).then((u) => H.ME_UPDATE(u), fail);
  const dot = (s) => `<span class="status-chip dot ${s === 'invisible' ? 'offline' : s}"></span>`;
  const item = (s) => ({ html: `<button data-st="${s}" style="${st === s ? 'background:var(--bg-active)' : ''}"><span class="row">${dot(s)} ${STATUS_LABEL[s]}</span></button>` });
  const el = menuAt(anchor, [
    item('online'), item('idle'), item('dnd'), item('invisible'), '-',
    { label: S.me.presence ? 'Durumunu Düzenle' : 'Durumunu Tasarla ✨', icon: 'smile', action: () => presenceEditor() },
    { label: 'Profil', icon: 'users', action: () => showProfile(S.me.id, anchor) },
    S.me.is_admin && { label: 'Yönetim Paneli', icon: 'shield', action: () => openAdminPanel() },
    { label: 'Kullanıcı Kimliğini Kopyala', icon: 'copy', action: () => copy(S.me.id) },
  ], { above: true });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { closeFloating(); set(b.dataset.st); } });
  const r = anchor.getBoundingClientRect();
  el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + 'px';
}

// ======================================================================= modallar
function createServerModal() {
  const { el, close } = modal({
    title: 'Sunucunu oluştur', center: true,
    sub: 'Sunucun, sen ve arkadaşlarının takıldığı yerdir. Kendi sunucunu oluştur ve konuşmaya başla.',
    body: `<button class="choice" data-c="create"><span class="ico">${icon('plus')}</span><div>Kendi Sunucumu Oluştur<small>Arkadaşların ve topluluğun için</small></div></button>
      <h4 style="text-align:center;margin:18px 0 8px">Zaten bir davetin var mı?</h4>
      <button class="choice" data-c="join"><span class="ico">${icon('compass')}</span><div>Bir Sunucuya Katıl<small>Davet bağlantısı veya kodu ile</small></div></button>`,
  });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    close();
    c === 'create' ? createServerForm() : joinServerForm();
  });
}

function createServerForm() {
  let iconFile = null;
  modal({
    title: 'Sunucunu özelleştir', center: true,
    sub: 'Yeni sunucuna bir ad ve simge vererek ona kişilik kazandır. Bunları daha sonra değiştirebilirsin.',
    body: `<label class="upload-circle" id="icon-pick">${icon('plus')}<br>YÜKLE<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>
      <label class="field"><span>Sunucu Adı</span><input class="input" id="srv-name" maxlength="100" value="${esc(S.me.display_name)} sunucusu"></label>
      <div class="form-error" id="srv-err"></div>`,
    foot: '<button class="btn ghost" data-close>Geri</button><button class="btn" data-ok>Oluştur</button>',
    onMount(m, close) {
      const pick = m.querySelector('#icon-pick');
      pick.querySelector('input').onchange = (e) => {
        iconFile = e.target.files[0];
        if (iconFile) { pick.style.backgroundImage = `url(${URL.createObjectURL(iconFile)})`; pick.innerHTML = ''; pick.append(e.target); }
      };
      const go = async () => {
        const btn = m.querySelector('[data-ok]');
        btn.disabled = true;
        try {
          const s = await api.post('/servers', { name: m.querySelector('#srv-name').value });
          if (!server(s.id)) addServer(s);
          if (iconFile) { const fd = new FormData(); fd.append('file', iconFile); await api.post(`/servers/${s.id}/icon`, fd).catch(fail); }
          close();
          navigate(s.id);
        } catch (e) { m.querySelector('#srv-err').textContent = e.message; btn.disabled = false; }
      };
      m.querySelector('[data-ok]').onclick = go;
      m.querySelector('#srv-name').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    },
  });
}

function parseInvite(v) {
  const m = String(v).trim().match(/(?:invite\/)?([A-Za-z0-9]{4,})\/?$/);
  return m ? m[1] : null;
}

function joinServerForm() {
  modal({
    title: 'Bir sunucuya katıl', center: true,
    sub: 'Var olan bir sunucuya katılmak için aşağıya bir davet gir.',
    body: `<label class="field"><span>Davet Bağlantısı <i class="req">*</i></span><input class="input" id="inv" placeholder="${esc(location.origin)}/invite/aBcD2345"></label>
      <small class="muted">Davetler şöyle görünür: <b>aBcD2345</b> veya <b>${esc(location.origin)}/invite/aBcD2345</b></small><div class="form-error" id="inv-err" style="margin-top:10px"></div>`,
    foot: '<button class="btn ghost" data-close>Geri</button><button class="btn" data-ok>Sunucuya Katıl</button>',
    onMount(m, close) {
      const go = async () => {
        const code = parseInvite(m.querySelector('#inv').value);
        if (!code) { m.querySelector('#inv-err').textContent = 'Lütfen geçerli bir davet bağlantısı veya kodu gir.'; return; }
        try {
          const s = await api.post('/invites/' + code);
          if (!server(s.id)) addServer(s);
          close();
          navigate(s.id);
        } catch (e) { m.querySelector('#inv-err').textContent = e.message; }
      };
      m.querySelector('[data-ok]').onclick = go;
      m.querySelector('#inv').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    },
  });
}

async function acceptInviteModal(code) {
  let inv;
  try { inv = await api.get('/invites/' + code); } catch (e) { return fail(e); }
  if (server(inv.server.id)) return navigate(inv.server.id);
  modal({
    title: esc(inv.server.name), center: true,
    sub: `<b>${esc(inv.inviter?.display_name || 'Biri')}</b> seni bu sunucuya davet etti<br><span class="row" style="justify-content:center;gap:14px;margin-top:8px"><span><span class="status-chip dot online"></span> ${inv.online_count} Çevrimiçi</span><span><span class="status-chip dot offline"></span> ${inv.member_count} Üye</span></span>`,
    body: `<div style="display:grid;place-items:center;margin-bottom:12px"><div class="guild-btn" style="width:80px;height:80px;border-radius:24px;background:var(--brand);color:#fff">${serverIcon(inv.server)}</div></div>`,
    foot: '<button class="btn ghost" data-close>Vazgeç</button><button class="btn" data-ok>Davete Katıl</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        try { const s = await api.post('/invites/' + code); if (!server(s.id)) addServer(s); close(); navigate(s.id); } catch (e) { fail(e); }
      };
    },
  });
}

function inviteModal(sid) {
  const s = server(sid);
  let age = 7 * 86400;
  let uses = 0;
  modal({
    title: `Arkadaşlarını ${esc(s.name)} sunucusuna davet et`,
    body: `<label class="field"><span>Veya bir arkadaşına sunucu davet bağlantısı gönder</span>
      <div class="invite-box"><input id="inv-link" readonly value="Oluşturuluyor…"><button class="btn sm" id="inv-copy">Kopyala</button></div></label>
      <div class="row wrap">
        <label class="field grow"><span>Süre Sonu</span><select class="input" id="inv-age">
          <option value="1800">30 dakika</option><option value="3600">1 saat</option><option value="21600">6 saat</option><option value="43200">12 saat</option>
          <option value="86400">1 gün</option><option value="604800" selected>7 gün</option><option value="0">Asla</option></select></label>
        <label class="field grow"><span>Maksimum Kullanım</span><select class="input" id="inv-uses">
          <option value="0">Sınırsız</option><option value="1">1 kullanım</option><option value="5">5 kullanım</option><option value="10">10 kullanım</option><option value="25">25 kullanım</option><option value="100">100 kullanım</option></select></label>
      </div>
      ${friendsForInvite(sid)}`,
    onMount(m) {
      const link = m.querySelector('#inv-link');
      const make = async () => {
        link.value = 'Oluşturuluyor…';
        try {
          const inv = await api.post(`/servers/${sid}/invites`, { max_age: age, max_uses: uses });
          link.value = `${location.origin}/invite/${inv.code}`;
        } catch (e) { link.value = ''; fail(e); }
      };
      m.querySelector('#inv-copy').onclick = () => { if (link.value.startsWith('http')) { copy(link.value, 'Davet bağlantısı kopyalandı'); m.querySelector('#inv-copy').textContent = 'Kopyalandı'; } };
      m.querySelector('#inv-age').onchange = (e) => { age = +e.target.value; make(); };
      m.querySelector('#inv-uses').onchange = (e) => { uses = +e.target.value; make(); };
      m.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-invite-dm]');
        if (!b || !link.value.startsWith('http')) return;
        b.disabled = true;
        try {
          const ch = await api.post('/dms', { user_id: b.dataset.inviteDm });
          addDm(ch);
          await api.post(`/channels/${ch.id}/messages`, { content: link.value });
          b.textContent = 'Gönderildi';
        } catch (err) { fail(err); b.disabled = false; }
      });
      make();
    },
  });
}

function friendsForInvite(sid) {
  const s = server(sid);
  const fr = [...S.friends.entries()].filter(([id, t]) => t === 'friend' && !s.members.has(id)).map(([id]) => user(id)).filter(Boolean);
  if (!fr.length) return '';
  return `<h4 style="margin:4px 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-3)">Arkadaşlar</h4>` + fr.slice(0, 20).map((u) => `<div class="table-row">${avatar(u, 32)}<div class="meta"><b>${esc(u.display_name)}</b><small>${esc(u.username)}</small></div><button class="btn sm secondary" data-invite-dm="${u.id}">Davet Et</button></div>`).join('');
}

function createChannelModal(sid, parentId = null, type = 'text') {
  const isCat = type === 'category';
  modal({
    title: isCat ? 'Kategori Oluştur' : 'Kanal Oluştur',
    sub: !isCat && parentId ? `${esc(S.channels.get(parentId)?.name || '')} kategorisinde` : '',
    body: `${isCat ? '' : `<div class="field"><span>Kanal Türü</span>
        <label class="radio-card">${icon('hash')}<div class="grow"><b>Metin</b><small>Mesaj, resim, GIF, emoji, fikir ve şaka gönder</small></div><input type="radio" name="ct" value="text" checked></label>
        <label class="radio-card">${icon('speaker')}<div class="grow"><b>Ses</b><small>Sesli, görüntülü ve ekran paylaşımıyla takılın</small></div><input type="radio" name="ct" value="voice"></label>
        <label class="radio-card"><span style="font-size:20px">👻</span><div class="grow"><b>Hayalet</b><small>Listede görünmez, şifreyle açılır, mesajlar hiçbir yere kaydedilmez</small></div><input type="radio" name="ct" value="ghost" ${type === 'ghost' ? 'checked' : ''}></label></div>`}
      <label class="field"><span>${isCat ? 'Kategori Adı' : 'Kanal Adı'}</span><input class="input" id="ch-name" maxlength="100" placeholder="${isCat ? 'Yeni Kategori' : 'yeni-kanal'}"></label>
      <label class="field ${type === 'ghost' ? '' : 'hidden'}" id="ch-pw-f"><span>Gizli Şifre</span><input class="input" id="ch-pw" type="password" maxlength="64" placeholder="En az 4 karakter"><small>Üyeler bu kanala <b>/ghost şifre</b> yazarak girer. Şifreyi yalnızca istediğin kişilere söyle.</small></label>
      <div class="form-error" id="ch-err"></div>`,
    foot: `<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>${isCat ? 'Kategori Oluştur' : 'Kanal Oluştur'}</button>`,
    onMount(m, close) {
      m.querySelectorAll('[name=ct]').forEach((r) => r.onchange = () => m.querySelector('#ch-pw-f').classList.toggle('hidden', r.value !== 'ghost' || !r.checked));
      if (type === 'ghost') { const r = m.querySelector('[name=ct][value=text]'); if (r) r.checked = false; }
      const go = async () => {
        const t = isCat ? 'category' : m.querySelector('[name=ct]:checked').value;
        try {
          const c = await api.post(`/servers/${sid}/channels`, { name: m.querySelector('#ch-name').value, type: t, parent_id: parentId, password: m.querySelector('#ch-pw')?.value });
          S.channels.set(c.id, c);
          close();
          if (t === 'text' || t === 'ghost') navigate(sid, c.id); else renderSidebar();
        } catch (e) { m.querySelector('#ch-err').textContent = e.message; }
      };
      m.querySelector('[data-ok]').onclick = go;
      m.querySelector('#ch-name').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    },
  });
}

function channelSettingsModal(cid) {
  const c = S.channels.get(cid);
  if (!c) return;
  const cats = serverChannels(c.server_id).filter((x) => x.type === 'category');
  modal({
    title: c.type === 'category' ? 'Kategoriyi Düzenle' : 'Kanalı Düzenle',
    body: `<label class="field"><span>Ad</span><input class="input" id="cs-name" maxlength="100" value="${esc(c.name)}"></label>
      ${c.type === 'text' ? `<label class="field"><span>Kanal Konusu</span><textarea class="textarea" id="cs-topic" maxlength="1024" placeholder="Herkese bu kanalı nasıl kullanacaklarını anlat!">${esc(c.topic || '')}</textarea></label>` : ''}
      ${c.type !== 'category' ? `<label class="field"><span>Kategori</span><select class="input" id="cs-parent"><option value="">Kategori yok</option>${cats.map((x) => `<option value="${x.id}" ${x.id === c.parent_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Sıra</span><input class="input" type="number" id="cs-pos" value="${c.position}"><small>Küçük sayılar listede üstte görünür.</small></label>`,
    foot: `<button class="btn red" data-del style="margin-right:auto">Sil</button><button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Değişiklikleri Kaydet</button>`,
    onMount(m, close) {
      m.querySelector('[data-del]').onclick = () => { close(); deleteChannel(cid); };
      m.querySelector('[data-ok]').onclick = async () => {
        const body = { name: m.querySelector('#cs-name').value, position: +m.querySelector('#cs-pos').value };
        if (m.querySelector('#cs-topic')) body.topic = m.querySelector('#cs-topic').value;
        if (m.querySelector('#cs-parent')) body.parent_id = m.querySelector('#cs-parent').value || null;
        try { await api.patch('/channels/' + cid, body); close(); toast('Kaydedildi', 'ok'); } catch (e) { fail(e); }
      };
    },
  });
}

function memberRolesModal(sid, uid) {
  const s = server(sid);
  const m = member(sid, uid);
  if (!s || !m) return;
  const myTop = topPos(sid, S.me.id);
  const roles = [...s.roles.values()].filter((r) => r.id !== s.id).sort((a, b) => b.position - a.position);
  modal({
    title: `Roller — ${esc(displayName(uid, sid))}`,
    body: roles.length ? roles.map((r) => `<label class="check"><input type="checkbox" value="${r.id}" ${m.roles.includes(r.id) ? 'checked' : ''} ${r.position >= myTop ? 'disabled' : ''}>
      <div><b style="color:${esc(r.color || 'inherit')}">${esc(r.name)}</b>${r.position >= myTop ? '<small>Bu rol senin en yüksek rolünden yüksek ya da eşit</small>' : ''}</div></label>`).join('')
      : '<p class="muted">Bu sunucuda henüz rol yok. Sunucu Ayarları → Roller bölümünden oluşturabilirsin.</p>',
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Kaydet</button>',
    onMount(el, close) {
      el.querySelector('[data-ok]').onclick = async () => {
        const ids = $$('input[type=checkbox]:checked', el).map((i) => i.value);
        try { await api.patch(`/servers/${sid}/members/${uid}`, { roles: ids }); close(); toast('Roller güncellendi', 'ok'); } catch (e) { fail(e); }
      };
    },
  });
}

function newDmModal() {
  const friends = [...S.friends.entries()].filter(([, t]) => t === 'friend').map(([id]) => user(id)).filter(Boolean);
  modal({
    title: 'Arkadaş Seç',
    sub: 'Mesajlaşmak istediğin arkadaşını seç.',
    body: `<input class="input" id="dm-q" placeholder="Arkadaşının kullanıcı adını yaz" style="margin-bottom:10px"><div id="dm-list"></div>`,
    onMount(m, close) {
      const draw = (q = '') => {
        const f = q.toLocaleLowerCase('tr');
        const list = friends.filter((u) => !f || u.username.includes(f) || u.display_name.toLocaleLowerCase('tr').includes(f));
        m.querySelector('#dm-list').innerHTML = list.length ? list.map((u) => `<div class="table-row" style="cursor:pointer" data-pick="${u.id}">${avatar(u, 32, { status: true })}<div class="meta"><b>${esc(u.display_name)}</b><small>${esc(u.username)}</small></div></div>`).join('')
          : `<p class="muted">${friends.length ? 'Eşleşen arkadaş yok.' : 'Henüz arkadaşın yok. Önce arkadaş ekle!'}</p>`;
      };
      draw();
      m.querySelector('#dm-q').oninput = (e) => draw(e.target.value);
      m.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (p) { close(); openDm(p.dataset.pick); } });
    },
  });
}

function quickSwitcher() {
  const items = [];
  for (const c of dmList()) items.push({ label: displayName(dmOther(c)?.id), sub: 'Direkt Mesaj', go: () => navigate('@me', c.id), html: avatar(dmOther(c), 24) });
  for (const s of S.servers.values()) {
    for (const c of serverChannels(s.id)) {
      if (c.type === 'category') continue;
      items.push({ label: c.name, sub: s.name, go: () => (c.type === 'voice' ? joinVoice(c.id) : navigate(s.id, c.id)), html: icon(c.type === 'voice' ? 'speaker' : 'hash', 'sm') });
    }
  }
  for (const [id, t] of S.friends) if (t === 'friend' && user(id)) items.push({ label: user(id).display_name, sub: '@' + user(id).username, go: () => openDm(id), html: avatar(user(id), 24) });
  modal({
    title: 'Hızlı Geçiş',
    sub: 'Kanal, sunucu ya da arkadaş ara. (Kısayol: Ctrl+K)',
    body: '<input class="input" id="qs" placeholder="Nereye gitmek istersin?" autocomplete="off"><div id="qs-list" style="margin-top:10px;max-height:340px;overflow:auto"></div>',
    onMount(m, close) {
      let sel = 0;
      let list = [];
      const draw = (q = '') => {
        const f = q.toLocaleLowerCase('tr');
        list = items.filter((i) => !f || i.label.toLocaleLowerCase('tr').includes(f) || i.sub.toLocaleLowerCase('tr').includes(f)).slice(0, 30);
        sel = Math.min(sel, Math.max(0, list.length - 1));
        m.querySelector('#qs-list').innerHTML = list.map((i, n) => `<div class="ac-item ${n === sel ? 'sel' : ''}" data-n="${n}">${i.html}<b>${esc(i.label)}</b><small>${esc(i.sub)}</small></div>`).join('') || '<p class="muted">Sonuç yok</p>';
      };
      draw();
      const inp = m.querySelector('#qs');
      inp.oninput = () => { sel = 0; draw(inp.value); };
      inp.onkeydown = (e) => {
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, list.length - 1); draw(inp.value); e.preventDefault(); }
        if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(inp.value); e.preventDefault(); }
        if (e.key === 'Enter' && list[sel]) { close(); list[sel].go(); }
      };
      m.addEventListener('click', (e) => { const d = e.target.closest('[data-n]'); if (d) { close(); list[+d.dataset.n].go(); } });
    },
  });
}

// ======================================================================= tam ekran ayarlar
function openSettingsShell({ sections, render, initial }) {
  const el = document.createElement('div');
  el.className = 'settings';
  const items = sections.flatMap((s) => s.items);
  el.innerHTML = `<div class="settings-nav scroll"><nav>${sections.map((s) => `${s.label ? `<h5>${esc(s.label)}</h5>` : '<hr>'}${s.items.map((i) => `<button data-page="${i.id}" class="${i.danger ? 'danger' : ''}">${esc(i.label)}</button>`).join('')}`).join('')}</nav></div>
    <div class="settings-content scroll"><div class="inner" id="settings-page"></div><div class="settings-close"><button data-close-settings aria-label="Kapat">${icon('x')}</button><small>ESC</small></div></div>`;
  layers.appendChild(el);
  let page = el.querySelector('#settings-page');
  let cur = initial;
  const close = () => el.remove();
  const show = (id) => {
    cur = id;
    $$('[data-page]', el).forEach((b) => b.classList.toggle('active', b.dataset.page === id));
    const fresh = page.cloneNode(false); // eski sayfanın dinleyicilerini bırak
    page.replaceWith(fresh);
    page = fresh;
    render(id, page, ctl);
  };
  const ctl = { close, refresh: () => show(cur), show };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) {
      const it = items.find((i) => i.id === b.dataset.page);
      if (it.action) it.action(ctl); else show(it.id);
    }
    if (e.target.closest('[data-close-settings]')) close();
  });
  show(initial);
  return ctl;
}

function uploadImage(url, after) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/png,image/jpeg,image/gif,image/webp';
  inp.onchange = async () => {
    if (!inp.files[0]) return;
    const fd = new FormData();
    fd.append('file', inp.files[0]);
    try { const r = await api.post(url, fd); after?.(r); toast('Resim güncellendi', 'ok'); } catch (e) { fail(e); }
  };
  inp.click();
}

function openUserSettings(initial = 'account') {
  openSettingsShell({
    initial,
    sections: [
      { label: 'Kullanıcı Ayarları', items: [{ id: 'account', label: 'Hesabım' }, { id: 'profile', label: 'Profiller' }, { id: 'security', label: 'Gizlilik ve Güvenlik' }] },
      { label: 'Uygulama Ayarları', items: [{ id: 'voice', label: 'Ses ve Görüntü' }, { id: 'appearance', label: 'Görünüm ve Tema' }, { id: 'notifications', label: 'Bildirimler' }, { id: 'install', label: 'Uygulamayı İndir' }] },
      { label: 'Geliştirici', items: [{ id: 'bots', label: 'Botlarım' }] },
      ...(S.me.is_admin ? [{ label: 'Site', items: [{ id: 'admin', label: '🛡️ Yönetim Paneli', action: (ctl) => { ctl.close(); openAdminPanel(); } }] }] : []),
      { label: '', items: [{ id: 'logout', label: 'Çıkış Yap', danger: true, action: async () => { if (await confirmDialog('Çıkış Yap', 'Çıkış yapmak istediğine emin misin?', 'Çıkış Yap')) logout(); } }] },
    ],
    render: (id, el, ctl) => USER_PAGES[id](el, ctl),
  });
}

function changePasswordModal() {
  modal({
    title: 'Şifreni güncelle', sub: 'Mevcut şifreni ve yeni şifreni gir. Diğer cihazlardaki oturumların kapanır.',
    body: '<label class="field"><span>Mevcut Şifre</span><input class="input" type="password" id="pw-old" autocomplete="current-password"></label><label class="field"><span>Yeni Şifre</span><input class="input" type="password" id="pw-new" autocomplete="new-password"><small>En az 8 karakter</small></label><div class="form-error" id="pw-err"></div>',
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Tamam</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        try { await api.patch('/users/@me', { password: m.querySelector('#pw-old').value, new_password: m.querySelector('#pw-new').value }); close(); toast('Şifren değiştirildi', 'ok'); } catch (e) { m.querySelector('#pw-err').textContent = e.message; }
      };
    },
  });
}

const USER_PAGES = {
  account(el, ctl) {
    const me = S.me;
    el.innerHTML = `<h2>Hesabım</h2>
      <div class="account-card"><div class="banner" style="background:${esc(me.banner_color || colorFor(me.id))}"></div>
        <div class="head">${avatar(me, 80)}<h3>${esc(me.display_name)}</h3><button class="btn sm" data-go="profile" style="margin-bottom:10px">Kullanıcı Profilini Düzenle</button></div>
        <div class="rows">
          <div class="kv"><div><small>Görünen Ad</small>${esc(me.display_name)}</div><button class="btn secondary sm" data-edit="display_name">Düzenle</button></div>
          <div class="kv"><div><small>Kullanıcı Adı</small>${esc(me.username)}</div><button class="btn secondary sm" data-edit="username">Düzenle</button></div>
          <div class="kv"><div><small>Kullanıcı Kimliği</small><span class="muted">${me.id}</span></div><button class="btn secondary sm" data-copy>Kopyala</button></div>
        </div></div>
      <h3>Şifre ve Kimlik Doğrulama</h3><button class="btn" data-pw>Şifreyi Değiştir</button>`;
    el.querySelector('[data-go]').onclick = () => ctl.show('profile');
    el.querySelector('[data-copy]').onclick = () => copy(me.id);
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
      const k = b.dataset.edit;
      const v = await promptDialog(k === 'username' ? 'Kullanıcı adını değiştir' : 'Görünen adı değiştir', k === 'username' ? 'Kullanıcı Adı' : 'Görünen Ad', me[k], { max: 32 });
      if (v === null) return;
      try { H.ME_UPDATE(await api.patch('/users/@me', { [k]: v })); ctl.refresh(); toast('Kaydedildi', 'ok'); } catch (e) { fail(e); }
    });
    el.querySelector('[data-pw]').onclick = changePasswordModal;
  },

  security: (el, ctl) => security.securityPage(el, ctl),
  install: (el) => pwa.installPage(el),
  appearance: (el) => appearancePage(el),

  profile(el, ctl) {
    const me = S.me;
    el.innerHTML = `<h2>Profiller</h2>
      <div class="row" style="align-items:flex-start;gap:28px;flex-wrap:wrap">
        <div class="grow" style="min-width:260px">
          <label class="field"><span>Görünen Ad</span><input class="input" id="pf-name" maxlength="32" value="${esc(me.display_name)}"></label>
          <div class="field"><span>Avatar</span><div class="row"><button class="btn sm" data-av>Avatarı Değiştir</button>${me.avatar ? '<button class="btn ghost sm" data-av-rm>Avatarı Kaldır</button>' : ''}</div></div>
          <label class="field"><span>Afiş Rengi</span><input type="color" id="pf-color" value="${esc(me.banner_color || colorFor(me.id))}" style="width:60px;height:36px;border:0;background:none;cursor:pointer"></label>
          <label class="field"><span>Özel Durum</span><input class="input" id="pf-status" maxlength="128" value="${esc(me.custom_status)}" placeholder="Ne yapıyorsun?"></label>
          <label class="field"><span>Hakkımda</span><textarea class="textarea" id="pf-about" maxlength="190" placeholder="Kendinden bahset">${esc(me.about)}</textarea><small>Markdown kullanabilirsin.</small></label>
          <button class="btn" data-save>Değişiklikleri Kaydet</button>
        </div>
        <div style="width:300px"><h5 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;color:var(--text-3)">Önizleme</h5>
          <div class="popover" style="position:static;animation:none" id="pf-preview"></div></div>
      </div>`;
    const preview = () => {
      const color = el.querySelector('#pf-color').value;
      el.querySelector('#pf-preview').innerHTML = `<div class="profile-banner" style="background:${esc(color)}"></div><div class="profile-head">${avatar({ ...me, status: me.status_setting === 'invisible' ? 'offline' : me.status_setting }, 80, { status: true })}</div>
        <div class="profile-card"><h3>${esc(el.querySelector('#pf-name').value || me.username)}</h3><div class="uname">${esc(me.username)}</div>
        ${el.querySelector('#pf-status').value ? `<p style="margin-top:8px">${esc(el.querySelector('#pf-status').value)}</p>` : ''}<hr>
        ${el.querySelector('#pf-about').value ? `<h5>Hakkımda</h5><p>${markdown(el.querySelector('#pf-about').value)}</p>` : ''}</div>`;
    };
    preview();
    el.addEventListener('input', preview);
    el.querySelector('[data-av]').onclick = () => uploadImage('/users/@me/avatar', (u) => { H.ME_UPDATE(u); ctl.refresh(); });
    el.querySelector('[data-av-rm]')?.addEventListener('click', async () => { H.ME_UPDATE(await api.patch('/users/@me', { avatar: null })); ctl.refresh(); });
    el.querySelector('[data-save]').onclick = async () => {
      try {
        H.ME_UPDATE(await api.patch('/users/@me', {
          display_name: el.querySelector('#pf-name').value, banner_color: el.querySelector('#pf-color').value,
          custom_status: el.querySelector('#pf-status').value, about: el.querySelector('#pf-about').value,
        }));
        toast('Profil kaydedildi', 'ok');
      } catch (e) { fail(e); }
    };
  },

  async voice(el) {
    el.innerHTML = `<h2>Ses ve Görüntü</h2>
      <div class="row wrap" style="align-items:flex-start">
        <label class="field grow"><span>Giriş Cihazı</span><select class="input" id="v-mic"></select></label>
        <label class="field grow"><span>Çıkış Cihazı</span><select class="input" id="v-spk"></select></label>
      </div>
      <label class="field"><span>Kamera</span><select class="input" id="v-cam"></select></label>
      <div class="field"><span>Mikrofon Testi</span><div class="row"><button class="btn sm" id="v-test">Kontrol Edelim</button><div class="meter grow"><i id="v-meter"></i></div></div></div>
      <label class="field"><span>Giriş Hassasiyeti</span><input type="range" id="v-sens" min="0.005" max="0.15" step="0.005" value="${store.get('sensitivity', 0.035)}" style="width:100%;accent-color:var(--brand)">
        <small>Konuşma göstergesinin ne kadar seste yanacağını belirler. Sola kaydırdıkça daha hassas olur.</small></label>
      <h3>Gelişmiş</h3>
      <div class="card">
        <label class="check"><input type="checkbox" id="v-noise" ${store.get('noise', true) ? 'checked' : ''}><div><b>Gürültü Azaltma</b><small>Arka plan seslerini bastırır</small></div></label>
        <label class="check"><input type="checkbox" id="v-echo" ${store.get('echo', true) ? 'checked' : ''}><div><b>Yankı Giderme</b><small>Hoparlörden gelen sesin mikrofona geri dönmesini engeller</small></div></label>
        <label class="check"><input type="checkbox" id="v-agc" ${store.get('agc', true) ? 'checked' : ''}><div><b>Otomatik Kazanç Kontrolü</b><small>Ses seviyeni otomatik olarak dengeler</small></div></label>
      </div>
      <h3>Konuşma Modu</h3>
      <div class="card">
        <label class="radio-card"><div class="grow"><b>🎤 Ses Etkinliği</b><small>Konuştuğunda mikrofon otomatik açılır</small></div><input type="radio" name="vmode" value="vad" ${voice.mode === 'vad' ? 'checked' : ''}></label>
        <label class="radio-card"><div class="grow"><b>⌨️ Bas-Konuş</b><small>Yalnızca tuşa basılı tutarken konuşursun</small></div><input type="radio" name="vmode" value="ptt" ${voice.mode === 'ptt' ? 'checked' : ''}></label>
        <label class="radio-card"><div class="grow"><b>📻 Telsiz Modu</b><small>Bas-konuş + bip sesi, bırakınca "ksst" cızırtısı ve lo-fi telsiz sesi</small></div><input type="radio" name="vmode" value="walkie" ${voice.mode === 'walkie' ? 'checked' : ''}></label>
        <div class="kv" style="margin-top:12px"><div><small>Bas-Konuş Tuşu</small><b id="v-key">${esc(keyName(voice.pttKey))}</b></div><button class="btn secondary sm" id="v-keyset">Tuşu Değiştir</button></div>
      </div>
      <h3>Ses Filtresi</h3>
      <div class="sb-filters">${Object.entries(VOICE_FILTERS).map(([k, l]) => `<button class="${voice.filter === k ? 'on' : ''}" data-vf="${k}">${l}</button>`).join('')}</div>
      <p class="muted" style="font-size:13px">Not: Mikrofon ve kamera erişimi için site <b>HTTPS</b> üzerinden açılmalıdır (localhost hariç).</p>`;
    el.querySelectorAll('[name=vmode]').forEach((r) => r.onchange = () => { voice.setMode(r.value); USER_PAGES.voice(el); });
    el.querySelectorAll('[data-vf]').forEach((b) => b.onclick = () => { voice.setFilter(b.dataset.vf); USER_PAGES.voice(el); });
    el.querySelector('#v-keyset').onclick = (e) => {
      e.target.textContent = 'Bir tuşa bas…';
      const h = (ev) => { ev.preventDefault(); if (ev.code !== 'Escape') voice.setPttKey(ev.code); removeEventListener('keydown', h, true); USER_PAGES.voice(el); };
      addEventListener('keydown', h, true);
    };
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { /* yok */ }
    const fill = (sel, kind, key) => {
      const list = devices.filter((d) => d.kind === kind);
      const cur = store.get(key, '');
      sel.innerHTML = '<option value="">Varsayılan</option>' + list.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `Cihaz ${i + 1}`)}</option>`).join('');
      sel.onchange = () => {
        store.set(key, sel.value);
        if (key === 'micId') voice?.switchMic();
        if (key === 'speakerId') for (const p of voice?.peers.values() || []) p.audio?.setSinkId?.(sel.value).catch(() => {});
      };
    };
    fill(el.querySelector('#v-mic'), 'audioinput', 'micId');
    fill(el.querySelector('#v-spk'), 'audiooutput', 'speakerId');
    fill(el.querySelector('#v-cam'), 'videoinput', 'camId');
    el.querySelector('#v-sens').oninput = (e) => store.set('sensitivity', +e.target.value);
    for (const [id, key] of [['#v-noise', 'noise'], ['#v-echo', 'echo'], ['#v-agc', 'agc']]) {
      el.querySelector(id).onchange = (e) => { store.set(key, e.target.checked); voice?.switchMic(); };
    }
    let test = null;
    el.querySelector('#v-test').onclick = async (e) => {
      if (test) { test.stop(); return; }
      try {
        const micId = store.get('micId', '');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId ? { ideal: micId } : undefined, noiseSuppression: store.get('noise', true), echoCancellation: store.get('echo', true) } });
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(512);
        const meter = el.querySelector('#v-meter');
        const t = setInterval(() => {
          if (!meter.isConnected) return test?.stop();
          an.getByteTimeDomainData(buf);
          let s = 0; for (const v of buf) { const x = (v - 128) / 128; s += x * x; }
          const rms = Math.sqrt(s / buf.length);
          meter.style.width = Math.min(100, rms * 400) + '%';
          meter.style.background = rms > store.get('sensitivity', 0.035) ? 'var(--green)' : 'var(--yellow)';
        }, 60);
        test = { stop: () => { clearInterval(t); stream.getTracks().forEach((x) => x.stop()); ctx.close(); test = null; e.target.textContent = 'Kontrol Edelim'; meter.style.width = 0; } };
        e.target.textContent = 'Testi Durdur';
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch { toast('Mikrofona erişilemedi', 'error'); }
    };
  },

  notifications(el) {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    el.innerHTML = `<h2>Bildirimler</h2><div class="card">
      <label class="check"><input type="checkbox" id="n-desk" ${store.get('notifications', true) && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''}>
        <div><b>Masaüstü Bildirimlerini Etkinleştir</b><small>${perm === 'denied' ? 'Tarayıcı izinleri engellendi. Adres çubuğundaki kilit simgesinden izin verebilirsin.' : 'Sekme arka plandayken DM ve bahsetmeler için bildirim alırsın.'}</small></div></label>
      <label class="check"><input type="checkbox" id="n-sound" ${store.get('sounds', 'on') !== 'off' && localStorage.getItem('bis:sounds') !== 'off' ? 'checked' : ''}><div><b>Sesler</b><small>Mesaj, katılma ve ayrılma sesleri</small></div></label></div>
      <h3>Anlık Bildirimler (Uygulama Kapalıyken)</h3>
      <div class="card"><div class="kv"><div>Biscord kapalıyken bile DM, bahsetme, arkadaşlık isteği ve aramalar telefonuna/bilgisayarına bildirim olarak gelir.</div>
        <button class="btn ${pwa.pushState() === 'on' ? 'secondary' : ''} sm" id="n-push" ${['denied', 'unsupported'].includes(pwa.pushState()) ? 'disabled' : ''}>${pwa.pushState() === 'on' ? 'Kapat' : 'Aç'}</button></div>
        ${pwa.pushState() === 'denied' ? '<small class="danger">Bildirim izni engellenmiş. Tarayıcı ayarlarından bu siteye izin ver.</small>' : ''}
        ${pwa.pushState() === 'unsupported' ? '<small class="muted">Bu tarayıcı desteklemiyor. iPhone\'da önce Ana Ekrana ekle.</small>' : ''}</div>`;
    el.querySelector('#n-push').onclick = async () => { if (pwa.pushState() === 'on') await pwa.disablePush(); else await pwa.enablePush(); USER_PAGES.notifications(el); };
    el.querySelector('#n-desk').onchange = async (e) => {
      if (e.target.checked && Notification.permission !== 'granted') {
        const r = await Notification.requestPermission();
        if (r !== 'granted') { e.target.checked = false; toast('Bildirim izni verilmedi', 'error'); return; }
      }
      store.set('notifications', e.target.checked);
    };
    el.querySelector('#n-sound').onchange = (e) => { try { localStorage.setItem('bis:sounds', e.target.checked ? 'on' : 'off'); } catch { /* yok */ } };
  },

  async bots(el, ctl) {
    el.innerHTML = '<h2>Botlarım</h2><p class="muted">Yükleniyor…</p>';
    let bots = [];
    try { bots = await api.get('/bots'); } catch (e) { return fail(e); }
    const manageable = [...S.servers.values()].filter((s) => can(s.id, P.MANAGE_SERVER));
    el.innerHTML = `<h2>Botlarım</h2>
      <p class="muted">Kendi botlarını oluştur, token al ve Biscord Bot API'si ile programla. Örnek bot için proje klasöründeki <b>bots/example-bot.js</b> dosyasına bak.</p>
      <div class="card"><div class="row wrap"><input class="input grow" id="bot-name" placeholder="bot_kullanici_adi" maxlength="32"><button class="btn" id="bot-create">${icon('plus', 'sm')} Yeni Bot</button></div></div>
      <div id="bot-token"></div>
      ${bots.map((b) => `<div class="bot-card" data-bot="${b.id}">
        <div style="cursor:pointer" data-bact="avatar" title="Avatarı değiştir">${avatar(b, 56)}</div>
        <div class="meta"><b>${esc(b.display_name)}</b> <span class="bot-tag">BOT</span><small>${esc(b.username)} • Kimlik: ${b.id}</small>
          <small>${b.commands.length ? 'Komutlar: ' + b.commands.map((c) => '/' + esc(c.name)).join(', ') : 'Henüz kayıtlı komut yok'}</small>
          <label class="row" style="margin-top:6px;font-size:13px;gap:6px;cursor:pointer"><input type="checkbox" data-bact="public" ${b.bot_public ? 'checked' : ''} style="accent-color:var(--brand)"> Herkese açık (başkaları da sunucularına ekleyebilir)</label></div>
        <div class="row wrap" style="justify-content:flex-end;max-width:240px">
          ${manageable.length ? `<select class="input" data-bact="server" style="width:auto;padding:6px"><option value="">Sunucuya ekle…</option>${manageable.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>` : ''}
          <button class="btn secondary sm" data-bact="token">Token Yenile</button>
          <button class="btn red sm" data-bact="delete">Sil</button>
        </div></div>`).join('') || '<div class="empty"><div class="art">🤖</div><p>Henüz botun yok.</p></div>'}
      <h3>Hızlı Başlangıç</h3>
      <div class="code-block">BISCORD_URL=${esc(location.origin)} BOT_TOKEN=tokenin npm run bot</div>
      <p class="muted" style="font-size:13px">Botlar <b>Authorization: Bot &lt;token&gt;</b> başlığıyla REST API'yi kullanır ve Socket.IO ile gerçek zamanlı olayları dinler. Ayrıntılar README.md dosyasında.</p>`;
    const showToken = (t, name) => {
      el.querySelector('#bot-token').innerHTML = `<div class="card" style="border:1px solid var(--yellow)"><b>${esc(name)} için token</b>
        <p class="muted" style="font-size:13px;margin:6px 0 10px">Bu token yalnızca şimdi gösterilir. Kimseyle paylaşma — tokene sahip olan herkes botunu kontrol edebilir!</p>
        <div class="code-block">${esc(t)}</div><button class="btn sm" style="margin-top:10px" id="tok-copy">Kopyala</button></div>`;
      el.querySelector('#tok-copy').onclick = () => copy(t, 'Token kopyalandı');
    };
    el.querySelector('#bot-create').onclick = async () => {
      try {
        const r = await api.post('/bots', { username: el.querySelector('#bot-name').value.trim().toLowerCase() });
        await USER_PAGES.bots(el, ctl);
        showToken(r.token, r.bot.username);
      } catch (e) { fail(e); }
    };
    el.onclick = async (e) => {
      const a = e.target.closest('[data-bact]');
      if (!a || a.tagName === 'SELECT' || a.type === 'checkbox') return;
      const id = a.closest('[data-bot]').dataset.bot;
      const b = bots.find((x) => x.id === id);
      if (a.dataset.bact === 'avatar') uploadImage(`/bots/${id}/avatar`, () => USER_PAGES.bots(el, ctl));
      if (a.dataset.bact === 'token' && await confirmDialog('Token Yenile', 'Eski token geçersiz olacak ve bot bağlantısı kesilecek. Devam edilsin mi?', 'Yenile')) {
        try { const r = await api.post(`/bots/${id}/token`); showToken(r.token, b.username); } catch (err) { fail(err); }
      }
      if (a.dataset.bact === 'delete' && await confirmDialog('Botu Sil', `<b>${esc(b.username)}</b> kalıcı olarak silinsin mi? Gönderdiği tüm mesajlar da silinir.`, 'Sil')) {
        try { await api.del('/bots/' + id); USER_PAGES.bots(el, ctl); } catch (err) { fail(err); }
      }
    };
    el.onchange = async (e) => {
      const a = e.target.closest('[data-bact]');
      if (!a) return;
      const id = a.closest('[data-bot]').dataset.bot;
      if (a.dataset.bact === 'public') api.patch('/bots/' + id, { bot_public: a.checked }).then(() => toast('Kaydedildi', 'ok'), fail);
      if (a.dataset.bact === 'server' && a.value) {
        try { await api.post(`/bots/${id}/servers`, { server_id: a.value }); toast('Bot sunucuya eklendi', 'ok'); } catch (err) { fail(err); }
        a.value = '';
      }
    };
  },
};

const PERM_INFO = [
  ['ADMINISTRATOR', 'Yönetici', 'Tüm izinleri verir ve her şeyi atlar. Tehlikeli bir izindir!'],
  ['MANAGE_SERVER', 'Sunucuyu Yönet', 'Sunucu adını, simgesini değiştirme, davetleri yönetme ve bot ekleme'],
  ['MANAGE_CHANNELS', 'Kanalları Yönet', 'Kanal oluşturma, düzenleme ve silme'],
  ['MANAGE_ROLES', 'Rolleri Yönet', 'Kendi rolünden düşük rolleri oluşturma, düzenleme ve atama'],
  ['KICK_MEMBERS', 'Üyeleri At', 'Üyeleri sunucudan atma'],
  ['BAN_MEMBERS', 'Üyeleri Yasakla', 'Üyeleri kalıcı olarak yasaklama'],
  ['CREATE_INVITE', 'Davet Oluştur', 'Sunucuya yeni insanlar davet etme'],
  ['CHANGE_NICKNAME', 'Takma Ad Değiştir', 'Kendi takma adını değiştirme'],
  ['SEND_MESSAGES', 'Mesaj Gönder', 'Metin kanallarına mesaj gönderme'],
  ['ATTACH_FILES', 'Dosya Ekle', 'Resim ve dosya yükleme'],
  ['ADD_REACTIONS', 'Tepki Ekle', 'Mesajlara emoji tepkisi ekleme'],
  ['MENTION_EVERYONE', '@everyone ve @here Bahset', 'Herkese bildirim gönderme'],
  ['MANAGE_MESSAGES', 'Mesajları Yönet', 'Başkalarının mesajlarını silme ve sabitleme'],
  ['CONNECT', 'Bağlan', 'Ses kanallarına katılma'],
  ['SPEAK', 'Konuş', 'Ses kanallarında konuşma'],
  ['VIDEO', 'Görüntü', 'Kamera açma ve ekran paylaşma'],
  ['MUTE_MEMBERS', 'Üyeleri Sustur', 'Ses kanalındaki üyeleri susturma'],
  ['MOVE_MEMBERS', 'Üyelerin Bağlantısını Kes', 'Üyeleri ses kanalından çıkarma'],
];
const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b'];

function openServerSettings(sid, initial = 'overview') {
  const s = server(sid);
  if (!s) return;
  const owner = s.owner_id === S.me.id;
  const pages = [];
  if (can(sid, P.MANAGE_SERVER)) pages.push({ id: 'overview', label: 'Genel Görünüm' });
  if (can(sid, P.MANAGE_ROLES)) pages.push({ id: 'roles', label: 'Roller' });
  pages.push({ id: 'members', label: 'Üyeler' });
  if (can(sid, P.MANAGE_SERVER)) pages.push({ id: 'features', label: 'Özellikler' }, { id: 'automation', label: '🤖 Otomasyon (Bot Yap)' }, { id: 'invites', label: 'Davetler' }, { id: 'bots', label: 'Botlar' });
  if (can(sid, P.MANAGE_CHANNELS)) pages.push({ id: 'ghosts', label: '👻 Hayalet Kanallar' });
  if (can(sid, P.BAN_MEMBERS)) pages.push({ id: 'bans', label: 'Yasaklamalar' });
  const ctl = openSettingsShell({
    initial: pages.some((p) => p.id === initial) ? initial : pages[0].id,
    sections: [{ label: s.name, items: pages }, ...(owner ? [{ label: '', items: [{ id: 'delete', label: 'Sunucuyu Sil', danger: true, action: (c) => deleteServer(sid, c) }] }] : [])],
    render: (id, el, c) => SERVER_PAGES[id](sid, el, c),
  });
  return ctl;
}

async function deleteServer(sid, ctl) {
  const s = server(sid);
  modal({
    title: `'${esc(s.name)}' Sunucusunu Sil`,
    sub: `<b>${esc(s.name)}</b> sunucusunu silmek istediğine emin misin? Bu işlem geri alınamaz.`,
    body: '<label class="field"><span>Sunucu adını gir</span><input class="input" id="del-name"></label><div class="form-error" id="del-err"></div>',
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn red" data-ok>Sunucuyu Sil</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        if (m.querySelector('#del-name').value !== s.name) { m.querySelector('#del-err').textContent = 'Sunucu adını doğru girmedin.'; return; }
        try { await api.del('/servers/' + sid); close(); ctl.close(); toast('Sunucu silindi', 'ok'); } catch (e) { fail(e); }
      };
    },
  });
}

const SERVER_PAGES = {
  features(sid, el) {
    const s = server(sid);
    const row = (k, title, desc) => `<label class="check"><input type="checkbox" data-feat="${k}" ${s[k] ? 'checked' : ''}><div><b>${title}</b><small>${desc}</small></div></label>`;
    el.innerHTML = `<h2>Özellikler</h2><div class="card">
      ${row('economy', '🪙 Biscord Coin ve Seviye Sistemi', 'Üyeler mesaj yazdıkça XP ve coin kazanır, mağazadan renkli isim, unvan ve neon parıltı alabilir.')}
      ${row('activities', '🎮 Mini Oyunlar', 'Kanallarda Bilgi Yarışması, ASCII Yılan ve Arena oynanabilir.')}
      ${row('watch_party', '📺 Birlikte İzleme', 'Kanallarda YouTube veya video bağlantıları herkes için senkron oynatılabilir.')}</div>
      ${s.economy ? `<h3>Coin Ver / Al</h3><div class="card"><div class="row wrap"><select class="input grow" id="g-user">${[...s.members.keys()].filter((id) => !user(id)?.is_bot).map((id) => `<option value="${id}">${esc(displayName(id, sid))}</option>`).join('')}</select>
        <input class="input" type="number" id="g-amt" value="100" style="width:120px"><button class="btn" id="g-go">Uygula</button></div><small class="muted">Eksi değer girersen coin alınır.</small></div>` : ''}`;
    el.querySelectorAll('[data-feat]').forEach((c) => c.onchange = async () => {
      try { H.SERVER_UPDATE(await api.patch('/servers/' + sid, { [c.dataset.feat]: c.checked })); toast('Kaydedildi', 'ok'); SERVER_PAGES.features(sid, el); } catch (e) { fail(e); }
    });
    el.querySelector('#g-go')?.addEventListener('click', async () => {
      try { await api.post(`/servers/${sid}/economy/grant`, { user_id: el.querySelector('#g-user').value, amount: +el.querySelector('#g-amt').value }); toast('Coin güncellendi', 'ok'); } catch (e) { fail(e); }
    });
  },

  automation: (sid, el) => automationPage(sid, el),

  async ghosts(sid, el) {
    el.innerHTML = '<h2>👻 Hayalet Kanallar</h2><p class="muted">Yükleniyor…</p>';
    let list;
    try { list = await api.get(`/servers/${sid}/ghosts`); } catch (e) { return fail(e); }
    el.innerHTML = `<h2>👻 Hayalet Kanallar</h2>
      <p class="muted">Hayalet kanallar listede görünmez. Üyeler bir metin kanalına <code class="inline">/ghost şifre</code> yazarak girer. Mesajlar hiçbir yere kaydedilmez; yalnızca o an içeride olanlara iletilir.</p>
      <button class="btn" data-new>Yeni Hayalet Kanal</button>
      <div style="margin-top:14px">${list.map((c) => `<div class="table-row"><span style="font-size:22px">👻</span><div class="meta"><b>${esc(c.name)}</b><small>${c.active ? `${c.active} kişi içeride` : 'Şu an boş'}</small></div>
        <button class="btn red sm" data-del="${c.id}">Sil</button></div>`).join('') || '<p class="muted">Henüz hayalet kanal yok.</p>'}</div>`;
    el.querySelector('[data-new]').onclick = () => createChannelModal(sid, null, 'ghost');
    el.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d || !(await confirmDialog('Hayalet kanalı sil', 'Bu hayalet kanal silinsin mi? İçerideki herkes çıkarılır.', 'Sil'))) return;
      try { await api.del(`/servers/${sid}/ghosts/${d.dataset.del}`); SERVER_PAGES.ghosts(sid, el); } catch (err) { fail(err); }
    };
  },

  overview(sid, el, ctl) {
    const s = server(sid);
    const texts = serverChannels(sid).filter((c) => c.type === 'text');
    el.innerHTML = `<h2>Sunucuya Genel Bakış</h2>
      <div class="row" style="gap:24px;align-items:flex-start;flex-wrap:wrap">
        <div style="text-align:center"><div class="guild-btn" style="width:100px;height:100px;border-radius:50%;background:var(--brand);color:#fff;font-size:28px">${serverIcon(s)}</div>
          <button class="btn sm" style="margin-top:10px" data-icon>Resim Yükle</button>${s.icon ? '<br><button class="btn ghost sm" data-icon-rm>Kaldır</button>' : ''}</div>
        <div class="grow" style="min-width:240px">
          <label class="field"><span>Sunucu Adı</span><input class="input" id="so-name" maxlength="100" value="${esc(s.name)}"></label>
          <label class="field"><span>Sistem Mesajları Kanalı</span><select class="input" id="so-sys"><option value="">Sistem mesajı yok</option>${texts.map((c) => `<option value="${c.id}" ${c.id === s.system_channel_id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>
            <small>Yeni üyeler katıldığında karşılama mesajı bu kanala gönderilir.</small></label>
          <button class="btn" data-save>Değişiklikleri Kaydet</button>
        </div></div>
      ${s.owner_id === S.me.id ? `<h3>Sunucu Sahipliğini Devret</h3><div class="row"><select class="input grow" id="so-owner">${[...s.members.keys()].filter((id) => id !== S.me.id && !user(id)?.is_bot).map((id) => `<option value="${id}">${esc(displayName(id, sid))}</option>`).join('')}</select><button class="btn red" data-transfer>Devret</button></div>` : ''}`;
    el.querySelector('[data-icon]').onclick = () => uploadImage(`/servers/${sid}/icon`, (r) => { H.SERVER_UPDATE(r); ctl.refresh(); });
    el.querySelector('[data-icon-rm]')?.addEventListener('click', async () => { H.SERVER_UPDATE(await api.patch('/servers/' + sid, { icon: null })); ctl.refresh(); });
    el.querySelector('[data-save]').onclick = async () => {
      try { H.SERVER_UPDATE(await api.patch('/servers/' + sid, { name: el.querySelector('#so-name').value, system_channel_id: el.querySelector('#so-sys').value || null })); toast('Kaydedildi', 'ok'); } catch (e) { fail(e); }
    };
    el.querySelector('[data-transfer]')?.addEventListener('click', async () => {
      const to = el.querySelector('#so-owner').value;
      if (!to) return;
      if (!(await confirmDialog('Sahipliği Devret', `Sunucunun sahipliğini <b>${esc(displayName(to, sid))}</b> kullanıcısına devretmek istediğine emin misin? Bu işlem geri alınamaz.`, 'Devret'))) return;
      try { await api.post(`/servers/${sid}/transfer`, { user_id: to }); ctl.close(); toast('Sahiplik devredildi', 'ok'); } catch (e) { fail(e); }
    });
  },

  roles(sid, el, ctl, selected) {
    const s = server(sid);
    const myTop = topPos(sid, S.me.id);
    const myPerms = permsIn(sid);
    const roles = [...s.roles.values()].sort((a, b) => b.position - a.position);
    const sel = s.roles.get(selected || ctl.selRole) || roles.find((r) => r.id !== s.id) || s.roles.get(s.id);
    ctl.selRole = sel.id;
    const isEveryone = sel.id === s.id;
    const editable = isEveryone || sel.position < myTop;
    el.innerHTML = `<h2>Roller</h2><p class="muted">Rolleri kullanarak sunucu üyelerini gruplandır ve izinlerini belirle.</p>
      <div class="roles-layout">
        <div class="roles-list"><button class="btn sm block" data-new style="margin-bottom:10px">${icon('plus', 'sm')} Rol Oluştur</button>
          ${roles.map((r) => `<button class="${r.id === sel.id ? 'active' : ''}" data-role="${r.id}"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}<span class="muted" style="margin-left:auto;font-size:12px">${r.id === s.id ? s.members.size : [...s.members.values()].filter((m) => m.roles.includes(r.id)).length}</span></button>`).join('')}</div>
        <div class="roles-edit">
          <h3 style="margin-top:0">Rolü Düzenle — ${esc(sel.name)}</h3>
          ${editable ? '' : '<p class="danger" style="font-size:13px">Bu rol senin en yüksek rolünden yüksek ya da eşit, bu yüzden düzenleyemezsin.</p>'}
          ${isEveryone ? '<p class="muted" style="font-size:13px">@everyone, sunucudaki herkes için varsayılan izinleri belirler.</p>' : `
          <label class="field"><span>Rol Adı</span><input class="input" id="r-name" maxlength="100" value="${esc(sel.name)}" ${editable ? '' : 'disabled'}></label>
          <div class="field"><span>Rol Rengi</span><div class="color-row" id="r-colors">
            <button data-color="" class="${!sel.color ? 'sel' : ''}" style="background:#99aab5" title="Varsayılan"></button>
            ${ROLE_COLORS.map((c) => `<button data-color="${c}" class="${sel.color === c ? 'sel' : ''}" style="background:${c}"></button>`).join('')}
            <input type="color" id="r-color" value="${esc(sel.color || '#99aab5')}"></div></div>
          <label class="check"><input type="checkbox" id="r-hoist" ${sel.hoist ? 'checked' : ''} ${editable ? '' : 'disabled'}><div><b>Rol üyelerini çevrimiçi üyelerden ayrı göster</b></div></label>`}
          <h3>İzinler</h3>
          <div class="card">${PERM_INFO.map(([k, l, d]) => `<label class="check"><input type="checkbox" data-perm="${P[k]}" ${(sel.permissions & P[k]) ? 'checked' : ''} ${editable && (myPerms & P[k]) ? '' : 'disabled'}><div><b>${l}</b><small>${d}</small></div></label>`).join('')}</div>
          <div class="row"><button class="btn" data-save ${editable ? '' : 'disabled'}>Değişiklikleri Kaydet</button>${!isEveryone && editable ? '<button class="btn red" data-del>Rolü Sil</button>' : ''}</div>
        </div></div>`;
    let color = sel.color || '';
    el.querySelector('#r-colors')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b || !editable) return;
      color = b.dataset.color;
      $$('#r-colors button', el).forEach((x) => x.classList.toggle('sel', x === b));
    });
    el.querySelector('#r-color')?.addEventListener('input', (e) => { color = e.target.value; $$('#r-colors button', el).forEach((x) => x.classList.remove('sel')); });
    el.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => { ctl.selRole = b.dataset.role; SERVER_PAGES.roles(sid, el, ctl, b.dataset.role); });
    el.querySelector('[data-new]').onclick = async () => {
      try { const r = await api.post(`/servers/${sid}/roles`, { name: 'yeni rol' }); s.roles.set(r.id, r); ctl.selRole = r.id; SERVER_PAGES.roles(sid, el, ctl, r.id); } catch (e) { fail(e); }
    };
    el.querySelector('[data-save]').onclick = async () => {
      let perms = 0;
      $$('[data-perm]:checked', el).forEach((c) => { perms |= +c.dataset.perm; });
      const body = { permissions: perms };
      if (!isEveryone) Object.assign(body, { name: el.querySelector('#r-name').value, color: color || null, hoist: el.querySelector('#r-hoist').checked });
      try { const r = await api.patch(`/servers/${sid}/roles/${sel.id}`, body); s.roles.set(r.id, r); SERVER_PAGES.roles(sid, el, ctl, r.id); toast('Rol kaydedildi', 'ok'); } catch (e) { fail(e); }
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Rolü Sil', `<b>${esc(sel.name)}</b> rolü silinsin mi?`, 'Sil'))) return;
      try { await api.del(`/servers/${sid}/roles/${sel.id}`); s.roles.delete(sel.id); ctl.selRole = null; SERVER_PAGES.roles(sid, el, ctl); } catch (e) { fail(e); }
    });
  },

  members(sid, el) {
    const s = server(sid);
    const draw = (q = '') => {
      const f = q.toLocaleLowerCase('tr');
      const list = [...s.members.values()].filter((m) => {
        const u = user(m.user_id);
        return u && (!f || u.username.includes(f) || displayName(m.user_id, sid).toLocaleLowerCase('tr').includes(f));
      }).sort((a, b) => a.joined_at - b.joined_at);
      el.querySelector('#m-list').innerHTML = list.map((m) => {
        const u = user(m.user_id);
        return `<div class="table-row">${avatar(u, 36, { status: true })}<div class="meta"><b>${esc(displayName(u.id, sid))}</b> ${u.is_bot ? '<span class="bot-tag">BOT</span>' : ''}${s.owner_id === u.id ? `<span class="crown" style="color:var(--yellow)">${icon('crown', 'xs')}</span>` : ''}
          <small>${esc(u.username)} • Katılma: ${fmtDay(m.joined_at)}</small>
          <div class="role-chips" style="margin-top:4px">${memberRoles(sid, u.id).map((r) => `<span class="role-chip"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`).join('')}</div></div>
          <button class="icon-btn" data-mmenu="${u.id}">${icon('moreV')}</button></div>`;
      }).join('');
    };
    el.innerHTML = `<h2>Sunucu Üyeleri — ${s.members.size}</h2><input class="input" id="m-q" placeholder="Üye ara" style="margin-bottom:12px"><div id="m-list"></div>`;
    draw();
    el.querySelector('#m-q').oninput = (e) => draw(e.target.value);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mmenu]');
      if (b) { const r = b.getBoundingClientRect(); userMenu(r.left - 190, r.bottom, b.dataset.mmenu, sid); }
    });
  },

  async invites(sid, el) {
    el.innerHTML = '<h2>Davetler</h2><p class="muted">Yükleniyor…</p>';
    try {
      const list = await api.get(`/servers/${sid}/invites`);
      el.innerHTML = `<h2>Davetler</h2><p class="muted">Aktif davet bağlantılarının listesi.</p>` + (list.length ? list.map((i) => `<div class="table-row">
        ${avatar(i.creator, 32)}<div class="meta"><b>${esc(i.code)}</b><small>${esc(i.creator?.display_name || '')} • ${i.uses}${i.max_uses ? '/' + i.max_uses : ''} kullanım • ${i.expires_at ? (i.expires_at < Date.now() ? 'Süresi doldu' : 'Bitiş: ' + fmtTime(i.expires_at)) : 'Süresiz'}</small></div>
        <button class="btn secondary sm" data-copy="${esc(i.code)}">Kopyala</button><button class="btn red sm" data-rm="${esc(i.code)}">Sil</button></div>`).join('') : '<div class="empty"><div class="art">✉️</div><p>Aktif davet yok.</p></div>');
      el.onclick = async (e) => {
        const c = e.target.closest('[data-copy]');
        if (c) copy(`${location.origin}/invite/${c.dataset.copy}`, 'Davet bağlantısı kopyalandı');
        const r = e.target.closest('[data-rm]');
        if (r) { try { await api.del('/invites/' + r.dataset.rm); SERVER_PAGES.invites(sid, el); } catch (err) { fail(err); } }
      };
    } catch (e) { fail(e); }
  },

  async bans(sid, el) {
    el.innerHTML = '<h2>Yasaklamalar</h2><p class="muted">Yükleniyor…</p>';
    try {
      const list = await api.get(`/servers/${sid}/bans`);
      el.innerHTML = `<h2>Yasaklamalar — ${list.length}</h2>` + (list.length ? list.map((b) => `<div class="table-row">${avatar(b.user, 32)}<div class="meta"><b>${esc(b.user?.display_name)}</b><small>${esc(b.reason || 'Sebep belirtilmedi')}</small></div>
        <button class="btn secondary sm" data-unban="${b.user_id}">Yasağı Kaldır</button></div>`).join('') : '<div class="empty"><div class="art">🕊️</div><p>Yasaklı kullanıcı yok.</p></div>');
      el.onclick = async (e) => {
        const u = e.target.closest('[data-unban]');
        if (u) { try { await api.del(`/servers/${sid}/bans/${u.dataset.unban}`); SERVER_PAGES.bans(sid, el); } catch (err) { fail(err); } }
      };
    } catch (e) { fail(e); }
  },

  bots(sid, el) {
    const s = server(sid);
    const bots = [...s.members.keys()].map(user).filter((u) => u?.is_bot);
    el.innerHTML = `<h2>Botlar</h2><p class="muted">Bot kimliğini (ID) girerek sunucuna bot ekle. Kendi botların ya da herkese açık botlar eklenebilir.</p>
      <div class="card"><div class="row"><input class="input grow" id="b-id" placeholder="Bot kimliği"><button class="btn" data-add>Ekle</button></div></div>
      <h3>Sunucudaki Botlar — ${bots.length}</h3>
      ${bots.map((b) => `<div class="table-row">${avatar(b, 36, { status: true })}<div class="meta"><b>${esc(b.display_name)}</b> <span class="bot-tag">BOT</span><small>${esc(b.username)}</small></div>
        ${can(sid, P.KICK_MEMBERS) ? `<button class="btn red sm" data-kick="${b.id}">Çıkar</button>` : ''}</div>`).join('') || '<p class="muted">Bu sunucuda bot yok.</p>'}`;
    el.querySelector('[data-add]').onclick = async () => {
      try { await api.post(`/bots/${el.querySelector('#b-id').value.trim()}/servers`, { server_id: sid }); toast('Bot eklendi', 'ok'); setTimeout(() => SERVER_PAGES.bots(sid, el), 300); } catch (e) { fail(e); }
    };
    el.onclick = async (e) => {
      const k = e.target.closest('[data-kick]');
      if (k) { try { await api.del(`/servers/${sid}/members/${k.dataset.kick}`); setTimeout(() => SERVER_PAGES.bots(sid, el), 300); } catch (err) { fail(err); } }
    };
  },
};

// ======================================================================= eylemler
const A = {
  home: () => navigate('@me', null),
  server: (el) => navigate(el.dataset.sid),
  'add-server': createServerModal,
  channel: (el) => {
    const c = S.channels.get(el.dataset.cid);
    if (!c) return;
    if (c.type === 'voice') {
      if (voice?.channelId !== c.id) joinVoice(c.id);
      navigate(c.server_id, c.id);
    } else navigate(c.server_id, c.id);
  },
  dm: (el) => navigate('@me', el.dataset.cid),
  friends: () => navigate('@me', null),
  'friends-tab': (el) => { S.friendsTab = el.dataset.tab; renderFriends(); },
  'new-dm': newDmModal,
  'quick-switch': quickSwitcher,
  'server-menu': (el) => serverMenu(el),
  'category-toggle': (el) => {
    const id = el.dataset.cid;
    S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id);
    store.set('collapsed', [...S.collapsed]);
    renderSidebar();
  },
  'create-channel': (el) => createChannelModal(S.view.sid, el.dataset.parent || null),
  'channel-settings': (el) => channelSettingsModal(el.dataset.cid),
  invite: (el) => inviteModal(el.dataset.sid),
  'toggle-mute': () => {
    if (voice?.connected) voice.toggleMute();
    else { voice.muted = !voice.muted; if (!voice.muted) voice.deafened = false; store.set('muted', voice.muted); store.set('deafened', voice.deafened); playSound(voice.muted ? 'mute' : 'unmute'); renderUserPanel(); }
  },
  'toggle-deafen': () => {
    if (voice?.connected) voice.toggleDeafen();
    else { voice.deafened = !voice.deafened; store.set('deafened', voice.deafened); playSound(voice.deafened ? 'mute' : 'unmute'); renderUserPanel(); }
  },
  'user-settings': () => openUserSettings(),
  'status-menu': (el) => statusMenu(el),
  'voice-leave': () => voice?.leave(),
  'voice-camera': () => voice?.toggleCamera(),
  'voice-screen': () => voice?.toggleScreen(),
  'voice-join': (el) => {
    const c = S.channels.get(el.dataset.cid);
    if (!c) return;
    if (c.type === 'dm') { if (S.view.cid !== c.id) navigate('@me', c.id); voice.join(c.id); } else joinVoice(c.id);
  },
  'goto-voice': () => {
    const c = S.channels.get(voice?.channelId);
    if (c) navigate(c.server_id || '@me', c.id);
  },
  call: async () => { const c = curChannel(); if (c?.type === 'dm') await voice.join(c.id); },
  'call-video': async () => { const c = curChannel(); if (c?.type === 'dm') { await voice.join(c.id); if (voice.channelId === c.id && voice.videoKind !== 'camera') voice.toggleCamera(); } },
  'tile-focus': (el) => { S.focusTile = S.focusTile === el.dataset.uid ? null : el.dataset.uid; renderStage(); },
  'toggle-members': () => {
    S.showMembers = !S.showMembers;
    store.set('showMembers', S.showMembers);
    const m = $('#members');
    if (m) { m.classList.toggle('hidden', !S.showMembers); m.classList.toggle('open', S.showMembers && innerWidth <= 1100); }
    renderHeader();
  },
  pins: () => (S.panel?.type === 'pins' ? A['close-panel']() : openPins()),
  'close-panel': () => { S.panel = null; $('#side-panel')?.classList.add('hidden'); },
  'goto-msg': (el) => {
    const c = S.channels.get(el.dataset.cid);
    if (!c) return;
    const mid = el.dataset.mid;
    const go = () => setTimeout(() => jumpTo(mid), 250);
    if (S.view.cid !== c.id) { navigate(c.server_id || '@me', c.id); go(); } else jumpTo(mid);
  },
  'show-topic': () => { const c = curChannel(); modal({ title: '#' + esc(c.name), body: `<div class="msg-text">${markdown(c.topic)}</div>` }); },
  'nav-open': () => $('#app')?.classList.add('nav-open'),
  'nav-close': () => $('#app')?.classList.remove('nav-open'),
  attach: (el) => {
    const ch = curChannel();
    if (!ch) return;
    if (ch.type === 'ghost') return toast('Hayalet kanallarda dosya paylaşılamaz', 'error');
    menuAt(el, [
      { label: '📎 Dosya Yükle', action: () => $('#file-input')?.click() },
      { label: '📦 Büyük Dosya (P2P, sınırsız)', action: () => files.startP2P(ch) },
      '-',
      { label: '📊 Anket', action: () => pollModal(ch) },
      { label: '✅ Yapılacaklar Listesi', action: () => todoModal(ch) },
      { label: '💻 Kod Çalıştırıcı', action: () => sandboxModal(ch) },
      { label: '🎮 Etkinlik / Oyun', action: () => acts.pickActivity(ch) },
      { label: clips.clipActive() ? '🎬 Son 30 sn\'yi Kaydet' : '🎬 Klip Modunu Aç', action: () => (clips.clipActive() ? clips.saveClip() : clips.toggleClipMode()) },
    ], { above: true });
  },
  install: () => pwa.promptInstall(),
  shop: () => shopModal(S.view.sid),
  'act-start': () => { const c = curChannel(); if (c) acts.pickActivity(c); },
  soundboard: (el) => soundboardPanel(el),
  'clip-toggle': () => clips.toggleClipMode(),
  'clip-save': () => clips.saveClip(),
  'ghost-leave': async () => {
    const c = curChannel();
    if (!c) return;
    try { await api.post(`/channels/${c.id}/ghost/leave`); } catch (e) { fail(e); }
  },
  'poll-vote': (el) => interact(el.dataset.mid, { action: 'vote', option: el.dataset.opt }),
  'poll-close': (el) => interact(el.dataset.mid, { action: 'close' }),
  'todo-toggle': (el) => interact(el.dataset.mid, { action: 'toggle', item: el.dataset.item }),
  'todo-remove': (el) => interact(el.dataset.mid, { action: 'remove', item: el.dataset.item }),
  'code-run': (el) => runBlock(el),
  'code-copy': (el) => copy(el.closest('.code-wrap')?.querySelector('code')?.textContent || '', 'Kod kopyalandı'),
  'preview-3d': (el) => files.preview3D({ url: el.dataset.url, filename: el.dataset.name, size: +el.dataset.size }),
  'preview-code': (el) => files.previewCode({ url: el.dataset.url, filename: el.dataset.name, size: +el.dataset.size }),
  'p2p-get': (el) => { const o = (files.p2pOffers.get(S.view.cid) || []).find((x) => x.id === el.dataset.id); if (o) files.acceptOffer(o, el); },
  'p2p-cancel': (el) => files.cancelOffer(el.dataset.id),
  'composer-emoji': (el) => emojiPicker(el, (e) => {
    const ta = $('#input');
    if (!ta) return;
    const p = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, p) + e + ta.value.slice(ta.selectionEnd ?? p);
    ta.setSelectionRange(p + e.length, p + e.length);
    ta.focus();
  }),
  'cancel-reply': () => { S.reply = null; renderComposerExtra(); },
  'remove-pending': (el) => { const [p] = S.pending.splice(+el.dataset.i, 1); if (p?.preview) URL.revokeObjectURL(p.preview); renderComposerExtra(); },
  'react-picker': (el) => emojiPicker(el, (e) => toggleReaction(el.dataset.mid, e)),
  'toggle-react': (el) => toggleReaction(el.dataset.mid, el.dataset.emoji),
  'quick-react': (el) => toggleReaction(el.dataset.mid, el.dataset.emoji),
  reply: (el) => startReply(el.dataset.mid),
  edit: (el) => startEdit(el.dataset.mid),
  'edit-save': (el) => saveEdit(el.dataset.mid),
  'edit-cancel': () => cancelEdit(),
  'delete-msg': (el, e) => deleteMsg(el.dataset.mid, e.shiftKey),
  'msg-menu': (el) => { const r = el.getBoundingClientRect(); messageMenu(r.left - 200, r.bottom + 4, el.dataset.mid); },
  jump: (el) => jumpTo(el.dataset.mid),
  lightbox: (el) => lightbox(el.dataset.src),
  profile: (el) => showProfile(el.dataset.uid, el, el.dataset.sid || undefined),
  'open-dm': (el, e) => { if (e.target.closest('.acts') && el.classList.contains('friend-row')) return; openDm(el.dataset.uid); },
  'friend-accept': (el) => api.put('/friends/' + el.dataset.uid).catch(fail),
  'friend-remove': (el) => api.del('/friends/' + el.dataset.uid).catch(fail),
  'friend-menu': (el) => { const r = el.getBoundingClientRect(); userMenu(r.left - 180, r.bottom + 4, el.dataset.uid); },
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu, .popover, .emoji-picker, [data-action="react-picker"], [data-action="composer-emoji"]')) closeFloating();
  const sp = e.target.closest('.spoiler');
  if (sp) { sp.classList.add('shown'); return; }
  const a = e.target.closest('[data-action]');
  if (a && A[a.dataset.action]) {
    e.preventDefault();
    e.stopPropagation();
    A[a.dataset.action](a, e);
    return;
  }
  const u = e.target.closest('[data-user]');
  if (u) { showProfile(u.dataset.user, u); return; }
  const mn = e.target.closest('[data-mention]');
  if (mn) {
    const found = [...S.users.values()].find((x) => x.username === mn.dataset.mention);
    if (found) showProfile(found.id, mn);
  }
});

document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented || e.target.closest('input, textarea, a, .settings, .modal')) return;
  const t = e.target.closest('[data-ctx]');
  if (!t) return;
  e.preventDefault();
  const { ctx } = t.dataset;
  if (ctx === 'message') messageMenu(e.clientX, e.clientY, t.dataset.mid);
  else if (ctx === 'user') userMenu(e.clientX, e.clientY, t.dataset.uid, t.dataset.sid || (S.view.sid !== '@me' ? S.view.sid : null));
  else if (ctx === 'channel') channelMenu(e.clientX, e.clientY, t.dataset.cid);
  else if (ctx === 'server') {
    const sid = t.dataset.sid;
    const s = server(sid);
    menu(e.clientX, e.clientY, [
      { label: 'Okundu Olarak İşaretle', icon: 'check', action: () => markServerRead(sid) },
      can(sid, P.CREATE_INVITE) && { label: 'İnsanları Davet Et', icon: 'userPlus', action: () => inviteModal(sid) },
      (can(sid, P.MANAGE_SERVER) || can(sid, P.MANAGE_ROLES)) && { label: 'Sunucu Ayarları', icon: 'gear', action: () => openServerSettings(sid) },
      '-',
      { label: 'Sunucu Kimliğini Kopyala', icon: 'copy', action: () => copy(sid) },
      s.owner_id !== S.me.id && { label: 'Sunucudan Ayrıl', danger: true, action: () => leaveServer(sid) },
    ]);
  } else {
    // msg-author / avatar
  }
});

document.addEventListener('contextmenu', (e) => {
  const u = e.target.closest('[data-user]');
  if (!u || e.defaultPrevented) return;
  e.preventDefault();
  userMenu(e.clientX, e.clientY, u.dataset.user, S.view.sid !== '@me' ? S.view.sid : null);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.menu, .popover, .emoji-picker', layers)) return closeFloating();
    const lb = $('.lightbox', layers);
    if (lb) return lb.remove();
    const ov = $$('.overlay', layers).pop();
    if (ov) return ov.remove();
    const st = $$('.settings', layers).pop();
    if (st) return st.remove();
    if (S.editing) return cancelEdit();
    if (S.panel) return A['close-panel']();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.ready) { e.preventDefault(); quickSwitcher(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm' && S.ready) { e.preventDefault(); A['toggle-mute'](); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd' && S.ready) { e.preventDefault(); A['toggle-deafen'](); }
  // yazmaya başlayınca kutuya odaklan
  if (S.ready && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !e.target.closest('input, textarea, select, [contenteditable]') && !layers.children.length) {
    $('#input')?.focus();
  }
});

window.addEventListener('beforeunload', () => voice?.leave());
window.addEventListener('resize', debounce(() => { if (innerWidth > 760) $('#app')?.classList.remove('nav-open'); }, 150));

// Özellik modüllerinin (public/js/f/*) kullandığı ortak bağlantılar
Object.assign(ctx, {
  S, H, api, root, layers, $, $$, esc, icon, avatar, markdown,
  toast, fail, modal, confirmDialog, promptDialog, menu, menuAt, closeFloating, place, emojiPicker, copy,
  user, server, member, displayName, nameColor, can, curChannel, serverChannels, upsertUser,
  navigate, renderGuilds, renderSidebar, renderMain, renderMessages, showProfile, openSettingsShell,
  showAuth, startApp, changePasswordModal, renderP2P,
  onLowendChange: () => { if (voice?.connected) voice.startLoop(); renderAll(); },
  onClipChange: () => { renderVoicePanel(); renderStage(); },
});
Object.defineProperty(ctx, 'socket', { get: () => socket });
Object.defineProperty(ctx, 'voice', { get: () => voice });

boot();
