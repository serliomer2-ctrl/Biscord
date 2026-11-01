'use strict';
// Doğrudan (P2P) dosya aktarımı: dosya sunucuya yüklenmez, gönderenin tarayıcısından alıcıya WebRTC ile akar.
// Sunucu yalnızca teklifi duyurur ve bağlantı kurulumu mesajlarını iletir.

module.exports = (ctx) => {
  const { io, now, newId, clean, channelAccess, channelRooms, publicUser, getUser, limited } = ctx;
  const transfers = new Map(); // id -> { from, channel_id, expires }

  setInterval(() => { for (const [id, t] of transfers) if (t.expires < now()) transfers.delete(id); }, 60e3).unref();

  ctx.hooks.socket.push((socket, uid, safe) => {
    socket.on('p2p:offer', safe((d) => {
      if (limited('p2p:' + uid, 10, 60e3)) ctx.fail(429, 'Çok fazla aktarım başlattın, biraz bekle');
      const ch = channelAccess(uid, String(d?.channel_id));
      const size = Number(d?.file?.size) || 0;
      if (size <= 0 || size > 10 * 1024 ** 3) ctx.fail(400, 'Dosya boyutu geçersiz (en fazla 10 GB)');
      const id = newId();
      const offer = {
        id, channel_id: ch.id, server_id: ch.server_id || null, from: publicUser(getUser(uid)), created_at: now(),
        file: { name: clean(d.file.name, 200) || 'dosya', size, type: clean(d.file.type, 100) },
      };
      transfers.set(id, { from: uid, channel_id: ch.id, expires: now() + 6 * 3600e3 });
      io.to(channelRooms(ch)).emit('dispatch', { t: 'P2P_OFFER', d: offer });
      return { ok: true, id };
    }));

    socket.on('p2p:cancel', safe((d) => {
      const t = transfers.get(String(d?.id));
      if (!t || t.from !== uid) return;
      transfers.delete(String(d.id));
      const ch = channelAccess(uid, t.channel_id);
      io.to(channelRooms(ch)).emit('dispatch', { t: 'P2P_CANCEL', d: { id: String(d.id), channel_id: t.channel_id } });
    }));

    // Bağlantı kurulum mesajları: yalnızca aynı kanala erişimi olan iki kişi arasında
    socket.on('p2p:signal', safe((d) => {
      const t = transfers.get(String(d?.id));
      const to = String(d?.to || '');
      if (!t || !to) return;
      if (uid !== t.from && to !== t.from) return;
      channelAccess(uid, t.channel_id);
      channelAccess(to, t.channel_id);
      io.to('user:' + to).emit('p2p:signal', { id: String(d.id), from: uid, data: d.data });
    }));
  });
};
