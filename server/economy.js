'use strict';
// Sunucu içi Biscord Coin, XP/seviye sistemi ve mağaza

const SHOP = {
  name_color: { name: 'Renkli İsim', price: 500, desc: 'İsmini seçtiğin renge boyar (kalıcı)', input: 'color' },
  title: { name: 'Özel Unvan (7 gün)', price: 300, desc: 'İsminin yanında 7 gün boyunca görünen özel bir unvan', input: 'text' },
  glow: { name: 'Neon Parıltı (7 gün)', price: 700, desc: 'İsmin 7 gün boyunca neon gibi parlar' },
  reset_color: { name: 'İsim Rengini Sıfırla', price: 0, desc: 'Satın aldığın rengi kaldırır, rol rengine döner' },
};
const DAILY = 100;
const WEEK = 7 * 86400e3;

module.exports = (ctx) => {
  const { api, q, auth, fail, clean, now, toServer, memberPayload, requireServerPerm, P, levelOf, createMessage, limited, COLOR_RE } = ctx;

  const enabled = (sid) => !!q.get('SELECT economy FROM servers WHERE id=?', sid)?.economy;
  const row = (sid, uid) => q.get('SELECT * FROM members WHERE server_id=? AND user_id=?', sid, uid);
  const changed = (sid, uid) => toServer(sid, 'MEMBER_UPDATE', { server_id: sid, member: memberPayload(sid, uid) });

  // Mesaj başına (dakikada en fazla bir kez) XP ve coin
  ctx.hooks.message.push((msg, ch, author) => {
    if (!ch.server_id || !author || author.is_bot || msg.type !== 0 || !enabled(ch.server_id)) return;
    const m = row(ch.server_id, author.id);
    if (!m || now() - (m.last_xp_at || 0) < 60e3) return;
    const xp = 15 + Math.floor(Math.random() * 11);
    const coins = 5 + Math.floor(Math.random() * 6);
    const before = levelOf(m.xp).level;
    q.run('UPDATE members SET xp=xp+?, coins=coins+?, last_xp_at=? WHERE server_id=? AND user_id=?', xp, coins, now(), ch.server_id, author.id);
    const after = levelOf((m.xp || 0) + xp).level;
    changed(ch.server_id, author.id);
    if (after > before) {
      const bonus = after * 50;
      q.run('UPDATE members SET coins=coins+? WHERE server_id=? AND user_id=?', bonus, ch.server_id, author.id);
      createMessage(ch, author.id, { type: 8, components: { type: 'levelup', level: after, bonus } });
      changed(ch.server_id, author.id);
    }
  });

  const myStats = (sid, uid) => {
    const m = row(sid, uid);
    const lv = levelOf(m.xp);
    const rank = q.get('SELECT COUNT(*) AS n FROM members WHERE server_id=? AND xp>?', sid, m.xp || 0).n + 1;
    return { xp: m.xp || 0, coins: m.coins || 0, ...lv, rank, daily_ready: now() - (m.last_daily_at || 0) >= 20 * 3600e3, next_daily_at: (m.last_daily_at || 0) + 20 * 3600e3 };
  };

  api.get('/servers/:sid/economy', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    const top = q.all('SELECT user_id, xp, coins FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=? AND u.is_bot=0 ORDER BY xp DESC LIMIT 10', sid)
      .map((r, i) => ({ rank: i + 1, user_id: r.user_id, xp: r.xp, coins: r.coins, level: levelOf(r.xp).level }));
    res.json({ enabled: enabled(sid), me: myStats(sid, req.user.id), leaderboard: top, shop: SHOP, daily: DAILY });
  });

  api.post('/servers/:sid/economy/daily', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    if (!enabled(sid)) fail(400, 'Bu sunucuda ekonomi kapalı');
    const m = row(sid, req.user.id);
    const wait = (m.last_daily_at || 0) + 20 * 3600e3 - now();
    if (wait > 0) fail(400, `Günlük ödülünü zaten aldın. ${Math.ceil(wait / 3600e3)} saat sonra tekrar gel.`);
    q.run('UPDATE members SET coins=coins+?, last_daily_at=? WHERE server_id=? AND user_id=?', DAILY, now(), sid, req.user.id);
    changed(sid, req.user.id);
    res.json({ gained: DAILY, me: myStats(sid, req.user.id) });
  });

  api.post('/servers/:sid/economy/buy', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    if (!enabled(sid)) fail(400, 'Bu sunucuda ekonomi kapalı');
    const item = SHOP[req.body.item];
    if (!item) fail(400, 'Ürün bulunamadı');
    const m = row(sid, req.user.id);
    if ((m.coins || 0) < item.price) fail(400, `Yeterli coinin yok (${item.price} gerekli, ${m.coins || 0} var)`);
    const t = now();
    if (req.body.item === 'name_color') {
      if (!COLOR_RE.test(req.body.value || '')) fail(400, 'Geçerli bir renk seç');
      q.run('UPDATE members SET name_color=? WHERE server_id=? AND user_id=?', req.body.value, sid, req.user.id);
    } else if (req.body.item === 'title') {
      const title = clean(req.body.value, 24);
      if (!title) fail(400, 'Unvan boş olamaz');
      const base = m.title_until && m.title_until > t ? m.title_until : t;
      q.run('UPDATE members SET title=?, title_until=? WHERE server_id=? AND user_id=?', title, base + WEEK, sid, req.user.id);
    } else if (req.body.item === 'glow') {
      const base = m.glow_until && m.glow_until > t ? m.glow_until : t;
      q.run('UPDATE members SET glow_until=? WHERE server_id=? AND user_id=?', base + WEEK, sid, req.user.id);
    } else if (req.body.item === 'reset_color') {
      q.run('UPDATE members SET name_color=NULL WHERE server_id=? AND user_id=?', sid, req.user.id);
    }
    q.run('UPDATE members SET coins=coins-? WHERE server_id=? AND user_id=?', item.price, sid, req.user.id);
    changed(sid, req.user.id);
    res.json({ ok: true, me: myStats(sid, req.user.id) });
  });

  api.post('/servers/:sid/economy/pay', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    if (!enabled(sid)) fail(400, 'Bu sunucuda ekonomi kapalı');
    if (limited('pay:' + req.user.id, 10, 60e3)) fail(429, 'Biraz yavaşla');
    const to = String(req.body.user_id || '');
    const amount = Math.trunc(Number(req.body.amount) || 0);
    if (to === req.user.id) fail(400, 'Kendine coin gönderemezsin');
    if (!row(sid, to)) fail(404, 'Üye bulunamadı');
    if (amount < 1) fail(400, 'Geçerli bir miktar gir');
    const m = row(sid, req.user.id);
    if ((m.coins || 0) < amount) fail(400, 'Yeterli coinin yok');
    ctx.tx(() => {
      q.run('UPDATE members SET coins=coins-? WHERE server_id=? AND user_id=?', amount, sid, req.user.id);
      q.run('UPDATE members SET coins=coins+? WHERE server_id=? AND user_id=?', amount, sid, to);
    });
    changed(sid, req.user.id);
    changed(sid, to);
    res.json({ ok: true, me: myStats(sid, req.user.id) });
  });

  // Sunucu yöneticileri coin verebilir/alabilir
  api.post('/servers/:sid/economy/grant', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
    const to = String(req.body.user_id || '');
    const amount = Math.trunc(Number(req.body.amount) || 0);
    if (!row(sid, to)) fail(404, 'Üye bulunamadı');
    q.run('UPDATE members SET coins=MAX(0, coins+?) WHERE server_id=? AND user_id=?', amount, sid, to);
    changed(sid, to);
    res.json({ ok: true });
  });
};
