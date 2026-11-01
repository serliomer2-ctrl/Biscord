'use strict';
// Anlık bildirimler (Web Push). Uygulama/sekme kapalıyken DM, bahsetme ve aramaları telefona/bilgisayara iletir.
const webpush = require('web-push');

module.exports = (ctx) => {
  const { api, q, auth, settings, now, fail, getUser } = ctx;

  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    pub = settings.get('vapid_public');
    priv = settings.get('vapid_private');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      settings.set('vapid_public', pub);
      settings.set('vapid_private', priv);
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || process.env.SITE_URL || 'mailto:admin@biscord.local', pub, priv);

  api.get('/push/key', (req, res) => res.json({ key: pub }));

  api.post('/push/subscribe', auth, (req, res) => {
    const s = req.body?.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) fail(400, 'Geçersiz abonelik');
    if (s.endpoint.length > 1000) fail(400, 'Geçersiz abonelik');
    q.run('INSERT OR REPLACE INTO push_subs(endpoint,user_id,p256dh,auth,created_at) VALUES(?,?,?,?,?)',
      s.endpoint, req.user.id, String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), now());
    res.json({ ok: true });
  });

  api.post('/push/unsubscribe', auth, (req, res) => {
    q.run('DELETE FROM push_subs WHERE endpoint=? AND user_id=?', String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  // Kullanıcının hiçbir açık oturumu yoksa (uygulama kapalı) bildirimi gönder
  ctx.push = (uid, payload, { force = false } = {}) => {
    if (!force && ctx.online.has(uid)) return;
    const u = getUser(uid);
    if (!u || u.is_bot || u.status === 'dnd') return;
    for (const s of q.all('SELECT * FROM push_subs WHERE user_id=?', uid)) {
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 })
        .catch((e) => {
          if (e.statusCode === 404 || e.statusCode === 410) q.run('DELETE FROM push_subs WHERE endpoint=?', s.endpoint);
        });
    }
  };

  ctx.hooks.message.push((msg, ch, author) => {
    if (!author || msg.type !== 0 || ch.type === 'ghost') return;
    const name = author.display_name || author.username;
    const body = (msg.content || (msg.attachments.length ? '📎 Ek gönderdi' : msg.components ? '📊 Etkileşimli mesaj' : '')).slice(0, 140);
    const url = `/channels/${ch.server_id || '@me'}/${ch.id}`;
    const targets = new Set();
    if (!ch.server_id) {
      for (const uid of ctx.dmRecipients(ch.id)) if (uid !== author.id) targets.add(uid);
    } else {
      for (const uid of msg.mentions) targets.add(uid);
      if (msg.referenced?.author?.id) targets.add(msg.referenced.author.id);
      targets.delete(author.id);
    }
    if (!targets.size) return;
    const srv = ch.server_id && q.get('SELECT name FROM servers WHERE id=?', ch.server_id);
    const title = ch.server_id ? `${name} (#${ch.name}, ${srv?.name || ''})` : name;
    for (const uid of targets) ctx.push(uid, { title, body, url, tag: ch.id, icon: author.avatar || '/icons/icon-192.png' });
  });
};
