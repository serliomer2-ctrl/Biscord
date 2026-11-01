// Giriş sonrası adımlar (2FA, zorunlu şifre değişikliği), şifre sıfırlama ve güvenlik ayarları
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { $, esc, icon } from '../util.js';

const card = (inner) => `<div class="auth"><form class="auth-card" id="auth-form" novalidate>
  <div class="auth-brand"><img src="/favicon.svg" alt="">Biscord</div>${inner}</form></div>`;

// Giriş yanıtını işle: 2FA, zorunlu şifre değişikliği ya da doğrudan bağlan
export function handleLogin(res) {
  if (res.mfa_required) return showMfa(res);
  api.setToken(res.token);
  if (res.must_change_password) return showForcedChange();
  ctx.startApp();
}

export function showMfa({ ticket, methods, email_hint }) {
  let method = methods[0];
  const draw = (msg = '') => {
    const isEmail = method === 'email';
    ctx.root.innerHTML = card(`
      <h1>İki adımlı doğrulama</h1>
      <p class="sub">${isEmail ? `<b>${esc(email_hint || 'e-posta adresine')}</b> gönderilen 6 haneli kodu gir.` : 'Authenticator uygulamandaki 6 haneli kodu ya da bir yedek kodu gir.'}</p>
      <label class="field"><span>${isEmail ? 'E-posta Kodu' : 'Doğrulama Kodu'}</span>
        <input class="input code-input" name="code" inputmode="${isEmail ? 'numeric' : 'text'}" autocomplete="one-time-code" maxlength="12" placeholder="${isEmail ? '123456' : '123456 veya ABCD-1234'}"></label>
      <div class="form-error" id="auth-error">${esc(msg)}</div>
      <button class="btn block" type="submit">Doğrula</button>
      <div class="auth-switch">
        ${methods.length > 1 ? `<a data-switch>${isEmail ? 'Authenticator kodu kullan' : 'Kodu e-postama gönder'}</a> · ` : ''}
        ${isEmail ? '<a data-resend>Kodu tekrar gönder</a> · ' : ''}<a data-back>Girişe dön</a></div>`);
    const form = $('#auth-form');
    form.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const r = await api.post('/auth/mfa', { ticket, method, code: form.code.value.trim() });
        handleLogin(r);
      } catch (err) { $('#auth-error').textContent = err.message; btn.disabled = false; }
    };
    form.querySelector('[data-back]').onclick = () => ctx.showAuth('login');
    form.querySelector('[data-switch]')?.addEventListener('click', async () => {
      method = method === 'email' ? 'totp' : 'email';
      if (method === 'email') {
        try { await api.post('/auth/mfa/email', { ticket }); } catch (err) { return draw(err.message); }
      }
      draw();
    });
    form.querySelector('[data-resend]')?.addEventListener('click', async () => {
      try { await api.post('/auth/mfa/email', { ticket }); draw('Yeni kod gönderildi.'); } catch (err) { draw(err.message); }
    });
  };
  draw();
}

