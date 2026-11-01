// Site yönetim paneli (yalnızca yöneticiler)
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, avatar, fmtTime, fmtDay, fmtSize, markdown } from '../util.js';

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'g ' : ''}${h}s ${m}dk`;
};

const ACTION_TR = {
  'user.ban': '🔨 yasakladı', 'user.unban': '🕊️ yasağı kaldırdı', 'user.mute': '🔇 susturdu', 'user.unmute': '🔊 susturmayı kaldırdı',
  'user.admin.grant': '🛡️ yönetici yaptı', 'user.admin.revoke': '🛡️ yöneticiliği aldı', 'user.reset_password': '🔑 şifresini sıfırladı',
  'user.disable_2fa': '📱 2FA\'sını kapattı', 'user.delete': '🗑️ hesabını sildi', 'server.delete': '🗑️ sunucuyu sildi',
  'message.delete': '💬 mesajı sildi', 'settings.registration': '⚙️ kayıt ayarını değiştirdi', 'settings.announcement': '📢 duyuru yayınladı',
  'economy.grant': '🪙 coin verdi',
};

export function openAdminPanel() {
  ctx.openSettingsShell({
    initial: 'dashboard',
    sections: [{
      label: '🛡️ Yönetim Paneli',
      items: [
        { id: 'dashboard', label: 'Genel Bakış' },
        { id: 'users', label: 'Kullanıcılar' },
        { id: 'servers', label: 'Sunucular' },
        { id: 'messages', label: 'Mesaj Denetimi' },
        { id: 'announce', label: 'Duyuru ve Ayarlar' },
        { id: 'audit', label: 'İşlem Kayıtları' },
      ],
    }],
    render: (id, el, ctl) => PAGES[id](el, ctl),
  });
}

function userRow(u) {
  const flags = [
    u.is_admin && '<span class="pill brand">Yönetici</span>',
    u.is_bot && '<span class="pill">Bot</span>',
    u.banned && '<span class="pill danger">Yasaklı</span>',
    u.muted_until && `<span class="pill warn">Susturuldu · ${fmtTime(u.muted_until)}'e kadar</span>`,
    u.mfa && '<span class="pill ok">2FA</span>',
  ].filter(Boolean).join(' ');
  return `<div class="table-row" data-uid="${u.id}">${avatar(u, 36, { status: true })}
    <div class="meta"><b>${esc(u.display_name)}</b> <span class="muted">${esc(u.username)}</span> ${flags}
      <small>${u.email ? esc(u.email) + ' • ' : ''}Katılım: ${fmtDay(u.created_at)} • ${u.servers} sunucu • ${u.messages} mesaj${u.ban_reason ? ' • Sebep: ' + esc(u.ban_reason) : ''}</small></div>
    <button class="btn secondary sm" data-umenu="${u.id}">İşlemler</button></div>`;
}

