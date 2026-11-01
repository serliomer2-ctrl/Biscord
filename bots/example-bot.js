// Biscord örnek botu
// Çalıştırma:  BISCORD_URL=https://siten.com BOT_TOKEN=xxxx node bots/example-bot.js
// (Windows PowerShell:  $env:BOT_TOKEN="xxxx"; node bots/example-bot.js)
'use strict';
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env yok */ }
const { io } = require('socket.io-client');

const BASE = (process.env.BISCORD_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.BOT_TOKEN;
const PREFIX = process.env.BOT_PREFIX || '!';
if (!TOKEN) {
  console.error('BOT_TOKEN gerekli. Biscord → Kullanıcı Ayarları → Botlarım bölümünden bir bot oluştur.');
  process.exit(1);
}

// Barındırma platformu bir port bekliyorsa (ör. GoDaddy Node.js Hosting) basit bir durum sayfası aç
if (process.env.PORT) {
  require('http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(me ? `${me.display_name} çalışıyor` : 'Bot başlatılıyor…');
  }).listen(Number(process.env.PORT));
}

// ---------------------------------------------------------------- küçük API sarmalayıcı
async function api(method, url, body) {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: { Authorization: 'Bot ' + TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
const send = (channelId, content, extra = {}) => api('POST', `/channels/${channelId}/messages`, { content, ...extra });
const reply = (msg, content, extra = {}) => send(msg.channel_id, content, { reply_to: msg.id, ...extra });
const react = (msg, emoji) => api('PUT', `/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`);

// ---------------------------------------------------------------- durum
let me = null;
const servers = new Map(); // id -> { name, channels, members, system_channel_id }

// ---------------------------------------------------------------- komutlar
const commands = {
  yardim: {
    description: 'Tüm komutları listeler',
    run: (msg) => reply(msg, '', {
      embeds: [{
        title: '🤖 Komutlar',
        color: 0x6c5ce7,
        description: Object.entries(commands).map(([n, c]) => `**/${n}**${c.usage ? ' `' + c.usage + '`' : ''} — ${c.description}`).join('\n'),
        footer: `Komutları / veya ${PREFIX} ile kullanabilirsin`,
      }],
    }),
  },
  ping: {
    description: 'Botun yanıt süresini ölçer',
    run: async (msg) => {
      const t = Date.now();
      await api('GET', '/users/@me');
      return reply(msg, `🏓 Pong! **${Date.now() - t} ms**`);
    },
  },
  zar: {
    description: 'Zar atar', usage: '[yüz sayısı]',
    run: (msg, args) => {
      const n = Math.max(2, Math.min(1000, parseInt(args[0], 10) || 6));
      return reply(msg, `🎲 **${1 + Math.floor(Math.random() * n)}** (1-${n})`);
    },
  },
  yazitura: { description: 'Yazı tura atar', run: (msg) => reply(msg, Math.random() < 0.5 ? '🪙 **Yazı!**' : '🪙 **Tura!**') },
  sec: {
    description: 'Seçenekler arasından seçim yapar', usage: 'a | b | c',
    run: (msg, args) => {
      const opts = args.join(' ').split('|').map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) return reply(msg, 'En az iki seçenek ver: `/sec pizza | döner | lahmacun`');
      return reply(msg, `🤔 Benim seçimim: **${opts[Math.floor(Math.random() * opts.length)]}**`);
    },
  },
  saat: {
    description: 'Türkiye saatini gösterir',
    run: (msg) => reply(msg, `🕒 ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full', timeStyle: 'short' })}`),
  },
  avatar: {
    description: 'Avatarını gösterir',
    run: (msg) => {
      const a = msg.author.avatar;
      if (!a) return reply(msg, 'Henüz bir avatarın yok!');
      return reply(msg, '', { embeds: [{ title: `${msg.author.display_name} kullanıcısının avatarı`, image: BASE + a, color: 0x2fbf71 }] });
    },
  },
  sunucu: {
    description: 'Sunucu bilgilerini gösterir',
    run: (msg) => {
      const s = servers.get(msg.server_id);
      if (!s) return reply(msg, 'Bu komut sadece sunucularda çalışır.');
      return reply(msg, '', {
        embeds: [{
          title: s.name,
          color: 0x3d8bfd,
          fields: [
            { name: 'Üye', value: String(s.members), inline: true },
            { name: 'Kanal', value: String(s.channels), inline: true },
            { name: 'Kuruluş', value: new Date(s.created_at).toLocaleDateString('tr-TR'), inline: true },
          ],
        }],
      });
    },
  },
  anket: {
    description: 'Evet/hayır anketi başlatır', usage: '<soru>',
    run: async (msg, args) => {
      if (!args.length) return reply(msg, 'Kullanım: `/anket Bu akşam oyun oynayalım mı?`');
      const m = await send(msg.channel_id, '', { embeds: [{ title: '📊 Anket', description: args.join(' '), color: 0xf0b232, footer: `${msg.author.display_name} tarafından` }] });
      await react(m, '👍');
      await react(m, '👎');
    },
  },
  temizle: {
    description: 'Son mesajları siler (Mesajları Yönet yetkisi gerekir)', usage: '<1-100>',
    run: async (msg, args) => {
      const n = Math.max(1, Math.min(100, parseInt(args[0], 10) || 10));
      const list = await api('GET', `/channels/${msg.channel_id}/messages?limit=${Math.min(100, n + 1)}`);
      try {
        const r = await api('POST', `/channels/${msg.channel_id}/messages/bulk-delete`, { messages: list.map((m) => m.id) });
        const note = await send(msg.channel_id, `🧹 ${r.deleted} mesaj silindi.`);
        setTimeout(() => api('DELETE', `/messages/${note.id}`).catch(() => {}), 4000);
      } catch (e) {
        return reply(msg, `❌ ${e.message} (Bota "Mesajları Yönet" yetkisi olan bir rol ver.)`);
      }
    },
  },
};

// ---------------------------------------------------------------- gerçek zamanlı bağlantı
const socket = io(BASE, { auth: { token: 'Bot ' + TOKEN } });

socket.on('connect_error', (e) => console.error('Bağlantı hatası:', e.message === 'unauthorized' ? 'Token geçersiz' : e.message));
socket.on('disconnect', () => console.log('Bağlantı koptu, yeniden bağlanılıyor…'));

socket.on('dispatch', async ({ t, d }) => {
  try {
    if (t === 'READY') {
      me = d.user;
      servers.clear();
      for (const s of d.servers) servers.set(s.id, { name: s.name, channels: s.channels.filter((c) => c.type !== 'category').length, members: s.members.length, system_channel_id: s.system_channel_id, created_at: s.created_at });
      console.log(`✅ ${me.display_name} olarak giriş yapıldı — ${servers.size} sunucu`);
      await api('PUT', '/bots/@me/commands', Object.entries(commands).map(([name, c]) => ({ name, description: c.description, usage: c.usage })));
    }

    if (t === 'SERVER_CREATE') {
      servers.set(d.id, { name: d.name, channels: d.channels.length, members: d.members.length, system_channel_id: d.system_channel_id, created_at: d.created_at });
      if (d.system_channel_id) send(d.system_channel_id, `👋 Merhaba **${d.name}**! Ben ${me.display_name}. Komutlarımı görmek için \`/yardim\` yaz.`).catch(() => {});
    }
    if (t === 'SERVER_DELETE') servers.delete(d.id);

    if (t === 'MEMBER_ADD') {
      const s = servers.get(d.server_id);
      if (s) s.members++;
    }

    if (t === 'MESSAGE_CREATE') {
      if (d.author.id === me.id || d.author.is_bot) return;
      const text = d.content.trim();
      if (d.mentions.includes(me.id) && !/^[/!]/.test(text)) return reply(d, `Merhaba ${d.author.display_name}! 👋 Komutlar için \`/yardim\` yazabilirsin.`);
      const prefix = text.startsWith('/') ? '/' : text.startsWith(PREFIX) ? PREFIX : null;
      if (!prefix) return;
      const [name, ...args] = text.slice(prefix.length).split(/\s+/);
      const cmd = commands[name?.toLowerCase()];
      if (cmd) await cmd.run(d, args);
    }
  } catch (e) {
    console.error(`[${t}]`, e.message);
  }
});
