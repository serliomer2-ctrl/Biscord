'use strict';
// Sunucu ses efekt paneli: üyeler kısa sesler yükler, ses kanalında çalar
const fs = require('fs');
const multer = require('multer');

module.exports = (ctx) => {
  const { api, q, auth, fail, clean, newId, now, requireServerPerm, has, P, toServer, publicUser, getUser } = ctx;

  const soundUpload = multer({
    storage: multer.diskStorage({
      destination: ctx.UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, `snd_${newId()}${/\.(mp3|ogg|wav|webm|m4a)$/i.exec(file.originalname)?.[0]?.toLowerCase() || '.webm'}`),
    }),
    limits: { fileSize: 1024 * 1024, files: 1 },
    fileFilter: (req, f, cb) => cb(null, /^audio\//.test(f.mimetype) || /^video\/webm/.test(f.mimetype)),
  });

  const view = (s) => ({ ...s, user: s.user_id ? publicUser(getUser(s.user_id)) : null });

  api.get('/servers/:sid/sounds', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id);
    res.json(q.all('SELECT * FROM soundboard WHERE server_id=? ORDER BY created_at', req.params.sid).map(view));
  });

  api.post('/servers/:sid/sounds', auth, soundUpload.single('file'), (req, res) => {
    const sid = req.params.sid;
    const cleanup = () => req.file && fs.unlink(req.file.path, () => {});
    try {
      requireServerPerm(sid, req.user.id, P.ATTACH_FILES);
      if (!req.file) fail(400, 'Bir ses dosyası seç (en fazla 1 MB)');
      if (q.get('SELECT COUNT(*) AS n FROM soundboard WHERE server_id=?', sid).n >= 48) fail(400, 'Bu sunucunun ses paneli dolu (en fazla 48 ses)');
      const name = clean(req.body.name, 32) || 'Ses';
      const id = newId();
      q.run('INSERT INTO soundboard(id,server_id,user_id,name,emoji,url,created_at) VALUES(?,?,?,?,?,?,?)',
        id, sid, req.user.id, name, clean(req.body.emoji, 16) || '🔊', '/uploads/' + req.file.filename, now());
      const s = view(q.get('SELECT * FROM soundboard WHERE id=?', id));
      toServer(sid, 'SOUND_CREATE', s);
      res.json(s);
    } catch (e) { cleanup(); throw e; }
  });

  api.delete('/sounds/:id', auth, (req, res) => {
    const s = q.get('SELECT * FROM soundboard WHERE id=?', req.params.id);
    if (!s) fail(404, 'Ses bulunamadı');
    requireServerPerm(s.server_id, req.user.id);
    if (s.user_id !== req.user.id && !has(s.server_id, req.user.id, P.MANAGE_SERVER)) fail(403, 'Bu sesi silemezsin');
    q.run('DELETE FROM soundboard WHERE id=?', s.id);
    fs.unlink(require('path').join(ctx.UPLOAD_DIR, require('path').basename(s.url)), () => {});
    toServer(s.server_id, 'SOUND_DELETE', { id: s.id, server_id: s.server_id });
    res.json({ ok: true });
  });

  // Kim hangi sesi çaldı: ses kanalındakilere küçük bir bilgi gösterilir (ses WebRTC ile zaten gider)
  ctx.hooks.socket.push((socket, uid, safe) => {
    socket.on('sound:played', safe((d) => {
      const v = ctx.voice.get(uid);
      if (!v || ctx.limited('snd:' + uid, 8, 10e3)) return;
      socket.to('voice:' + v.channel_id).emit('dispatch', { t: 'SOUND_PLAYED', d: { user_id: uid, channel_id: v.channel_id, name: clean(d?.name, 32), emoji: clean(d?.emoji, 16) } });
    }));
  });
};
