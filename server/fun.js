'use strict';
// Eğlence özellikleri: boss savaşı, sunucu maskotu, rus ruleti, nadir (lootbox) mesajlar, anonim itiraf,
// kendini imha eden mesajlar, doodle botlar, ses kanalı akustiği/çığlık ölçer, kaos komutları, canlı imleçler, ping radarı
const crypto = require('crypto');

const BOSSES = [
  { name: 'Kızıl Ejderha', emoji: '🐉', hp: 10000 },
  { name: 'Derin Kraken', emoji: '🐙', hp: 8000 },
  { name: 'Robot Titan', emoji: '🤖', hp: 12000 },
  { name: 'Goblin Kral', emoji: '👺', hp: 5000 },
  { name: 'Hayalet Lord', emoji: '👻', hp: 7500 },
];
const PETS = [['🐱', 'Kedi'], ['🐶', 'Köpek'], ['🐉', 'Ejder'], ['🐸', 'Kurbağa'], ['🦊', 'Tilki'], ['🐼', 'Panda'], ['🐧', 'Penguen'], ['🦖', 'Dino']];
const ACOUSTICS = ['none', 'cathedral', 'underwater', 'parking', 'cave', 'bathroom'];
const ALPHABETS = ['morse', 'binary', 'rune', 'emoji'];

