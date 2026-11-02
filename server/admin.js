'use strict';
// Site yönetim paneli: istatistikler, kullanıcı yasaklama/susturma, sunucu ve mesaj denetimi, duyurular
const fs = require('fs');
const path = require('path');

module.exports = (ctx) => {
  const { api, q, io, bcrypt, now, rand, clean, fail, ah, auth, getUser, publicUser, settings, audit, toUser } = ctx;

  // ---------------------------------------------------------------- yönetici hesabı
  // Görünen ad ADMIN_USERNAME ile aynıdır; kullanıcı adı küçük harfle saklanır (giriş büyük/küçük harf duyarsızdır).
  // Şifre koda yazılmaz: ADMIN_PASSWORD ortam değişkeninden gelir. Verilmezse geçici "admin" şifresi
  // oluşturulur ve ilk girişte değiştirilmesi zorunlu olur.
  {
    const display = (process.env.ADMIN_USERNAME || 'Adminolmakben').trim().slice(0, 32);
    const name = display.toLowerCase();
    const pw = process.env.ADMIN_PASSWORD;
    const ex = q.get('SELECT * FROM users WHERE username=?', name);
    if (ex && !ex.is_admin) {
      console.warn(`[yönetici] "${name}" kullanıcı adı normal bir hesapta; yönetici yapılmadı.`);
    } else if (!ex && (pw || !q.get('SELECT 1 FROM users WHERE is_admin=1'))) {
      q.run('INSERT INTO users(id,username,password_hash,display_name,is_admin,must_change_password,created_at) VALUES(?,?,?,?,1,?,?)',
        ctx.newId(), name, bcrypt.hashSync(pw || 'admin', 10), display, pw ? 0 : 1, now());
      console.log(`\n  [yönetici] "${display}" hesabı oluşturuldu (${pw ? 'şifre: ADMIN_PASSWORD' : 'geçici şifre: admin — ilk girişte değiştirilmeli'})\n`);
    }
  }

  const requireAdmin = [auth, (req, res, next) => (req.user.is_admin ? next() : res.status(403).json({ error: 'Yönetici yetkisi gerekli' }))];

  const disconnectUser = (uid) => {
    if (ctx.voice.has(uid)) ctx.leaveVoice(uid, true);
    for (const sid of ctx.online.get(uid) || []) io.sockets.sockets.get(sid)?.disconnect(true);
  };

  const target = (req) => {
    const u = getUser(req.params.id);
    if (!u) fail(404, 'Kullanıcı bulunamadı');
    if (u.id === req.user.id && req.method !== 'GET') fail(400, 'Bu işlemi kendi hesabına uygulayamazsın');
    return u;
  };

  const adminView = (u) => ({
    ...publicUser(u),
    email: u.email, email_verified: !!u.email_verified, banned: !!u.banned, ban_reason: u.ban_reason,
    muted_until: u.muted_until && u.muted_until > now() ? u.muted_until : null,
    mfa: !!(u.totp_enabled || u.email_2fa), bot_owner_id: u.bot_owner_id,
    servers: q.get('SELECT COUNT(*) AS n FROM members WHERE user_id=?', u.id).n,
    messages: q.get('SELECT COUNT(*) AS n FROM messages WHERE author_id=?', u.id).n,
  });

  function dirSize(dir) {
    let total = 0;
    try { for (const f of fs.readdirSync(dir)) { try { total += fs.statSync(path.join(dir, f)).size; } catch { /* yok */ } } } catch { /* yok */ }
    return total;
  }

  // ---------------------------------------------------------------- istatistikler
  api.get('/admin/stats', ...requireAdmin, (req, res) => {
    const c = (sql) => q.get(sql).n;
    res.json({
      users: c('SELECT COUNT(*) AS n FROM users WHERE is_bot=0'),
      bots: c('SELECT COUNT(*) AS n FROM users WHERE is_bot=1'),
      banned: c('SELECT COUNT(*) AS n FROM users WHERE banned=1'),
      servers: c('SELECT COUNT(*) AS n FROM servers'),
      channels: c("SELECT COUNT(*) AS n FROM channels WHERE type!='dm'"),
      messages: c('SELECT COUNT(*) AS n FROM messages'),
      messages_24h: q.get('SELECT COUNT(*) AS n FROM messages WHERE created_at>?', now() - 86400e3).n,
      new_users_7d: q.get('SELECT COUNT(*) AS n FROM users WHERE created_at>? AND is_bot=0', now() - 7 * 86400e3).n,
      online: ctx.online.size,
      in_voice: ctx.voice.size,
      uploads_bytes: dirSize(ctx.UPLOAD_DIR),
      uptime_s: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      mail_configured: ctx.mail.configured,
      registration: settings.get('registration', 'open'),
    });
  });

  // ---------------------------------------------------------------- kullanıcılar
  api.get('/admin/users', ...requireAdmin, (req, res) => {
    const s = clean(req.query.q, 64).toLowerCase();
    const filter = String(req.query.filter || '');
    let where = 'WHERE 1=1';
    const args = [];
    if (s) { where += ' AND (lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ? OR id=?)'; args.push(`%${s}%`, `%${s}%`, `%${s}%`, s); }
    if (filter === 'banned') where += ' AND banned=1';
    if (filter === 'muted') { where += ' AND muted_until>?'; args.push(now()); }
    if (filter === 'admins') where += ' AND is_admin=1';
    if (filter === 'bots') where += ' AND is_bot=1';
    const rows = q.all(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT 100`, ...args);
    res.json(rows.map(adminView));
  });

  api.post('/admin/users/:id/ban', ...requireAdmin, (req, res) => {
    const u = target(req);
    if (u.is_admin) fail(400, 'Önce yönetici yetkisini kaldır');
    const reason = clean(req.body.reason, 256) || null;
    q.run('UPDATE users SET banned=1, ban_reason=? WHERE id=?', reason, u.id);
    q.run('DELETE FROM sessions WHERE user_id=?', u.id);
    disconnectUser(u.id);
    audit(req.user.id, 'user.ban', u.id, { reason });
    res.json(adminView(getUser(u.id)));
  });

  api.post('/admin/users/:id/unban', ...requireAdmin, (req, res) => {
    const u = target(req);
    q.run('UPDATE users SET banned=0, ban_reason=NULL WHERE id=?', u.id);
    audit(req.user.id, 'user.unban', u.id);
    res.json(adminView(getUser(u.id)));
  });

  api.post('/admin/users/:id/mute', ...requireAdmin, (req, res) => {
    const u = target(req);
    const minutes = Math.max(1, Math.min(60 * 24 * 365, Number(req.body.minutes) || 60));
    const until = now() + minutes * 60e3;
    q.run('UPDATE users SET muted_until=? WHERE id=?', until, u.id);
    const v = ctx.voice.get(u.id);
    if (v) { v.server_mute = true; ctx.emitVoice(v); }
    toUser(u.id, 'ME_UPDATE', { ...ctx.myUser(getUser(u.id)), muted_until: until });
    toUser(u.id, 'NOTICE', { level: 'warn', text: `Bir yönetici seni ${minutes} dakika susturdu.${req.body.reason ? ' Sebep: ' + clean(req.body.reason, 200) : ''}` });
    audit(req.user.id, 'user.mute', u.id, { minutes, reason: clean(req.body.reason, 200) || null });
    res.json(adminView(getUser(u.id)));
  });

  api.post('/admin/users/:id/unmute', ...requireAdmin, (req, res) => {
    const u = target(req);
    q.run('UPDATE users SET muted_until=NULL WHERE id=?', u.id);
    const v = ctx.voice.get(u.id);
    if (v) { v.server_mute = false; ctx.emitVoice(v); }
    toUser(u.id, 'ME_UPDATE', { ...ctx.myUser(getUser(u.id)), muted_until: null });
    toUser(u.id, 'NOTICE', { level: 'info', text: 'Susturman kaldırıldı.' });
    audit(req.user.id, 'user.unmute', u.id);
    res.json(adminView(getUser(u.id)));
  });

  api.post('/admin/users/:id/admin', ...requireAdmin, (req, res) => {
    const u = target(req);
    if (u.is_bot) fail(400, 'Botlar yönetici olamaz');
    q.run('UPDATE users SET is_admin=? WHERE id=?', req.body.value ? 1 : 0, u.id);
    audit(req.user.id, req.body.value ? 'user.admin.grant' : 'user.admin.revoke', u.id);
    ctx.broadcastUser(u.id);
    res.json(adminView(getUser(u.id)));
  });

  api.post('/admin/users/:id/reset-password', ...requireAdmin, ah(async (req, res) => {
    const u = target(req);
    if (u.is_bot) fail(400, 'Botların şifresi yoktur');
    const temp = rand(9).replace(/[-_]/g, 'x').slice(0, 12);
    q.run('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?', await bcrypt.hash(temp, 10), u.id);
    q.run('DELETE FROM sessions WHERE user_id=?', u.id);
    disconnectUser(u.id);
    audit(req.user.id, 'user.reset_password', u.id);
    res.json({ temp_password: temp });
  }));

  api.post('/admin/users/:id/disable-2fa', ...requireAdmin, (req, res) => {
    const u = target(req);
    q.run("UPDATE users SET totp_enabled=0, totp_secret=NULL, email_2fa=0, backup_codes='[]' WHERE id=?", u.id);
    audit(req.user.id, 'user.disable_2fa', u.id);
    res.json(adminView(getUser(u.id)));
  });

  api.delete('/admin/users/:id', ...requireAdmin, (req, res) => {
    const u = target(req);
    if (u.is_admin) fail(400, 'Önce yönetici yetkisini kaldır');
    ctx.deleteAccount(u.id);
    audit(req.user.id, 'user.delete', u.id, { username: u.username });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- sunucular
  function deleteServer(sid) {
    for (const v of [...ctx.voice.values()]) if (v.server_id === sid) ctx.leaveVoice(v.user_id, true);
    ctx.toServer(sid, 'SERVER_DELETE', { id: sid });
    io.in('server:' + sid).socketsLeave('server:' + sid);
    q.run('DELETE FROM servers WHERE id=?', sid);
  }

  // Bir hesabı tüm izleriyle sil (yönetici paneli ve kullanıcının kendi hesap silmesi kullanır)
  ctx.deleteAccount = (uid) => {
    disconnectUser(uid);
    for (const s of q.all('SELECT id FROM servers WHERE owner_id=?', uid)) deleteServer(s.id);
    for (const r of q.all('SELECT server_id FROM members WHERE user_id=?', uid)) ctx.removeMember(r.server_id, uid);
    for (const b of q.all('SELECT id FROM users WHERE bot_owner_id=?', uid)) { disconnectUser(b.id); q.run('DELETE FROM users WHERE id=?', b.id); }
    q.run('DELETE FROM users WHERE id=?', uid);
  };

  api.get('/admin/servers', ...requireAdmin, (req, res) => {
    const s = clean(req.query.q, 64).toLowerCase();
    const rows = s
      ? q.all('SELECT * FROM servers WHERE lower(name) LIKE ? OR id=? ORDER BY created_at DESC LIMIT 100', `%${s}%`, s)
      : q.all('SELECT * FROM servers ORDER BY created_at DESC LIMIT 100');
    res.json(rows.map((sv) => ({
      ...sv,
      owner: publicUser(getUser(sv.owner_id)),
      members: q.get('SELECT COUNT(*) AS n FROM members WHERE server_id=?', sv.id).n,
      messages: q.get('SELECT COUNT(*) AS n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.server_id=?', sv.id).n,
    })));
  });

  api.delete('/admin/servers/:sid', ...requireAdmin, (req, res) => {
    const s = q.get('SELECT * FROM servers WHERE id=?', req.params.sid);
    if (!s) fail(404, 'Sunucu bulunamadı');
    deleteServer(s.id);
    audit(req.user.id, 'server.delete', s.id, { name: s.name });
    res.json({ ok: true });
  });

  api.post('/admin/servers/:sid/coins', ...requireAdmin, (req, res) => {
    const amount = Math.trunc(Number(req.body.amount) || 0);
    const m = q.get('SELECT 1 FROM members WHERE server_id=? AND user_id=?', req.params.sid, String(req.body.user_id || ''));
    if (!m) fail(404, 'Üye bulunamadı');
    q.run('UPDATE members SET coins=MAX(0, coins+?) WHERE server_id=? AND user_id=?', amount, req.params.sid, req.body.user_id);
    ctx.toServer(req.params.sid, 'MEMBER_UPDATE', { server_id: req.params.sid, member: ctx.memberPayload(req.params.sid, req.body.user_id) });
    audit(req.user.id, 'economy.grant', req.body.user_id, { server_id: req.params.sid, amount });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- mesaj denetimi
  api.get('/admin/messages', ...requireAdmin, (req, res) => {
    const s = clean(req.query.q, 200);
    const author = clean(req.query.author, 32);
    let rows;
    if (author) rows = q.all('SELECT * FROM messages WHERE author_id=? ORDER BY rowid DESC LIMIT 100', author);
    else if (s) rows = q.all("SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\' ORDER BY rowid DESC LIMIT 100", '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
    else rows = q.all('SELECT * FROM messages ORDER BY rowid DESC LIMIT 100');
    res.json(rows.map((m) => {
      const ch = q.get('SELECT id, name, type, server_id FROM channels WHERE id=?', m.channel_id);
      return { ...ctx.messagePayload(m, ch), channel: ch, server: ch?.server_id ? q.get('SELECT id, name FROM servers WHERE id=?', ch.server_id) : null };
    }));
  });

  api.delete('/admin/messages/:id', ...requireAdmin, (req, res) => {
    const m = q.get('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m) fail(404, 'Mesaj bulunamadı');
    const ch = q.get('SELECT * FROM channels WHERE id=?', m.channel_id);
    ctx.deleteMessage(m, ch);
    audit(req.user.id, 'message.delete', m.id, { author: m.author_id, content: m.content.slice(0, 200) });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- kayıtlar ve ayarlar
  api.get('/admin/audit', ...requireAdmin, (req, res) => {
    res.json(q.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').map((a) => ({
      ...a, details: a.details ? JSON.parse(a.details) : null,
      actor: publicUser(getUser(a.actor_id)), target_user: a.target ? publicUser(getUser(a.target)) : null,
    })));
  });

  const announcement = () => {
    const text = settings.get('announcement');
    return text ? { text, level: settings.get('announcement_level', 'info'), at: Number(settings.get('announcement_at', 0)) } : null;
  };

  api.get('/admin/settings', ...requireAdmin, (req, res) => {
    res.json({ registration: settings.get('registration', 'open'), announcement: announcement(), mail_configured: ctx.mail.configured });
  });

  api.patch('/admin/settings', ...requireAdmin, (req, res) => {
    if (req.body.registration !== undefined) {
      settings.set('registration', req.body.registration === 'closed' ? 'closed' : 'open');
      audit(req.user.id, 'settings.registration', null, { value: req.body.registration });
    }
    if (req.body.announcement !== undefined) {
      const text = clean(req.body.announcement, 500);
      settings.set('announcement', text || null);
      settings.set('announcement_level', ['info', 'warn', 'success'].includes(req.body.level) ? req.body.level : 'info');
      settings.set('announcement_at', now());
      io.emit('dispatch', { t: 'ANNOUNCEMENT', d: announcement() });
      audit(req.user.id, 'settings.announcement', null, { text });
    }
    res.json({ registration: settings.get('registration', 'open'), announcement: announcement() });
  });

  api.post('/admin/test-email', ...requireAdmin, ah(async (req, res) => {
    const to = clean(req.body.to, 254) || req.user.email;
    if (!to) fail(400, 'Alıcı e-posta adresi gir');
    const v = await ctx.mail.verify();
    if (!v.ok) fail(400, 'SMTP bağlantısı başarısız: ' + v.error);
    await ctx.mail.send(to, 'Biscord test e-postası', 'Bu bir test e-postasıdır. SMTP ayarların çalışıyor! 🎉');
    res.json({ ok: true });
  }));

  api.get('/settings/public', (req, res) => res.json({ registration: settings.get('registration', 'open'), announcement: announcement() }));

  ctx.hooks.ready.push((ready) => { ready.announcement = announcement(); });
};
