'use strict';
// Kod bilmeden bot: "EĞER <tetikleyici> → O ZAMAN <eylemler>" kuralları

const TRIGGERS = ['message_contains', 'message_equals', 'message_starts', 'member_join', 'link', 'caps', 'mention_spam', 'bad_words'];
const ACTIONS = ['reply', 'send', 'react', 'delete', 'timeout', 'add_role', 'dm', 'coins'];

module.exports = (ctx) => {
  const { api, q, auth, fail, clean, newId, now, requireServerPerm, P, createMessage, deleteMessage, toServer, memberPayload, getUser, has } = ctx;

  // Otomasyon mesajlarını gönderen sistem botu
  let systemId = ctx.settings.get('system_user_id');
  if (!systemId || !getUser(systemId)) {
    systemId = newId();
    let name = 'biscord_otomasyon';
    if (q.get('SELECT 1 FROM users WHERE username=?', name)) name += '_' + systemId.slice(-4);
    q.run("INSERT INTO users(id,username,display_name,is_bot,status,about,created_at) VALUES(?,?,?,1,'online',?,?)",
      systemId, name, 'Biscord Otomasyon', 'Sunucuların otomasyon kurallarını çalıştırır.', now());
    ctx.settings.set('system_user_id', systemId);
  }
  ctx.systemUserId = systemId;

  const cache = new Map(); // server_id -> kurallar
  const rulesOf = (sid) => {
    if (!cache.has(sid)) {
      cache.set(sid, q.all('SELECT * FROM automations WHERE server_id=? AND enabled=1', sid).map((r) => ({ ...r, actions: JSON.parse(r.actions) })));
    }
    return cache.get(sid);
  };

  const fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  const sanitize = (b) => {
    const trigger_type = String(b.trigger_type);
    if (!TRIGGERS.includes(trigger_type)) fail(400, 'Geçersiz tetikleyici');
    const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 6).map((a) => {
      if (!ACTIONS.includes(a?.type)) fail(400, 'Geçersiz eylem');
      return {
        type: a.type,
        text: clean(a.text, 1000) || undefined,
        channel_id: a.channel_id ? String(a.channel_id) : undefined,
        emoji: clean(a.emoji, 16) || undefined,
        minutes: a.minutes ? Math.max(1, Math.min(10080, Number(a.minutes) || 5)) : undefined,
        role_id: a.role_id ? String(a.role_id) : undefined,
        amount: a.amount ? Math.max(-100000, Math.min(100000, Math.trunc(Number(a.amount) || 0))) : undefined,
      };
    });
    if (!actions.length) fail(400, 'En az bir eylem ekle');
    return { name: clean(b.name, 64) || 'Yeni kural', trigger_type, trigger_value: clean(b.trigger_value, 500), actions };
  };

  // ---------------------------------------------------------------- yönetim
  api.get('/servers/:sid/automations', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id, P.MANAGE_SERVER);
    res.json(q.all('SELECT * FROM automations WHERE server_id=? ORDER BY created_at', req.params.sid).map((r) => ({ ...r, enabled: !!r.enabled, actions: JSON.parse(r.actions) })));
  });

  api.post('/servers/:sid/automations', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
    if (q.get('SELECT COUNT(*) AS n FROM automations WHERE server_id=?', sid).n >= 50) fail(400, 'En fazla 50 kural oluşturabilirsin');
    const r = sanitize(req.body);
    const id = newId();
    q.run('INSERT INTO automations(id,server_id,name,enabled,trigger_type,trigger_value,actions,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,?)',
      id, sid, r.name, r.trigger_type, r.trigger_value, JSON.stringify(r.actions), req.user.id, now());
    cache.delete(sid);
    res.json({ ...q.get('SELECT * FROM automations WHERE id=?', id), enabled: true, actions: r.actions });
  });

  api.patch('/servers/:sid/automations/:id', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
    const ex = q.get('SELECT * FROM automations WHERE id=? AND server_id=?', req.params.id, sid);
    if (!ex) fail(404, 'Kural bulunamadı');
    if (req.body.trigger_type !== undefined) {
      const r = sanitize(req.body);
      q.run('UPDATE automations SET name=?, trigger_type=?, trigger_value=?, actions=? WHERE id=?', r.name, r.trigger_type, r.trigger_value, JSON.stringify(r.actions), ex.id);
    }
    if (req.body.enabled !== undefined) q.run('UPDATE automations SET enabled=? WHERE id=?', req.body.enabled ? 1 : 0, ex.id);
    cache.delete(sid);
    const r = q.get('SELECT * FROM automations WHERE id=?', ex.id);
    res.json({ ...r, enabled: !!r.enabled, actions: JSON.parse(r.actions) });
  });

  api.delete('/servers/:sid/automations/:id', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id, P.MANAGE_SERVER);
    q.run('DELETE FROM automations WHERE id=? AND server_id=?', req.params.id, req.params.sid);
    cache.delete(req.params.sid);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- çalıştırma
  function matches(rule, msg) {
    const text = (msg.content || '').toLocaleLowerCase('tr');
    const val = (rule.trigger_value || '').toLocaleLowerCase('tr').trim();
    switch (rule.trigger_type) {
      case 'message_contains': return !!val && text.includes(val);
      case 'message_equals': return !!val && text.trim() === val;
      case 'message_starts': return !!val && text.startsWith(val);
      case 'link': return /https?:\/\/|www\./i.test(msg.content || '');
      case 'caps': {
        const letters = (msg.content || '').replace(/[^\p{L}]/gu, '');
        return letters.length >= 10 && letters === letters.toLocaleUpperCase('tr') && letters !== letters.toLocaleLowerCase('tr');
      }
      case 'mention_spam': return msg.mentions.length >= (Number(val) || 5);
      case 'bad_words': {
        const words = val.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
        return words.some((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(text));
      }
      default: return false;
    }
  }

  function run(rule, { sid, ch, uid, msg }) {
    const u = getUser(uid);
    const srv = q.get('SELECT name, system_channel_id FROM servers WHERE id=?', sid);
    const vars = {
      kullanici: '@' + (u?.username || ''), kullanici_adi: u?.display_name || u?.username || '',
      sunucu: srv?.name || '', kanal: ch ? '#' + ch.name : '',
      uye_sayisi: q.get('SELECT COUNT(*) AS n FROM members WHERE server_id=?', sid).n,
    };
    const target = ch || (srv?.system_channel_id && q.get('SELECT * FROM channels WHERE id=?', srv.system_channel_id));
    for (const a of rule.actions) {
      try {
        if (a.type === 'reply' && target) createMessage(target, systemId, { content: fill(a.text, vars), reply_to: msg?.id || null });
        else if (a.type === 'send') {
          const c = q.get("SELECT * FROM channels WHERE id=? AND server_id=? AND type='text'", a.channel_id, sid);
          if (c) createMessage(c, systemId, { content: fill(a.text, vars) });
        } else if (a.type === 'react' && msg && a.emoji) {
          q.run('INSERT OR IGNORE INTO reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)', msg.id, systemId, a.emoji, now());
          ctx.toChannel(ch, 'REACTION_UPDATE', { message_id: msg.id, channel_id: ch.id, server_id: sid, reactions: reactionsOf(msg.id) });
        } else if (a.type === 'delete' && msg) {
          const row = q.get('SELECT * FROM messages WHERE id=?', msg.id);
          if (row) deleteMessage(row, ch);
        } else if (a.type === 'timeout' && !has(sid, uid, P.MANAGE_MESSAGES)) {
          q.run('UPDATE members SET timeout_until=? WHERE server_id=? AND user_id=?', now() + (a.minutes || 5) * 60e3, sid, uid);
          toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: memberPayload(sid, uid) });
        } else if (a.type === 'add_role' && a.role_id && q.get('SELECT 1 FROM roles WHERE id=? AND server_id=?', a.role_id, sid) && a.role_id !== sid) {
          q.run('INSERT OR IGNORE INTO member_roles(server_id,user_id,role_id) VALUES(?,?,?)', sid, uid, a.role_id);
          toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: memberPayload(sid, uid) });
        } else if (a.type === 'coins') {
          q.run('UPDATE members SET coins=MAX(0, coins+?) WHERE server_id=? AND user_id=?', a.amount || 0, sid, uid);
          toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: memberPayload(sid, uid) });
        } else if (a.type === 'dm' && u && !u.is_bot) {
          let dm = q.get(`SELECT c.* FROM channels c JOIN dm_participants a ON a.channel_id=c.id AND a.user_id=? JOIN dm_participants b ON b.channel_id=c.id AND b.user_id=? WHERE c.type='dm'`, systemId, uid);
          if (!dm) {
            const id = newId();
            q.run("INSERT INTO channels(id,type,created_at) VALUES(?,'dm',?)", id, now());
            q.run('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)', id, systemId);
            q.run('INSERT INTO dm_participants(channel_id,user_id) VALUES(?,?)', id, uid);
            dm = q.get('SELECT * FROM channels WHERE id=?', id);
            ctx.toUser(uid, 'DM_CREATE', { ...dm, recipients: [ctx.publicUser(getUser(systemId)), ctx.publicUser(u)] });
          }
          createMessage(dm, systemId, { content: fill(a.text, vars) });
        }
      } catch (e) { console.error('[otomasyon]', rule.name, e.message); }
    }
  }

  function reactionsOf(mid) {
    const map = new Map();
    for (const r of q.all('SELECT emoji, user_id FROM reactions WHERE message_id=? ORDER BY created_at', mid)) {
      if (!map.has(r.emoji)) map.set(r.emoji, []);
      map.get(r.emoji).push(r.user_id);
    }
    return [...map].map(([emoji, users]) => ({ emoji, count: users.length, users }));
  }

  ctx.hooks.message.push((msg, ch, author) => {
    if (!ch.server_id || !author || author.is_bot || msg.type !== 0) return;
    for (const rule of rulesOf(ch.server_id)) {
      if (rule.trigger_type !== 'member_join' && matches(rule, msg)) {
        // önce silme dışındaki eylemler mesaja yanıt verebilsin diye sırayla çalışır
        setImmediate(() => run(rule, { sid: ch.server_id, ch, uid: author.id, msg }));
      }
    }
  });

  ctx.hooks.memberJoin.push((sid, uid) => {
    const u = getUser(uid);
    if (!u || u.is_bot) return;
    for (const rule of rulesOf(sid)) if (rule.trigger_type === 'member_join') setImmediate(() => run(rule, { sid, ch: null, uid, msg: null }));
  });
};