export function showForcedChange() {
  ctx.root.innerHTML = card(`
    <h1>Şifreni değiştir</h1>
    <p class="sub">Güvenliğin için devam etmeden önce yeni bir şifre belirlemelisin.</p>
    <label class="field"><span>Mevcut Şifre</span><input class="input" type="password" name="password" autocomplete="current-password"></label>
    <label class="field"><span>Yeni Şifre</span><input class="input" type="password" name="new_password" autocomplete="new-password"><small>En az 8 karakter. Harf, rakam ve sembol karıştırmak önerilir.</small></label>
    <label class="field"><span>Yeni Şifre (Tekrar)</span><input class="input" type="password" name="confirm" autocomplete="new-password"></label>
    <div class="form-error" id="auth-error"></div>
    <button class="btn block" type="submit">Şifreyi Değiştir ve Devam Et</button>
    <div class="auth-switch"><a data-back>Çıkış yap</a></div>`);
  const form = $('#auth-form');
  form.password.focus();
  form.querySelector('[data-back]').onclick = () => { api.setToken(null); ctx.showAuth('login'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (form.new_password.value !== form.confirm.value) { $('#auth-error').textContent = 'Yeni şifreler eşleşmiyor'; return; }
    try {
      await api.patch('/users/@me', { password: form.password.value, new_password: form.new_password.value });
      ctx.startApp();
    } catch (err) { $('#auth-error').textContent = err.message; }
  };
}

export function showForgot() {
  let login = '';
  const step1 = () => {
    ctx.root.innerHTML = card(`
      <h1>Şifreni mi unuttun?</h1>
      <p class="sub">Kullanıcı adını veya e-posta adresini gir. Hesabında doğrulanmış bir e-posta varsa sıfırlama kodu göndereceğiz.</p>
      <label class="field"><span>Kullanıcı adı veya e-posta</span><input class="input" name="login" autocomplete="username"></label>
      <div class="form-error" id="auth-error"></div>
      <button class="btn block" type="submit">Kod Gönder</button>
      <div class="auth-switch"><a data-back>Girişe dön</a></div>`);
    const form = $('#auth-form');
    form.login.focus();
    form.querySelector('[data-back]').onclick = () => ctx.showAuth('login');
    form.onsubmit = async (e) => {
      e.preventDefault();
      login = form.login.value.trim();
      if (!login) return;
      try { await api.post('/auth/forgot', { login }); step2(); } catch (err) { $('#auth-error').textContent = err.message; }
    };
  };
  const step2 = () => {
    ctx.root.innerHTML = card(`
      <h1>Kodu gir</h1>
      <p class="sub">Hesap bulunduysa e-postana 6 haneli bir kod gönderdik. Gelen kutunu (ve gereksiz klasörünü) kontrol et.</p>
      <label class="field"><span>Kod</span><input class="input code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
      <label class="field"><span>Yeni Şifre</span><input class="input" type="password" name="password" autocomplete="new-password"></label>
      <div class="form-error" id="auth-error"></div>
      <button class="btn block" type="submit">Şifreyi Sıfırla</button>
      <div class="auth-switch"><a data-again>Kodu tekrar gönder</a> · <a data-back>Girişe dön</a></div>`);
    const form = $('#auth-form');
    form.code.focus();
    form.querySelector('[data-back]').onclick = () => ctx.showAuth('login');
    form.querySelector('[data-again]').onclick = async () => { try { await api.post('/auth/forgot', { login }); ctx.toast('Kod yeniden gönderildi'); } catch (err) { ctx.fail(err); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.post('/auth/reset', { login, code: form.code.value.trim(), password: form.password.value });
        ctx.showAuth('login');
        ctx.toast('Şifren değiştirildi, yeni şifrenle giriş yapabilirsin', 'ok');
      } catch (err) { $('#auth-error').textContent = err.message; }
    };
  };
  step1();
}

// ---------------------------------------------------------------- Ayarlar → Gizlilik ve Güvenlik
const askPassword = (title, extraField = '') => new Promise((resolve) => {
  let done = false;
  const { el } = ctx.modal({
    title, sub: 'Devam etmek için şifreni gir.',
    body: `<form id="pw-form"><label class="field"><span>Şifre</span><input class="input" type="password" name="password" autocomplete="current-password"></label>${extraField}</form>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Devam</button>',
    onMount(m, close) {
      const go = (e) => { e?.preventDefault(); done = true; const f = m.querySelector('#pw-form'); const v = Object.fromEntries(new FormData(f)); close(); resolve(v); };
      m.querySelector('#pw-form').onsubmit = go;
      m.querySelector('[data-ok]').onclick = go;
    },
  });
  new MutationObserver((_, o) => { if (!el.isConnected) { o.disconnect(); if (!done) resolve(null); } }).observe(ctx.layers, { childList: true });
});

const askCode = (title, sub) => ctx.promptDialog(title, 'Kod', '', { sub, ok: 'Doğrula', max: 12 });

function showBackupCodes(codes) {
  ctx.modal({
    title: 'Yedek kodların',
    sub: 'Telefonuna erişemezsen bu kodlarla giriş yapabilirsin. Her kod <b>bir kez</b> kullanılabilir. Güvenli bir yere kaydet — bir daha gösterilmeyecek!',
    body: `<div class="backup-codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>`,
    foot: '<button class="btn secondary" data-copy>Kopyala</button><button class="btn secondary" data-dl>İndir (.txt)</button><button class="btn" data-close>Kaydettim</button>',
    onMount(m) {
      const text = `Biscord yedek kodları\n\n${codes.join('\n')}\n`;
      m.querySelector('[data-copy]').onclick = () => ctx.copy(text, 'Kodlar kopyalandı');
      m.querySelector('[data-dl]').onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.download = 'biscord-yedek-kodlar.txt';
        a.click();
      };
    },
  });
}

export async function securityPage(el, ctl) {
  el.innerHTML = '<h2>Gizlilik ve Güvenlik</h2><p class="muted">Yükleniyor…</p>';
  let s;
  try { s = await api.get('/users/@me/security'); } catch (e) { return ctx.fail(e); }
  const refresh = () => securityPage(el, ctl);
  el.innerHTML = `<h2>Gizlilik ve Güvenlik</h2>
    ${!s.mail_configured ? `<div class="notice warn">${icon('bell', 'sm')} Sunucuda e-posta (SMTP) ayarlı değil. E-posta kodları gönderilemez; site yöneticisinin SMTP ayarlarını yapması gerekir.</div>` : ''}
    <h3>E-posta</h3>
    <div class="card">
      <div class="kv"><div><small>E-posta adresi</small>${s.email ? `${esc(s.email)} ${s.email_verified ? '<span class="pill ok">Doğrulandı</span>' : '<span class="pill warn">Doğrulanmadı</span>'}` : '<span class="muted">Eklenmedi</span>'}</div>
        <div class="row">${s.email && !s.email_verified ? '<button class="btn sm" data-verify>Doğrula</button>' : ''}<button class="btn secondary sm" data-email>${s.email ? 'Değiştir' : 'E-posta Ekle'}</button>${s.email ? '<button class="btn ghost sm danger" data-email-rm>Kaldır</button>' : ''}</div></div>
      <small class="muted">E-posta adresin şifre sıfırlama ve giriş kodları için kullanılır, kimseye gösterilmez.</small>
    </div>
    <h3>Şifre</h3>
    <div class="card"><div class="kv"><div>Şifreni değiştirdiğinde diğer cihazlardaki oturumların kapanır.</div><button class="btn sm" data-pw>Şifreyi Değiştir</button></div></div>
    <h3>İki Adımlı Doğrulama (2FA)</h3>
    <div class="card">
      <div class="kv"><div><b>📱 Authenticator Uygulaması</b> ${s.totp_enabled ? '<span class="pill ok">Açık</span>' : ''}
        <small class="muted" style="display:block;text-transform:none;font-weight:400">Google Authenticator, Microsoft Authenticator gibi bir uygulamayla her girişte 6 haneli kod iste. En güvenli yöntem.</small></div>
        ${s.totp_enabled ? '<button class="btn red sm" data-totp-off>Kapat</button>' : '<button class="btn sm" data-totp-on>Etkinleştir</button>'}</div>
      ${s.totp_enabled ? `<div class="kv"><div><small>Yedek kodlar</small>${s.backup_codes_left} kod kaldı</div><button class="btn secondary sm" data-backup>Yeni Kodlar Oluştur</button></div>` : ''}
      <div class="kv"><div><b>✉️ E-posta ile Giriş Kodu</b> ${s.email_2fa ? '<span class="pill ok">Açık</span>' : ''}
        <small class="muted" style="display:block;text-transform:none;font-weight:400">Her girişte e-posta adresine bir kod gönderilir. ${!s.email_verified ? 'Önce e-postanı doğrulamalısın.' : ''}</small></div>
        <button class="btn ${s.email_2fa ? 'red' : ''} sm" data-email2fa ${!s.email_verified ? 'disabled' : ''}>${s.email_2fa ? 'Kapat' : 'Etkinleştir'}</button></div>
      <div class="kv"><div><b>💬 SMS ile Doğrulama</b><small class="muted" style="display:block;text-transform:none;font-weight:400">SMS göndermek ücretli bir servis gerektirdiği için şu an kullanılamıyor. Authenticator uygulaması ücretsizdir ve SMS'ten daha güvenlidir.</small></div>
        <button class="btn secondary sm" disabled>Yakında</button></div>
    </div>
    <h3>Oturumlar</h3>
    <div class="card"><div class="kv"><div>Bu hesapta <b>${s.sessions}</b> açık oturum var.</div><button class="btn secondary sm" data-others>Diğer cihazlardan çıkış yap</button></div></div>`;

  const q = (sel) => el.querySelector(sel);
  q('[data-pw]').onclick = () => ctx.changePasswordModal();
  q('[data-others]').onclick = async () => { try { await api.post('/users/@me/sessions/logout-others'); ctx.toast('Diğer oturumlar kapatıldı', 'ok'); refresh(); } catch (e) { ctx.fail(e); } };

  const verifyFlow = async () => {
    const code = await askCode('E-postanı doğrula', 'E-posta adresine gönderilen 6 haneli kodu gir.');
    if (code === null) return;
    try { await api.post('/users/@me/email/verify', { code }); ctx.toast('E-posta doğrulandı', 'ok'); refresh(); } catch (e) { ctx.fail(e); }
  };
  q('[data-verify]')?.addEventListener('click', async () => {
    const v = await askPassword('E-posta doğrulama', `<input type="hidden" name="email" value="${esc(s.email)}">`);
    if (!v) return;
    try { await api.post('/users/@me/email', { email: s.email, password: v.password }); verifyFlow(); } catch (e) { ctx.fail(e); }
  });
  q('[data-email]').onclick = async () => {
    const v = await askPassword(s.email ? 'E-postayı değiştir' : 'E-posta ekle', `<label class="field"><span>E-posta adresi</span><input class="input" type="email" name="email" autocomplete="email"></label>`);
    if (!v) return;
    try {
      const r = await api.post('/users/@me/email', { email: v.email, password: v.password });
      if (!r.mail_configured) ctx.toast('SMTP ayarlı değil: kod sunucu kayıtlarına yazıldı', 'error');
      verifyFlow();
    } catch (e) { ctx.fail(e); }
  };
  q('[data-email-rm]')?.addEventListener('click', async () => {
    const v = await askPassword('E-postayı kaldır');
    if (!v) return;
    try { await api.del('/users/@me/email', v); refresh(); } catch (e) { ctx.fail(e); }
  });
  q('[data-email2fa]').onclick = async () => {
    const v = await askPassword(s.email_2fa ? 'E-posta kodunu kapat' : 'E-posta kodunu aç');
    if (!v) return;
    try { await api.post('/users/@me/2fa/email', { password: v.password, enabled: !s.email_2fa }); refresh(); } catch (e) { ctx.fail(e); }
  };
  q('[data-totp-on]')?.addEventListener('click', async () => {
    const v = await askPassword('Authenticator kurulumu');
    if (!v) return;
    let setup;
    try { setup = await api.post('/users/@me/2fa/totp/setup', { password: v.password }); } catch (e) { return ctx.fail(e); }
    ctx.modal({
      title: 'Authenticator kurulumu',
      body: `<ol class="steps">
        <li>Telefonuna <b>Google Authenticator</b> veya <b>Microsoft Authenticator</b> uygulamasını indir.</li>
        <li>Uygulamada <b>+</b> → <b>QR kodu tara</b> ve aşağıdaki kodu okut.</li>
        <li>Uygulamanın gösterdiği 6 haneli kodu aşağıya yaz.</li></ol>
        <div style="text-align:center"><img src="${setup.qr}" alt="QR kodu" width="200" height="200" style="background:#fff;border-radius:8px;padding:6px"></div>
        <p class="muted" style="font-size:13px;text-align:center">QR okutamıyor musun? Bu anahtarı elle gir:<br><code class="inline" style="user-select:all">${esc(setup.secret)}</code></p>
        <label class="field"><span>6 haneli kod</span><input class="input code-input" id="totp-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
        <div class="form-error" id="totp-err"></div>`,
      foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Etkinleştir</button>',
      onMount(m, close) {
        const go = async () => {
          try {
            const r = await api.post('/users/@me/2fa/totp/enable', { code: m.querySelector('#totp-code').value });
            close();
            showBackupCodes(r.backup_codes);
            refresh();
          } catch (e) { m.querySelector('#totp-err').textContent = e.message; }
        };
        m.querySelector('[data-ok]').onclick = go;
        m.querySelector('#totp-code').onkeydown = (e) => { if (e.key === 'Enter') go(); };
        setTimeout(() => m.querySelector('#totp-code').focus(), 50);
      },
    });
  });
  q('[data-totp-off]')?.addEventListener('click', async () => {
    const v = await askPassword('Authenticator\'ı kapat', '<label class="field"><span>Authenticator kodu</span><input class="input" name="code" inputmode="numeric" maxlength="6"></label>');
    if (!v) return;
    try { await api.post('/users/@me/2fa/totp/disable', v); ctx.toast('Authenticator kapatıldı'); refresh(); } catch (e) { ctx.fail(e); }
  });
  q('[data-backup]')?.addEventListener('click', async () => {
    const v = await askPassword('Yeni yedek kodlar', '<p class="muted" style="font-size:13px">Eski yedek kodların geçersiz olacak.</p>');
    if (!v) return;
    try { const r = await api.post('/users/@me/2fa/backup-codes', v); showBackupCodes(r.backup_codes); refresh(); } catch (e) { ctx.fail(e); }
  });
}
