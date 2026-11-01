'use strict';
// Hayalet kanallar: şifreyle açılır, listede görünmez, mesajlar hiçbir yere kaydedilmez (yalnızca o an içeride olanlara iletilir)

module.exports = (ctx) => {
  const { api, q, io, auth, fail, ah, bcrypt, newId, now, limited, ghostAccess, publicUser, publicChannel, requireServerPerm, isMember, P } = ctx;

  const presenceList = (cid) => [...(ghostAccess.get(cid) || [])];
  const announce = (cid) => io.to('ghost:' + cid).emit('dispatch', { t: 'GHOST_PRESENCE', d: { channel_id: cid, users: presenceList(cid) } });

  ctx.ghostUnlock = (ch, uid) => {
    if (!ghostAccess.has(ch.id)) ghostAccess.set(ch.id, new Set());
    ghostAccess.get(ch.id).add(uid);
    io.in('user:' + uid).socketsJoin('ghost:' + ch.id);
    ctx.toUser(uid, 'GHOST_OPEN', publicChannel(ch));
    announce(ch.id);
  };

  const lock = (cid, uid) => {
    const set = ghostAccess.get(cid);
    if (!set?.delete(uid)) return;
    io.in('user:' + uid).socketsLeave('ghost:' + cid);
    ctx.toUser(uid, 'GHOST_CLOSE', { channel_id: cid });
    if (!set.size) ghostAccess.delete(cid);
    else announce(cid);
  };

  ctx.ghostSend = (ch, user, content) => {
    const msg = {
      id: newId(), channel_id: ch.id, server_id: ch.server_id, author: publicUser(user), content, type: 0,
      attachments: [], embeds: [], components: null, mentions: [], mention_everyone: false, reply_to: null, referenced: null,
      pinned: false, edited_at: null, created_at: now(), reactions: [], ghost: true,
    };
    io.to('ghost:' + ch.id).emit('dispatch', { t: 'MESSAGE_CREATE', d: msg });
    return msg;
  };

  api.post('/servers/:sid/ghost/unlock', auth, ah(async (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    if (limited('ghost:' + req.user.id, 8, 60e3)) fail(429, 'Çok fazla deneme, bir dakika bekle');
    const pw = String(req.body.password || '');
    for (const ch of q.all("SELECT * FROM channels WHERE server_id=? AND type='ghost'", sid)) {
      if (ch.password_hash && await bcrypt.compare(pw, ch.password_hash)) {
        ctx.ghostUnlock(ch, req.user.id);
        return res.json(publicChannel(ch));
      }
    }
    fail(404, 'Bu şifreyle açılan bir hayalet kanal yok');
  }));

  api.post('/channels/:id/ghost/leave', auth, (req, res) => {
    lock(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // Yöneticiler için hayalet kanal listesi (şifreler gösterilmez)
  api.get('/servers/:sid/ghosts', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id, P.MANAGE_CHANNELS);
    res.json(q.all("SELECT * FROM channels WHERE server_id=? AND type='ghost'", req.params.sid)
      .map((c) => ({ ...publicChannel(c), active: presenceList(c.id).length })));
  });

  api.delete('/servers/:sid/ghosts/:cid', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id, P.MANAGE_CHANNELS);
    const ch = q.get("SELECT * FROM channels WHERE id=? AND server_id=? AND type='ghost'", req.params.cid, req.params.sid);
    if (!ch) fail(404, 'Kanal bulunamadı');
    io.to('ghost:' + ch.id).emit('dispatch', { t: 'GHOST_CLOSE', d: { channel_id: ch.id } });
    io.in('ghost:' + ch.id).socketsLeave('ghost:' + ch.id);
    ghostAccess.delete(ch.id);
    q.run('DELETE FROM channels WHERE id=?', ch.id);
    res.json({ ok: true });
  });

  // Yeniden bağlanınca açık hayalet kanallara tekrar katıl; tüm oturumlar kapanınca kanaldan çık
  ctx.hooks.socket.push((socket, uid) => {
    for (const [cid, set] of ghostAccess) if (set.has(uid)) socket.join('ghost:' + cid);
    socket.on('disconnect', () => setTimeout(() => {
      if (ctx.online.has(uid)) return; // başka sekmesi hâlâ açık
      for (const [cid, set] of [...ghostAccess]) if (set.has(uid)) lock(cid, uid);
    }, 0));
  });

  ctx.hooks.ready.push((ready, uid) => {
    ready.ghosts = [];
    for (const [cid, set] of ghostAccess) {
      if (!set.has(uid)) continue;
      const ch = q.get('SELECT * FROM channels WHERE id=?', cid);
      if (ch && isMember(ch.server_id, uid)) ready.ghosts.push(publicChannel(ch));
    }
  });
};
