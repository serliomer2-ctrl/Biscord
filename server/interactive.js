'use strict';
// Mesaj içi etkileşimli araçlar: canlı anketler ve ortak yapılacaklar listeleri

module.exports = (ctx) => {
  const { api, q, auth, fail, clean, newId, now, has, P, channelAccess, messagePayload, toChannel, limited } = ctx;

  ctx.sanitizeComponents = (raw) => {
    let c = raw;
    if (typeof raw === 'string') { try { c = JSON.parse(raw); } catch { return null; } }
    if (!c || typeof c !== 'object') return null;
    if (c.type === 'poll') {
      const question = clean(c.question, 300);
      const options = (Array.isArray(c.options) ? c.options : []).map((o) => clean(typeof o === 'string' ? o : o?.text, 100)).filter(Boolean).slice(0, 10);
      if (!question) fail(400, 'Anket sorusu gerekli');
      if (options.length < 2) fail(400, 'Ankette en az iki seçenek olmalı');
      const hours = Number(c.duration_hours) || 0;
      return {
        type: 'poll', question, multi: !!c.multi, closed: false,
        ends_at: hours > 0 ? now() + Math.min(hours, 24 * 30) * 3600e3 : null,
        options: options.map((text) => ({ id: newId(), text, votes: [] })),
      };
    }
    if (c.type === 'todo') {
      const title = clean(c.title, 200) || 'Yapılacaklar';
      const items = (Array.isArray(c.items) ? c.items : []).map((t) => clean(typeof t === 'string' ? t : t?.text, 200)).filter(Boolean).slice(0, 50);
      if (!items.length) fail(400, 'Listeye en az bir madde ekle');
      return { type: 'todo', title, open: c.open !== false, items: items.map((text) => ({ id: newId(), text, done_by: null, done_at: null })) };
    }
    return null;
  };

  api.post('/messages/:id/interact', auth, (req, res) => {
    const m = q.get('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m || !m.components) fail(404, 'Etkileşimli mesaj bulunamadı');
    const ch = channelAccess(req.user.id, m.channel_id);
    if (limited('interact:' + req.user.id, 30, 10e3)) fail(429, 'Biraz yavaşla');
    const c = JSON.parse(m.components);
    const uid = req.user.id;
    const isOwner = m.author_id === uid || (ch.server_id && has(ch.server_id, uid, P.MANAGE_MESSAGES));
    const { action } = req.body;

    if (c.type === 'poll') {
      if (c.ends_at && c.ends_at < now()) c.closed = true;
      if (action === 'vote') {
        if (c.closed) fail(400, 'Anket kapandı');
        const opt = c.options.find((o) => o.id === String(req.body.option));
        if (!opt) fail(400, 'Seçenek bulunamadı');
        const had = opt.votes.includes(uid);
        if (!c.multi) for (const o of c.options) o.votes = o.votes.filter((v) => v !== uid);
        else opt.votes = opt.votes.filter((v) => v !== uid);
        if (!had) opt.votes.push(uid);
      } else if (action === 'close') {
        if (!isOwner) fail(403, 'Anketi yalnızca sahibi kapatabilir');
        c.closed = true;
      } else fail(400, 'Geçersiz işlem');
    } else if (c.type === 'todo') {
      if (action === 'toggle') {
        const it = c.items.find((i) => i.id === String(req.body.item));
        if (!it) fail(400, 'Madde bulunamadı');
        if (it.done_by && it.done_by !== uid && !isOwner) fail(403, 'Bu maddeyi başkası tamamladı');
        if (it.done_by) { it.done_by = null; it.done_at = null; } else { it.done_by = uid; it.done_at = now(); }
      } else if (action === 'add') {
        if (!c.open && !isOwner) fail(403, 'Bu listeye yalnızca sahibi madde ekleyebilir');
        if (c.items.length >= 50) fail(400, 'Liste dolu (en fazla 50 madde)');
        const text = clean(req.body.text, 200);
        if (!text) fail(400, 'Madde boş olamaz');
        c.items.push({ id: newId(), text, done_by: null, done_at: null, added_by: uid });
      } else if (action === 'remove') {
        const it = c.items.find((i) => i.id === String(req.body.item));
        if (!it) fail(400, 'Madde bulunamadı');
        if (!isOwner && it.added_by !== uid) fail(403, 'Bu maddeyi silemezsin');
        c.items = c.items.filter((i) => i !== it);
      } else fail(400, 'Geçersiz işlem');
    } else fail(400, 'Desteklenmeyen bileşen');

    q.run('UPDATE messages SET components=? WHERE id=?', JSON.stringify(c), m.id);
    const msg = messagePayload(q.get('SELECT * FROM messages WHERE id=?', m.id), ch);
    toChannel(ch, 'MESSAGE_UPDATE', msg);
    res.json(msg);
  });
};