module.exports = (ctx) => {
  const { api, q, io, auth, fail, clean, newId, now, limited, has, P, getUser, publicUser, channelAccess, requireServerPerm, toServer, toChannel, messagePayload, memberPayload, createMessage } = ctx;

  const sysUser = (key, username, display, about) => {
    let id = ctx.settings.get(key);
    if (!id || !getUser(id)) {
      id = newId();
      let name = username;
      if (q.get('SELECT 1 FROM users WHERE username=?', name)) name += '_' + id.slice(-4);
      q.run("INSERT INTO users(id,username,display_name,is_bot,status,about,created_at) VALUES(?,?,?,1,'online',?,?)", id, name, display, about, now());
      ctx.settings.set(key, id);
    }
    return id;
  };

  // ---------------------------------------------------------------- anonim itiraf kanalları
  ctx.anonUserId = sysUser('anon_user_id', 'biscord_anonim', 'Anonim', 'İtiraf kanallarındaki mesajlar bu hesapla gösterilir; gerçek yazar saklanmaz.');
  ctx.anonMask = (c) => {
    const code = `Ajan-${crypto.randomInt(100, 1000)}`;
    const hue = crypto.randomInt(0, 360);
    return { ...(c || { type: 'anon' }), anon: { code, color: `hsl(${hue} 70% 62%)` } };
  };

  // ---------------------------------------------------------------- yeni mesaj bileşenleri
  const baseSanitize = ctx.sanitizeComponents;
  ctx.sanitizeComponents = (raw) => {
    let c = raw;
    if (typeof raw === 'string') { try { c = JSON.parse(raw); } catch { return null; } }
    if (c?.type === 'fx') return { type: 'fx', style: ['glitch', 'hype', 'matrix'].includes(c.style) ? c.style : 'glitch' };
    if (c?.type === 'cipher') {
      const b64 = (s, max) => (typeof s === 'string' && /^[A-Za-z0-9+/=]*$/.test(s) && s.length <= max ? s : fail(400, 'Geçersiz şifreli mesaj'));
      return { type: 'cipher', alphabet: ALPHABETS.includes(c.alphabet) ? c.alphabet : 'binary', ct: b64(c.ct, 12000), iv: b64(c.iv, 64), salt: b64(c.salt, 64), hint: clean(c.hint, 64) || null };
    }
    if (c?.type === 'roulette') {
      const question = clean(c.question, 200) || 'Kim yanacak? 🎲';
      return { type: 'roulette', question, players: [], status: 'open', result: null };
    }
    return baseSanitize(c);
  };

  // ---------------------------------------------------------------- nadir mesajlar (%1)
  ctx.rollRarity = (user, ch) => {
    if (user.is_bot || ch.anon) return null;
    const r = Math.random();
    const rarity = r < 0.0015 ? 'holo' : r < 0.005 ? 'rainbow' : r < 0.01 ? 'gold' : null;
    if (rarity) {
      const col = (() => { try { return JSON.parse(user.rare_collection || '{}'); } catch { return {}; } })();
      col[rarity] = (col[rarity] || 0) + 1;
      q.run('UPDATE users SET rare_collection=? WHERE id=?', JSON.stringify(col), user.id);
      setImmediate(() => ctx.broadcastUser(user.id));
    }
    return rarity;
  };

  // ---------------------------------------------------------------- kendini imha eden mesajlar
  setInterval(() => {
    for (const m of q.all('SELECT * FROM messages WHERE expires_at>0 AND expires_at<=? LIMIT 200', now())) {
      const ch = q.get('SELECT * FROM channels WHERE id=?', m.channel_id);
      if (ch) ctx.deleteMessage(m, ch);
    }
  }, 1000).unref();

  // ---------------------------------------------------------------- etkinlikler için resim yükleme (masaüstü, çizim)
  api.post('/uploads/image', auth, ctx.imageUpload.single('file'), (req, res) => {
    if (!req.file) fail(400, 'Geçerli bir resim yükle (png, jpg, gif, webp — en fazla 8 MB)');
    if (limited('img:' + req.user.id, 20, 60e3)) fail(429, 'Çok fazla yükleme, biraz bekle');
    res.json({ url: '/uploads/' + req.file.filename });
  });

  // ---------------------------------------------------------------- profil efektleri
  api.post('/users/@me/profile-fx', auth, (req, res) => {
    const b = req.body || {};
    const fx = {
      frame: ['none', 'glitch', 'neon', 'fire', 'rainbow', 'matrix'].includes(b.frame) ? b.frame : 'none',
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#00ffd5',
      music: ['none', 'adventure', 'dungeon', 'arcade', 'chill'].includes(b.music) ? b.music : 'none',
      scanlines: !!b.scanlines,
    };
    q.run('UPDATE users SET profile_fx=? WHERE id=?', JSON.stringify(fx), req.user.id);
    ctx.broadcastUser(req.user.id);
    res.json(fx);
  });

  // ---------------------------------------------------------------- rus ruleti
  const PENALTIES = [
    { key: 'duck', text: '🦆 10 dakikalığına ördeğe dönüştü!' },
    { key: 'timeout', text: '🚪 1 dakikalığına sohbetten atıldı!' },
    { key: 'censor', text: '███ 5 dakika boyunca mesajları sansürlenecek!' },
  ];
  function spin(m, ch, c) {
    const loser = c.players[crypto.randomInt(0, c.players.length)];
    const pen = PENALTIES[crypto.randomInt(0, PENALTIES.length)];
    const t = now();
    if (pen.key === 'duck') q.run('UPDATE members SET duck_until=? WHERE server_id=? AND user_id=?', t + 10 * 60e3, ch.server_id, loser);
    if (pen.key === 'timeout' && !has(ch.server_id, loser, P.MANAGE_MESSAGES)) q.run('UPDATE members SET timeout_until=? WHERE server_id=? AND user_id=?', t + 60e3, ch.server_id, loser);
    if (pen.key === 'censor') q.run('UPDATE members SET censor_until=? WHERE server_id=? AND user_id=?', t + 5 * 60e3, ch.server_id, loser);
    c.status = 'done';
    c.result = { loser, penalty: pen.key, text: pen.text, at: t };
    toServer(ch.server_id, 'MEMBER_UPDATE', { server_id: ch.server_id, member: memberPayload(ch.server_id, loser) });
  }

  api.post('/messages/:id/roulette', auth, (req, res) => {
    const m = q.get('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m?.components) fail(404, 'Rulet bulunamadı');
    const ch = channelAccess(req.user.id, m.channel_id);
    if (!ch.server_id) fail(400, 'Rulet yalnızca sunucularda oynanır');
    const c = JSON.parse(m.components);
    if (c.type !== 'roulette') fail(400, 'Bu bir rulet değil');
    if (c.status !== 'open') fail(400, 'Rulet çoktan döndü');
    if (req.body.action === 'join') {
      if (c.players.includes(req.user.id)) fail(400, 'Zaten masadasın');
      if (req.user.is_bot) fail(400, 'Botlar oynayamaz');
      c.players.push(req.user.id);
      if (c.players.length >= 6) spin(m, ch, c);
    } else if (req.body.action === 'spin') {
      if (m.author_id !== req.user.id && !has(ch.server_id, req.user.id, P.MANAGE_MESSAGES)) fail(403, 'Çarkı yalnızca başlatan çevirebilir');
      if (c.players.length < 2) fail(400, 'En az 2 oyuncu gerekli');
      spin(m, ch, c);
    } else fail(400, 'Geçersiz işlem');
    q.run('UPDATE messages SET components=? WHERE id=?', JSON.stringify(c), m.id);
    const msg = messagePayload(q.get('SELECT * FROM messages WHERE id=?', m.id), ch);
    toChannel(ch, 'MESSAGE_UPDATE', msg);
    res.json(msg);
  });

  // ---------------------------------------------------------------- boss savaşı
  const bosses = new Map(); // server_id -> boss
  const lastBoss = new Map();
  const bossView = (b) => b && { server_id: b.server_id, channel_id: b.channel_id, name: b.name, emoji: b.emoji, hp: Math.max(0, Math.round(b.hp)), max: b.max, ends_at: b.ends_at, top: topDamage(b, 3) };
  const topDamage = (b, n) => [...b.damage].sort((x, y) => y[1] - x[1]).slice(0, n).map(([user_id, dmg]) => ({ user_id, dmg: Math.round(dmg) }));
  // saniyede en fazla ~4 güncelleme; sınırlamaya takılan son durum pencere bitince yine de gönderilir
  const bossTimers = new Map();
  const announce = (b, hit) => {
    const t = bossTimers.get(b.server_id);
    if (t) { t.pending = hit || true; return; }
    toServer(b.server_id, 'BOSS_UPDATE', { server_id: b.server_id, boss: bossView(b), hit });
    const timer = { pending: null };
    bossTimers.set(b.server_id, timer);
    setTimeout(() => {
      bossTimers.delete(b.server_id);
      if (timer.pending && bosses.get(b.server_id) === b) announce(b, timer.pending === true ? null : timer.pending);
    }, 250);
  };

  function spawnBoss(sid, chId, by) {
    if (bosses.has(sid)) fail(400, 'Sunucuda zaten bir boss var!');
    const t = BOSSES[crypto.randomInt(0, BOSSES.length)];
    const members = q.get('SELECT COUNT(*) AS n FROM members WHERE server_id=?', sid).n;
    const max = Math.round(t.hp * Math.min(3, Math.max(0.4, members / 10)));
    const b = { server_id: sid, channel_id: chId, ...t, hp: max, max, damage: new Map(), spawned_at: now(), ends_at: now() + 30 * 60e3, by };
    bosses.set(sid, b);
    lastBoss.set(sid, now());
    const ch = q.get('SELECT * FROM channels WHERE id=?', chId);
    if (ch) createMessage(ch, ctx.systemUserId, { content: `${t.emoji} **${t.name}** sunucuya saldırdı! (${max.toLocaleString('tr-TR')} can)\nMesaj yaz, tepki ver ya da \`/saldir\` yaz — her biri hasar verir! 30 dakikanız var ⚔️` });
    announce(b, null);
    return b;
  }

  function hitBoss(sid, uid, base, kind) {
    const b = bosses.get(sid);
    if (!b) return;
    const crit = Math.random() < 0.06;
    const dmg = Math.round(base * (crit ? 3 : 1) * (0.8 + Math.random() * 0.4));
    b.hp -= dmg;
    b.damage.set(uid, (b.damage.get(uid) || 0) + dmg);
    if (b.hp <= 0) return defeat(b, uid);
    announce(b, { user_id: uid, dmg, crit, kind });
  }

  function defeat(b, killer) {
    bosses.delete(b.server_id);
    const until = now() + 7 * 86400e3;
    const lines = [];
    for (const [uid, dmg] of b.damage) {
      const coins = Math.min(1500, 50 + Math.round(dmg / 15));
      const row = q.get('SELECT badges FROM members WHERE server_id=? AND user_id=?', b.server_id, uid);
      if (!row) continue;
      let badges = [];
      try { badges = JSON.parse(row.badges || '[]'); } catch { /* boş */ }
      badges = badges.filter((x) => x.id !== 'boss');
      badges.push({ id: 'boss', emoji: b.emoji, name: `${b.name} Avcısı`, until });
      q.run('UPDATE members SET coins=coins+?, badges=? WHERE server_id=? AND user_id=?', coins, JSON.stringify(badges), b.server_id, uid);
      toServer(b.server_id, 'MEMBER_UPDATE', { server_id: b.server_id, member: memberPayload(b.server_id, uid) });
      lines.push({ uid, dmg, coins });
    }
    lines.sort((x, y) => y.dmg - x.dmg);
    const ch = q.get('SELECT * FROM channels WHERE id=?', b.channel_id);
    if (ch) {
      createMessage(ch, ctx.systemUserId, {
        content: `🏆 **${b.name}** yenildi! Son vuruş: @${getUser(killer)?.username}`,
        embeds: [{ title: `${b.emoji} Savaş Raporu`, color: 0xf0b232, description: lines.slice(0, 10).map((l, i) => `**${i + 1}.** ${getUser(l.uid)?.display_name} — ${l.dmg.toLocaleString('tr-TR')} hasar → 🪙 ${l.coins}`).join('\n'), footer: `${lines.length} savaşçı • Herkese 7 günlük "${b.name} Avcısı" rozeti` }],
      });
    }
    toServer(b.server_id, 'BOSS_UPDATE', { server_id: b.server_id, boss: null, defeated: { name: b.name, emoji: b.emoji, killer } });
  }

  setInterval(() => {
    for (const b of [...bosses.values()]) {
      if (b.ends_at > now()) continue;
      bosses.delete(b.server_id);
      const ch = q.get('SELECT * FROM channels WHERE id=?', b.channel_id);
      if (ch) createMessage(ch, ctx.systemUserId, { content: `💨 ${b.emoji} **${b.name}** kaçtı! (${Math.round(b.hp).toLocaleString('tr-TR')} canı kalmıştı) Bir dahaki sefere…` });
      toServer(b.server_id, 'BOSS_UPDATE', { server_id: b.server_id, boss: null, escaped: true });
    }
  }, 15000).unref();

  api.post('/servers/:sid/boss', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id, P.MANAGE_SERVER);
    const ch = channelAccess(req.user.id, String(req.body.channel_id));
    if (ch.server_id !== req.params.sid || ch.type !== 'text') fail(400, 'Bir metin kanalı seç');
    res.json(bossView(spawnBoss(req.params.sid, ch.id, req.user.id)));
  });

  // ---------------------------------------------------------------- maskot
  const getMascot = (sid) => {
    const s = q.get('SELECT mascot FROM servers WHERE id=?', sid);
    if (!s) return null;
    try { if (s.mascot) return JSON.parse(s.mascot); } catch { /* yeniden doğar */ }
    const [emoji, species] = PETS[crypto.randomInt(0, PETS.length)];
    const m = { name: species, emoji, species, hunger: 70, happy: 70, level: 1, xp: 0, state: 'awake', last_msg_at: now(), born_at: now() };
    q.run('UPDATE servers SET mascot=? WHERE id=?', JSON.stringify(m), sid);
    return m;
  };
  const saveMascot = (sid, m, push = true) => {
    q.run('UPDATE servers SET mascot=? WHERE id=?', JSON.stringify(m), sid);
    if (push) toServer(sid, 'MASCOT_UPDATE', { server_id: sid, mascot: m });
  };
  const mascotThrottle = new Map();

  api.get('/servers/:sid/mascot', auth, (req, res) => { requireServerPerm(req.params.sid, req.user.id); res.json(getMascot(req.params.sid)); });
  api.post('/servers/:sid/mascot', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    const m = getMascot(sid);
    const a = req.body.action;
    if (a === 'pet') {
      if (m.state === 'gone') fail(400, `${m.name} kaçtı! Önce geri çağır.`);
      if (limited(`pet:${req.user.id}`, 5, 60e3)) fail(429, `${m.name} biraz yoruldu 😅`);
      m.happy = Math.min(100, m.happy + 6);
      if (m.state === 'sleep') m.state = 'awake';
    } else if (a === 'feed') {
      if (m.state === 'gone') fail(400, `${m.name} kaçtı! Önce geri çağır.`);
      if (limited(`feed:${req.user.id}`, 3, 60e3)) fail(429, `${m.name} tok, biraz bekle`);
      m.hunger = Math.min(100, m.hunger + 12);
    } else if (a === 'call') {
      if (m.state !== 'gone') fail(400, `${m.name} zaten burada`);
      m.state = 'awake'; m.hunger = 40; m.happy = 40; m.last_msg_at = now();
    } else if (a === 'rename') {
      requireServerPerm(sid, req.user.id, P.MANAGE_SERVER);
      m.name = clean(req.body.name, 24) || m.name;
    } else fail(400, 'Geçersiz işlem');
    saveMascot(sid, m);
    res.json(m);
  });

  setInterval(() => {
    for (const s of q.all('SELECT id, mascot FROM servers WHERE mascot IS NOT NULL')) {
      let m;
      try { m = JSON.parse(s.mascot); } catch { continue; }
      if (m.state === 'gone') continue;
      const idle = now() - (m.last_msg_at || 0);
      const before = m.state;
      m.hunger = Math.max(0, m.hunger - 0.35);
      if (idle > 10 * 60e3) m.happy = Math.max(0, m.happy - 0.6);
      if (idle > 20 * 60e3 && m.state === 'awake') m.state = 'sleep';
      if ((m.hunger <= 0 && m.happy <= 0) || idle > 48 * 3600e3) m.state = 'gone';
      saveMascot(s.id, m, before !== m.state || Math.round(m.hunger) % 10 === 0);
    }
  }, 60e3).unref();

  // ---------------------------------------------------------------- mesaj ve tepki kancaları
  ctx.hooks.message.push((msg, ch, author) => {
    if (!ch.server_id || !author || author.is_bot || msg.type !== 0) return;
    const sid = ch.server_id;
    // maskotu besle
    const m = getMascot(sid);
    if (m && m.state !== 'gone') {
      const wasAsleep = m.state === 'sleep';
      m.hunger = Math.min(100, m.hunger + 2);
      m.happy = Math.min(100, m.happy + 1.5);
      m.xp += 1;
      m.last_msg_at = now();
      m.state = 'awake';
      let lvl = false;
      if (m.xp >= m.level * 40) { m.xp = 0; m.level++; lvl = true; }
      const last = mascotThrottle.get(sid) || 0;
      const push = wasAsleep || lvl || now() - last > 5000;
      if (push) mascotThrottle.set(sid, now());
      saveMascot(sid, m, push);
      if (lvl) toServer(sid, 'NOTICE', { level: 'info', text: `${m.emoji} ${m.name} seviye ${m.level} oldu! 🎉` });
    }
    // boss
    if (bosses.has(sid)) {
      const atk = /^\/saldir\b/i.test(msg.content || '');
      if (atk && limited(`atk:${author.id}`, 1, 8000)) return;
      hitBoss(sid, author.id, atk ? 90 : 25, atk ? 'attack' : 'message');
    } else if (now() - (lastBoss.get(sid) || 0) > 2 * 3600e3 && Math.random() < 0.003 && ch.type === 'text' && !ch.anon) {
      try { spawnBoss(sid, ch.id, null); } catch { /* zaten var */ }
    }
  });

  ctx.hooks.reaction.push((m, ch, user) => {
    if (ch.server_id && bosses.has(ch.server_id) && !limited(`rboss:${user.id}`, 6, 10e3)) hitBoss(ch.server_id, user.id, 10, 'reaction');
  });

  ctx.hooks.ready.push((ready, uid, sset) => {
    ready.bosses = [...bosses.values()].filter((b) => sset.has(b.server_id)).map(bossView);
  });

  // ---------------------------------------------------------------- doodle botlar
  api.get('/servers/:sid/doodles', auth, (req, res) => {
    requireServerPerm(req.params.sid, req.user.id);
    res.json(q.all('SELECT * FROM doodles WHERE server_id=? ORDER BY created_at', req.params.sid).map((d) => ({ ...d, pixels: JSON.parse(d.pixels), user: publicUser(getUser(d.user_id)) })));
  });

  api.post('/servers/:sid/doodles', auth, (req, res) => {
    const sid = req.params.sid;
    requireServerPerm(sid, req.user.id);
    if (q.get('SELECT COUNT(*) AS n FROM doodles WHERE server_id=?', sid).n >= 40) fail(400, 'Bu sunucuda en fazla 40 doodle bot olabilir');
    const px = Array.isArray(req.body.pixels) ? req.body.pixels : [];
    if (px.length !== 256 || !px.every((c) => c === null || /^#[0-9a-f]{6}$/i.test(c))) fail(400, 'Çizim 16x16 olmalı');
    if (px.every((c) => c === null)) fail(400, 'Önce bir şey çiz 🙂');
    const trigger = clean(req.body.trigger, 32).toLowerCase();
    if (!/^[!./]?[\p{L}\p{N}_-]{2,30}$/u.test(trigger)) fail(400, 'Komut 2-30 karakter olmalı (ör. !selam)');
    if (q.get('SELECT 1 FROM doodles WHERE server_id=? AND trigger=?', sid, trigger)) fail(409, 'Bu komut başka bir doodle botta kullanılıyor');
    const id = newId();
    q.run('INSERT INTO doodles(id,server_id,user_id,name,pixels,trigger,anim,created_at) VALUES(?,?,?,?,?,?,?,?)',
      id, sid, req.user.id, clean(req.body.name, 24) || 'Doodle', JSON.stringify(px), trigger,
      ['jump', 'spin', 'balloon', 'dance', 'zoom'].includes(req.body.anim) ? req.body.anim : 'jump', now());
    const d = q.get('SELECT * FROM doodles WHERE id=?', id);
    const view = { ...d, pixels: px, user: publicUser(req.user) };
    toServer(sid, 'DOODLE_CREATE', view);
    res.json(view);
  });

  api.delete('/doodles/:id', auth, (req, res) => {
    const d = q.get('SELECT * FROM doodles WHERE id=?', req.params.id);
    if (!d) fail(404, 'Doodle bulunamadı');
    requireServerPerm(d.server_id, req.user.id);
    if (d.user_id !== req.user.id && !has(d.server_id, req.user.id, P.MANAGE_SERVER)) fail(403, 'Bu doodle botu silemezsin');
    q.run('DELETE FROM doodles WHERE id=?', d.id);
    toServer(d.server_id, 'DOODLE_DELETE', { id: d.id, server_id: d.server_id });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- ses kanalı akustiği ve çığlık ölçer
  api.patch('/channels/:id/voicefx', auth, (req, res) => {
    const ch = channelAccess(req.user.id, req.params.id);
    if (!['voice', 'lobby'].includes(ch.type)) fail(400, 'Bu bir ses kanalı değil');
    if (req.body.acoustic !== undefined) {
      if (!has(ch.server_id, req.user.id, P.CONNECT)) fail(403, 'Yetkin yok');
      q.run('UPDATE channels SET acoustic=? WHERE id=?', ACOUSTICS.includes(req.body.acoustic) ? req.body.acoustic : 'none', ch.id);
    }
    if (req.body.scream_db !== undefined) {
      if (!has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) fail(403, 'Çığlık ölçeri yalnızca kanal yöneticileri ayarlayabilir');
      q.run('UPDATE channels SET scream_db=? WHERE id=?', Math.max(0, Math.min(100, Number(req.body.scream_db) || 0)), ch.id);
    }
    const fresh = ctx.publicChannel(q.get('SELECT * FROM channels WHERE id=?', ch.id));
    toServer(ch.server_id, 'CHANNEL_UPDATE', fresh);
    res.json(fresh);
  });

  // ---------------------------------------------------------------- socket olayları
  const latency = new Map(); // uid -> { rtt, region, at }

  ctx.hooks.socket.push((socket, uid, safe) => {
    // okununca imha
    socket.on('burn:seen', safe((d) => {
      const m = q.get('SELECT * FROM messages WHERE id=?', String(d?.message_id));
      if (!m || m.expires_at !== -1 || m.author_id === uid) return;
      const ch = channelAccess(uid, m.channel_id);
      q.run('UPDATE messages SET expires_at=? WHERE id=?', now() + 4000, m.id);
      toChannel(ch, 'MESSAGE_UPDATE', messagePayload(q.get('SELECT * FROM messages WHERE id=?', m.id), ch));
    }));

    // çığlık ölçer: istemci kendini fırlatır, kanaldakilere animasyon için bildirir
    socket.on('scream', safe(() => {
      const v = ctx.voice.get(uid);
      if (!v || limited('scream:' + uid, 2, 30e3)) return;
      io.to('voice:' + v.channel_id).emit('dispatch', { t: 'VOICE_FX', d: { kind: 'launch', user_id: uid, channel_id: v.channel_id } });
    }));

    // kaos komutları: tüm kanal izleyicilerinin sohbeti düşer/sallanır
    socket.on('chaos', safe((d) => {
      const ch = channelAccess(uid, String(d?.channel_id));
      if (limited('chaos:' + uid, 3, 20e3)) fail(429, 'Kaos dinleniyor, biraz bekle 😅');
      const kind = ['gravity', 'zero', 'shake', 'reset'].includes(d.kind) ? d.kind : 'shake';
      toChannel(ch, 'CHAOS', { channel_id: ch.id, kind, by: uid });
    }));

    // canlı imleç arenası
    socket.on('cursor:join', safe((d) => { const ch = channelAccess(uid, String(d?.channel_id)); socket.join('cur:' + ch.id); }));
    socket.on('cursor:leave', (d) => { socket.leave('cur:' + String(d?.channel_id)); socket.to('cur:' + String(d?.channel_id)).emit('cursor', { uid, gone: true }); });
    socket.on('cursor', (d) => {
      const room = 'cur:' + String(d?.channel_id);
      if (!socket.rooms.has(room)) return;
      const x = Number(d.x);
      const y = Number(d.y);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      socket.volatile.to(room).emit('cursor', { uid, x, y, shot: d.shot ? { x: Number(d.shot.x), y: Number(d.shot.y) } : undefined, hit: d.hit ? String(d.hit) : undefined });
    });
    socket.on('disconnect', () => {
      for (const r of socket.rooms) if (r.startsWith('cur:')) socket.to(r).emit('cursor', { uid, gone: true });
    });

    // ping radarı
    socket.on('ping:t', (cb) => typeof cb === 'function' && cb(Date.now()));
    socket.on('ping:report', (d) => {
      const rtt = Math.round(Number(d?.rtt));
      if (rtt > 0 && rtt < 5000) latency.set(uid, { rtt, region: clean(d.region, 48), at: now() });
    });
    socket.on('disconnect', () => setTimeout(() => { if (!ctx.online.has(uid)) latency.delete(uid); }, 0));
  });

  api.get('/radar', auth, (req, res) => {
    const me = req.user.id;
    const ids = new Set();
    for (const f of q.all("SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS o FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'", me, me, me)) ids.add(f.o);
    const sid = req.query.server_id ? String(req.query.server_id) : null;
    if (sid) { requireServerPerm(sid, me); for (const r of q.all('SELECT user_id FROM members WHERE server_id=?', sid)) ids.add(r.user_id); }
    ids.delete(me);
    const mine = latency.get(me);
    res.json({
      me: mine || null,
      users: [...ids].filter((id) => latency.has(id)).map((id) => {
        const l = latency.get(id);
        const u = getUser(id);
        return { user: publicUser(u), rtt: l.rtt, region: l.region, estimate: mine ? Math.round((mine.rtt + l.rtt) / 2) : l.rtt, game: ctx.voice.get(id) ? '🔊 Seste' : null };
      }).sort((a, b) => a.estimate - b.estimate),
    });
  });
};