const PAGES = {
  async dashboard(el) {
    el.innerHTML = '<h2>Genel Bakış</h2><p class="muted">Yükleniyor…</p>';
    let s;
    try { s = await api.get('/admin/stats'); } catch (e) { return ctx.fail(e); }
    const tile = (label, value, sub = '') => `<div class="stat"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    el.innerHTML = `<h2>Genel Bakış</h2>
      ${!s.mail_configured ? '<div class="notice warn">E-posta (SMTP) ayarlı değil — şifre sıfırlama ve e-posta kodları gönderilemiyor. Ayarlar için GODADDY-KURULUM.md dosyasına bak.</div>' : ''}
      <div class="stats">
        ${tile('Kullanıcılar', s.users, `+${s.new_users_7d} son 7 gün`)}
        ${tile('Şu an çevrimiçi', s.online, `${s.in_voice} kişi seste`)}
        ${tile('Sunucular', s.servers, `${s.channels} kanal`)}
        ${tile('Mesajlar', s.messages.toLocaleString('tr-TR'), `${s.messages_24h} son 24 saat`)}
        ${tile('Botlar', s.bots)}
        ${tile('Yasaklı', s.banned)}
        ${tile('Yüklenen dosyalar', fmtSize(s.uploads_bytes))}
        ${tile('Sunucu belleği', s.memory_mb + ' MB', `Node ${esc(s.node)}`)}
        ${tile('Çalışma süresi', fmtUptime(s.uptime_s))}
        ${tile('Kayıtlar', s.registration === 'open' ? 'Açık' : 'Kapalı')}
      </div>`;
  },

  users(el) {
    let filter = '';
    el.innerHTML = `<h2>Kullanıcılar</h2>
      <div class="row wrap" style="margin-bottom:12px"><input class="input grow" id="au-q" placeholder="Kullanıcı adı, görünen ad, e-posta veya kimlik ara">
        <select class="input" id="au-f" style="width:auto"><option value="">Tümü</option><option value="banned">Yasaklılar</option><option value="muted">Susturulanlar</option><option value="admins">Yöneticiler</option><option value="bots">Botlar</option></select></div>
      <div id="au-list"><p class="muted">Yükleniyor…</p></div>`;
    let list = [];
    const load = async () => {
      try {
        list = await api.get(`/admin/users?q=${encodeURIComponent(el.querySelector('#au-q').value)}&filter=${filter}`);
        el.querySelector('#au-list').innerHTML = list.map(userRow).join('') || '<p class="muted">Kullanıcı bulunamadı.</p>';
      } catch (e) { ctx.fail(e); }
    };
    let t;
    el.querySelector('#au-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
    el.querySelector('#au-f').onchange = (e) => { filter = e.target.value; load(); };
    el.onclick = (e) => {
      const b = e.target.closest('[data-umenu]');
      if (!b) return;
      const u = list.find((x) => x.id === b.dataset.umenu);
      const r = b.getBoundingClientRect();
      const act = async (path, body, msg) => {
        try { await api.post(`/admin/users/${u.id}/${path}`, body); ctx.toast(msg, 'ok'); load(); } catch (err) { ctx.fail(err); }
      };
      const me = u.id === ctx.S.me.id;
      ctx.menu(r.left - 150, r.bottom + 4, [
        { label: 'Profili Gör', icon: 'users', action: () => { ctx.upsertUser(u); ctx.showProfile(u.id, b); } },
        { label: 'Mesajlarını Gör', icon: 'message', action: () => { ctl_show('messages', u.id); } },
        '-',
        !me && (u.muted_until
          ? { label: 'Susturmayı Kaldır', icon: 'mic', action: () => act('unmute', {}, 'Susturma kaldırıldı') }
          : { label: 'Sustur…', icon: 'micOff', action: () => muteModal(u, load) }),
        !me && !u.is_bot && { label: 'Şifresini Sıfırla', icon: 'shield', action: async () => {
          if (!(await ctx.confirmDialog('Şifreyi sıfırla', `<b>${esc(u.username)}</b> için geçici bir şifre oluşturulacak ve tüm oturumları kapanacak.`, 'Sıfırla', false))) return;
          try {
            const r2 = await api.post(`/admin/users/${u.id}/reset-password`);
            ctx.modal({ title: 'Geçici şifre', sub: 'Bu şifreyi kullanıcıya güvenli bir yoldan ilet. İlk girişte değiştirmesi istenecek.', body: `<div class="code-block" style="font-size:18px;text-align:center;user-select:all">${esc(r2.temp_password)}</div>` });
          } catch (err) { ctx.fail(err); }
        } },
        !me && u.mfa && { label: '2FA\'yı Kapat', icon: 'shield', action: () => act('disable-2fa', {}, '2FA kapatıldı') },
        !me && !u.is_bot && { label: u.is_admin ? 'Yöneticiliği Al' : 'Yönetici Yap', icon: 'crown', action: async () => {
          if (!(await ctx.confirmDialog(u.is_admin ? 'Yöneticiliği al' : 'Yönetici yap', `<b>${esc(u.username)}</b> ${u.is_admin ? 'artık yönetici olmayacak.' : 'tüm yönetim paneline erişebilecek.'}`, 'Onayla', !u.is_admin))) return;
          act('admin', { value: !u.is_admin }, 'Güncellendi');
        } },
        '-',
        !me && (u.banned
          ? { label: 'Yasağı Kaldır', icon: 'check', action: () => act('unban', {}, 'Yasak kaldırıldı') }
          : { label: 'Siteden Yasakla…', icon: 'x', danger: true, action: () => banModal(u, load) }),
        !me && { label: 'Hesabı Sil', icon: 'trash', danger: true, action: async () => {
          if (!(await ctx.confirmDialog('Hesabı kalıcı olarak sil', `<b>${esc(u.username)}</b> hesabı, sahip olduğu sunucular, botlar ve tüm mesajları silinecek. Bu geri alınamaz!`, 'Kalıcı Olarak Sil'))) return;
          try { await api.del('/admin/users/' + u.id); ctx.toast('Hesap silindi', 'ok'); load(); } catch (err) { ctx.fail(err); }
        } },
      ]);
    };
    const ctl_show = (page, author) => { PAGES.messages(el, null, author); };
    load();
  },

  async servers(el) {
    el.innerHTML = `<h2>Sunucular</h2><input class="input" id="as-q" placeholder="Sunucu adı veya kimliği ara" style="margin-bottom:12px"><div id="as-list"><p class="muted">Yükleniyor…</p></div>`;
    let list = [];
    const load = async () => {
      try {
        list = await api.get('/admin/servers?q=' + encodeURIComponent(el.querySelector('#as-q').value));
        el.querySelector('#as-list').innerHTML = list.map((s) => `<div class="table-row">
          <div class="guild-btn" style="width:40px;height:40px;border-radius:12px;background:var(--brand);color:#fff;flex:none">${s.icon ? `<img src="${esc(s.icon)}" alt="">` : esc([...s.name][0] || '?')}</div>
          <div class="meta"><b>${esc(s.name)}</b><small>Sahibi: ${esc(s.owner?.username || '?')} • ${s.members} üye • ${s.messages} mesaj • ${fmtDay(s.created_at)}</small></div>
          <button class="btn red sm" data-del="${s.id}">Sil</button></div>`).join('') || '<p class="muted">Sunucu yok.</p>';
      } catch (e) { ctx.fail(e); }
    };
    let t;
    el.querySelector('#as-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const s = list.find((x) => x.id === b.dataset.del);
      if (!(await ctx.confirmDialog('Sunucuyu sil', `<b>${esc(s.name)}</b> sunucusu ve tüm mesajları kalıcı olarak silinecek.`, 'Sil'))) return;
      try { await api.del('/admin/servers/' + s.id); ctx.toast('Sunucu silindi', 'ok'); load(); } catch (err) { ctx.fail(err); }
    };
    load();
  },

  async messages(el, ctl, author = '') {
    el.innerHTML = `<h2>Mesaj Denetimi</h2>
      <div class="row" style="margin-bottom:12px"><input class="input grow" id="am-q" placeholder="Mesaj içeriğinde ara (boş = son 100 mesaj)"></div>
      ${author ? `<p class="muted">Bir kullanıcının mesajları gösteriliyor. <a data-all style="cursor:pointer">Tümünü göster</a></p>` : ''}
      <div id="am-list"><p class="muted">Yükleniyor…</p></div>`;
    let list = [];
    const load = async () => {
      try {
        const qv = el.querySelector('#am-q').value;
        list = await api.get(`/admin/messages?q=${encodeURIComponent(qv)}${author ? '&author=' + author : ''}`);
        el.querySelector('#am-list').innerHTML = list.map((m) => `<div class="table-row" style="align-items:flex-start">${avatar(m.author, 32)}
          <div class="meta"><b>${esc(m.author?.display_name)}</b> <span class="muted" style="font-size:12px">${esc(m.server?.name || 'DM')}${m.channel?.name ? ' › #' + esc(m.channel.name) : ''} • ${fmtTime(m.created_at)}</span>
            <div class="msg-text" style="font-size:14px">${markdown(m.content) || '<i class="muted">(ek veya etkileşimli mesaj)</i>'}</div></div>
          <button class="btn red sm" data-mdel="${m.id}">Sil</button></div>`).join('') || '<p class="muted">Mesaj bulunamadı.</p>';
      } catch (e) { ctx.fail(e); }
    };
    let t;
    el.querySelector('#am-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
    el.querySelector('[data-all]')?.addEventListener('click', () => PAGES.messages(el, ctl));
    el.onclick = async (e) => {
      const b = e.target.closest('[data-mdel]');
      if (!b) return;
      try { await api.del('/admin/messages/' + b.dataset.mdel); b.closest('.table-row').remove(); ctx.toast('Mesaj silindi', 'ok'); } catch (err) { ctx.fail(err); }
    };
    load();
  },

  async announce(el) {
    el.innerHTML = '<h2>Duyuru ve Ayarlar</h2><p class="muted">Yükleniyor…</p>';
    let s;
    try { s = await api.get('/admin/settings'); } catch (e) { return ctx.fail(e); }
    el.innerHTML = `<h2>Duyuru ve Ayarlar</h2>
      <h3>📢 Site Duyurusu</h3>
      <div class="card">
        <p class="muted" style="margin-top:0">Tüm kullanıcıların ekranının üstünde görünen bir duyuru yayınla. Boş bırakıp yayınlarsan duyuru kaldırılır.</p>
        <textarea class="textarea" id="an-text" maxlength="500" placeholder="Örn: Bu akşam 22:00'de bakım çalışması yapılacak.">${esc(s.announcement?.text || '')}</textarea>
        <div class="row" style="margin-top:10px"><select class="input" id="an-level" style="width:auto">
          <option value="info" ${s.announcement?.level === 'info' ? 'selected' : ''}>ℹ️ Bilgi</option>
          <option value="warn" ${s.announcement?.level === 'warn' ? 'selected' : ''}>⚠️ Uyarı</option>
          <option value="success" ${s.announcement?.level === 'success' ? 'selected' : ''}>🎉 Müjde</option></select>
          <button class="btn" data-pub>Yayınla</button><button class="btn ghost" data-clear>Duyuruyu Kaldır</button></div>
      </div>
      <h3>👥 Kayıtlar</h3>
      <div class="card"><label class="check"><input type="checkbox" id="reg-open" ${s.registration === 'open' ? 'checked' : ''}><div><b>Yeni kayıtlara izin ver</b><small>Kapatırsan yalnızca mevcut kullanıcılar giriş yapabilir.</small></div></label></div>
      <h3>✉️ E-posta (SMTP)</h3>
      <div class="card">
        <p style="margin-top:0">${s.mail_configured ? '✅ SMTP ayarlı.' : '❌ SMTP ayarlı değil.'} Ayarlar sunucunun ortam değişkenlerinden okunur (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).</p>
        <div class="row"><input class="input grow" id="mail-to" type="email" placeholder="Test e-postası alıcısı" value="${esc(ctx.S.me.email || '')}"><button class="btn secondary" data-test>Test Gönder</button></div>
      </div>`;
    const publish = async (text) => {
      try { await api.patch('/admin/settings', { announcement: text, level: el.querySelector('#an-level').value }); ctx.toast(text ? 'Duyuru yayınlandı' : 'Duyuru kaldırıldı', 'ok'); } catch (e) { ctx.fail(e); }
    };
    el.querySelector('[data-pub]').onclick = () => publish(el.querySelector('#an-text').value);
    el.querySelector('[data-clear]').onclick = () => { el.querySelector('#an-text').value = ''; publish(''); };
    el.querySelector('#reg-open').onchange = async (e) => {
      try { await api.patch('/admin/settings', { registration: e.target.checked ? 'open' : 'closed' }); ctx.toast('Kaydedildi', 'ok'); } catch (err) { ctx.fail(err); }
    };
    el.querySelector('[data-test]').onclick = async () => {
      try { await api.post('/admin/test-email', { to: el.querySelector('#mail-to').value }); ctx.toast('Test e-postası gönderildi', 'ok'); } catch (e) { ctx.fail(e); }
    };
  },

  async audit(el) {
    el.innerHTML = '<h2>İşlem Kayıtları</h2><p class="muted">Yükleniyor…</p>';
    try {
      const list = await api.get('/admin/audit');
      el.innerHTML = '<h2>İşlem Kayıtları</h2>' + (list.map((a) => `<div class="table-row">${avatar(a.actor, 28)}
        <div class="meta"><b>${esc(a.actor?.display_name || 'Silinmiş')}</b> ${a.target_user ? `<b>${esc(a.target_user.username)}</b> kullanıcısını ` : ''}${ACTION_TR[a.action] || esc(a.action)}
          <small>${fmtTime(a.created_at)}${a.details?.reason ? ' • Sebep: ' + esc(a.details.reason) : ''}${a.details?.minutes ? ' • ' + a.details.minutes + ' dk' : ''}${a.details?.name ? ' • ' + esc(a.details.name) : ''}</small></div></div>`).join('')
        || '<div class="empty"><div class="art">📜</div><p>Henüz kayıt yok.</p></div>');
    } catch (e) { ctx.fail(e); }
  },
};

function muteModal(u, after) {
  ctx.modal({
    title: `${esc(u.username)} kullanıcısını sustur`,
    sub: 'Susturulan kullanıcı hiçbir kanala mesaj yazamaz ve seste konuşamaz.',
    body: `<label class="field"><span>Süre</span><select class="input" id="mu-min">
      <option value="10">10 dakika</option><option value="60" selected>1 saat</option><option value="360">6 saat</option>
      <option value="1440">1 gün</option><option value="10080">1 hafta</option><option value="43200">30 gün</option></select></label>
      <label class="field"><span>Sebep (kullanıcıya gösterilir)</span><input class="input" id="mu-reason" maxlength="200"></label>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn red" data-ok>Sustur</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        try { await api.post(`/admin/users/${u.id}/mute`, { minutes: +m.querySelector('#mu-min').value, reason: m.querySelector('#mu-reason').value }); close(); ctx.toast('Kullanıcı susturuldu', 'ok'); after(); } catch (e) { ctx.fail(e); }
      };
    },
  });
}

function banModal(u, after) {
  ctx.modal({
    title: `${esc(u.username)} kullanıcısını siteden yasakla`,
    sub: 'Yasaklanan kullanıcının tüm oturumları kapanır ve bir daha giriş yapamaz.',
    body: '<label class="field"><span>Sebep</span><input class="input" id="bn-reason" maxlength="256"></label>',
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn red" data-ok>Yasakla</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        try { await api.post(`/admin/users/${u.id}/ban`, { reason: m.querySelector('#bn-reason').value }); close(); ctx.toast('Kullanıcı yasaklandı', 'ok'); after(); } catch (e) { ctx.fail(e); }
      };
    },
  });
}
