'use strict';
// Kayıt, giriş, iki adımlı doğrulama (Authenticator + e-posta kodu), e-posta doğrulama, şifre sıfırlama
const crypto = require('crypto');
const QRCode = require('qrcode');
const totp = require('./totp');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const CODE_TTL = 10 * 60e3;

module.exports = (ctx) => {
  const { api, q, bcrypt, now, sha, rand, clean, fail, ah, limited, auth, humanOnly, newId, getUser, settings, newSession } = ctx;

  const genCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const maskEmail = (e) => {
    if (!e) return null;
    const [u, d] = e.split('@');
    return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
  };

  async function sendCode(user, purpose, email = user.email) {
    if (!email) fail(400, 'Hesabında kayıtlı bir e-posta yok');
    if (limited(`mail:${user.id}`, 5, 15 * 60e3)) fail(429, 'Çok fazla kod istendi, 15 dakika sonra tekrar dene');
    const code = genCode();
    q.run(
      `INSERT INTO email_codes(user_id,purpose,code_hash,email,expires_at,attempts) VALUES(?,?,?,?,?,0)
       ON CONFLICT(user_id,purpose) DO UPDATE SET code_hash=excluded.code_hash, email=excluded.email, expires_at=excluded.expires_at, attempts=0`,
      user.id, purpose, sha(code), email, now() + CODE_TTL,
    );
    await ctx.mail.sendCode(email, purpose, code, user);
  }

  function checkCode(uid, purpose, code) {
    const row = q.get('SELECT * FROM email_codes WHERE user_id=? AND purpose=?', uid, purpose);
    if (!row || row.expires_at < now()) fail(400, 'Kodun süresi dolmuş, yeni bir kod iste');
    if (row.attempts >= 5) fail(429, 'Çok fazla hatalı deneme, yeni bir kod iste');
    if (sha(String(code || '').trim()) !== row.code_hash) {
      q.run('UPDATE email_codes SET attempts=attempts+1 WHERE user_id=? AND purpose=?', uid, purpose);
      fail(400, 'Kod hatalı');
    }
    q.run('DELETE FROM email_codes WHERE user_id=? AND purpose=?', uid, purpose);
    return row;
  }

  async function checkPassword(user, pw) {
    if (!(await bcrypt.compare(String(pw || ''), user.password_hash || ''))) fail(400, 'Şifre hatalı');
  }

  const findLogin = (login) => {
    const id = clean(login, 254).toLowerCase();
    return id.includes('@')
      ? q.get('SELECT * FROM users WHERE email=? AND is_bot=0', id)
      : q.get('SELECT * FROM users WHERE username=? AND is_bot=0', id);
  };

  const mfaMethods = (u) => {
    const m = [];
    if (u.totp_enabled) m.push('totp');
    if (u.email_2fa && u.email && u.email_verified) m.push('email');
    return m;
  };

  // ---------------------------------------------------------------- kayıt
  api.post('/auth/register', ah(async (req, res) => {
    if (settings.get('registration', 'open') === 'closed') fail(403, 'Yeni kayıtlar şu an kapalı');
    if (limited('reg:' + req.ip, 10, 3600e3)) fail(429, 'Çok fazla kayıt denemesi, sonra tekrar dene');
    const username = clean(req.body.username, 32).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const display = clean(req.body.display_name, 32) || username;
    const email = clean(req.body.email, 254).toLowerCase() || null;
    if (!ctx.USERNAME_RE.test(username)) fail(400, 'Kullanıcı adı 2-32 karakter olmalı ve sadece küçük harf, rakam, _ ve . içermeli');
    if (ctx.RESERVED_NAMES.has(username)) fail(409, 'Bu kullanıcı adı alınmış');
    if (password.length < 8) fail(400, 'Şifre en az 8 karakter olmalı');
    if (email && !EMAIL_RE.test(email)) fail(400, 'Geçerli bir e-posta adresi gir');
    if (q.get('SELECT 1 FROM users WHERE username=?', username)) fail(409, 'Bu kullanıcı adı alınmış');
    if (email && q.get('SELECT 1 FROM users WHERE email=?', email)) fail(409, 'Bu e-posta adresi başka bir hesapta kayıtlı');
    const id = newId();
    q.run('INSERT INTO users(id,username,password_hash,display_name,email,created_at) VALUES(?,?,?,?,?,?)',
      id, username, await bcrypt.hash(password, 10), display, email, now());
    let emailSent = false;
    if (email) {
      try { await sendCode(getUser(id), 'verify', email); emailSent = true; } catch { /* kayıt yine de tamam */ }
    }
    res.json({ token: newSession(id), email_verification_sent: emailSent });
  }));

  // ---------------------------------------------------------------- giriş
  api.post('/auth/login', ah(async (req, res) => {
    if (limited('login:' + req.ip, 20, 15 * 60e3)) fail(429, 'Çok fazla deneme, birkaç dakika bekle');
    const u = findLogin(req.body.username);
    if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash || ''))) fail(401, 'Kullanıcı adı veya şifre hatalı');
    if (u.banned) fail(403, `Hesabın yasaklandı${u.ban_reason ? ': ' + u.ban_reason : ''}`);
    const methods = mfaMethods(u);
    if (methods.length) {
      const ticket = rand(24);
      q.run('DELETE FROM mfa_tickets WHERE user_id=? OR expires_at<?', u.id, now());
      q.run('INSERT INTO mfa_tickets(ticket_hash,user_id,expires_at,attempts) VALUES(?,?,?,0)', sha(ticket), u.id, now() + CODE_TTL);
      if (methods[0] === 'email') await sendCode(u, 'login');
      return res.json({ mfa_required: true, ticket, methods, email_hint: maskEmail(u.email) });
    }
    res.json({ token: newSession(u.id), must_change_password: !!u.must_change_password });
  }));

  const ticketUser = (ticket) => {
    const t = q.get('SELECT * FROM mfa_tickets WHERE ticket_hash=?', sha(String(ticket || '')));
    if (!t || t.expires_at < now()) fail(401, 'Giriş süresi doldu, baştan giriş yap');
    if (t.attempts >= 6) fail(429, 'Çok fazla hatalı deneme, baştan giriş yap');
    return { t, u: getUser(t.user_id) };
  };

  api.post('/auth/mfa/email', ah(async (req, res) => {
    const { u } = ticketUser(req.body.ticket);
    if (!mfaMethods(u).includes('email')) fail(400, 'E-posta ile doğrulama açık değil');
    await sendCode(u, 'login');
    res.json({ ok: true, email_hint: maskEmail(u.email) });
  }));

  api.post('/auth/mfa', ah(async (req, res) => {
    const { t, u } = ticketUser(req.body.ticket);
    const code = String(req.body.code || '').trim();
    let ok = false;
    try {
      if (req.body.method === 'email') { checkCode(u.id, 'login', code); ok = true; }
      else if (u.totp_enabled && totp.verify(u.totp_secret, code)) ok = true;
      else {
        // yedek kod
        const codes = JSON.parse(u.backup_codes || '[]');
        const h = sha(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        if (codes.includes(h)) {
          q.run('UPDATE users SET backup_codes=? WHERE id=?', JSON.stringify(codes.filter((c) => c !== h)), u.id);
          ok = true;
        }
      }
    } catch (e) {
      q.run('UPDATE mfa_tickets SET attempts=attempts+1 WHERE ticket_hash=?', t.ticket_hash);
      throw e;
    }
    if (!ok) {
      q.run('UPDATE mfa_tickets SET attempts=attempts+1 WHERE ticket_hash=?', t.ticket_hash);
      fail(400, 'Kod hatalı');
    }
    q.run('DELETE FROM mfa_tickets WHERE ticket_hash=?', t.ticket_hash);
    if (u.banned) fail(403, 'Hesabın yasaklandı');
    res.json({ token: newSession(u.id), must_change_password: !!u.must_change_password });
  }));

  // ---------------------------------------------------------------- şifre sıfırlama
  api.post('/auth/forgot', ah(async (req, res) => {
    if (limited('forgot:' + req.ip, 8, 3600e3)) fail(429, 'Çok fazla istek, sonra tekrar dene');
    const u = findLogin(req.body.login);
    // hesabın var olup olmadığını belli etmemek için her durumda aynı yanıt
    if (u && u.email && u.email_verified && !u.banned) {
      try { await sendCode(u, 'reset'); } catch { /* sessiz */ }
    }
    res.json({ ok: true, mail_configured: ctx.mail.configured });
  }));

  api.post('/auth/reset', ah(async (req, res) => {
    if (limited('reset:' + req.ip, 15, 3600e3)) fail(429, 'Çok fazla deneme, sonra tekrar dene');
    const u = findLogin(req.body.login);
    if (!u || !u.email_verified) fail(400, 'Kod hatalı veya süresi dolmuş');
    checkCode(u.id, 'reset', req.body.code);
    const pw = String(req.body.password || '');
    if (pw.length < 8) fail(400, 'Yeni şifre en az 8 karakter olmalı');
    q.run('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?', await bcrypt.hash(pw, 10), u.id);
    q.run('DELETE FROM sessions WHERE user_id=?', u.id);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- hesap güvenliği
  api.get('/users/@me/security', auth, humanOnly, (req, res) => {
    const u = req.user;
    res.json({
      email: u.email, email_verified: !!u.email_verified, email_2fa: !!u.email_2fa, totp_enabled: !!u.totp_enabled,
      backup_codes_left: JSON.parse(u.backup_codes || '[]').length, mail_configured: ctx.mail.configured,
      sessions: q.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?', u.id).n,
    });
  });

  api.post('/users/@me/email', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    const email = clean(req.body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) fail(400, 'Geçerli bir e-posta adresi gir');
    const ex = q.get('SELECT id FROM users WHERE email=?', email);
    if (ex && ex.id !== req.user.id) fail(409, 'Bu e-posta adresi başka bir hesapta kayıtlı');
    await sendCode(req.user, 'verify', email);
    res.json({ ok: true, mail_configured: ctx.mail.configured });
  }));

  api.post('/users/@me/email/verify', auth, humanOnly, (req, res) => {
    const row = checkCode(req.user.id, 'verify', req.body.code);
    const ex = q.get('SELECT id FROM users WHERE email=?', row.email);
    if (ex && ex.id !== req.user.id) fail(409, 'Bu e-posta adresi başka bir hesapta kayıtlı');
    q.run('UPDATE users SET email=?, email_verified=1 WHERE id=?', row.email, req.user.id);
    res.json({ ok: true, email: row.email });
  });

  api.delete('/users/@me/email', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    q.run('UPDATE users SET email=NULL, email_verified=0, email_2fa=0 WHERE id=?', req.user.id);
    res.json({ ok: true });
  }));

  api.post('/users/@me/2fa/email', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    if (req.body.enabled && !(req.user.email && req.user.email_verified)) fail(400, 'Önce e-posta adresini doğrulamalısın');
    q.run('UPDATE users SET email_2fa=? WHERE id=?', req.body.enabled ? 1 : 0, req.user.id);
    res.json({ ok: true });
  }));

  api.post('/users/@me/2fa/totp/setup', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    if (req.user.totp_enabled) fail(400, 'Authenticator zaten etkin');
    const secret = totp.generateSecret();
    q.run('UPDATE users SET totp_secret=? WHERE id=?', secret, req.user.id);
    const uri = totp.uri(secret, req.user.username);
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  }));

  const newBackupCodes = (uid) => {
    const plain = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8));
    q.run('UPDATE users SET backup_codes=? WHERE id=?', JSON.stringify(plain.map((c) => sha(c))), uid);
    return plain.map((c) => `${c.slice(0, 4)}-${c.slice(4)}`);
  };

  api.post('/users/@me/2fa/totp/enable', auth, humanOnly, (req, res) => {
    const u = req.user;
    if (!u.totp_secret) fail(400, 'Önce kurulumu başlat');
    if (!totp.verify(u.totp_secret, req.body.code)) fail(400, 'Kod hatalı. Telefonunun saatinin doğru olduğundan emin ol.');
    q.run('UPDATE users SET totp_enabled=1 WHERE id=?', u.id);
    res.json({ ok: true, backup_codes: newBackupCodes(u.id) });
  });

  api.post('/users/@me/2fa/totp/disable', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    if (req.user.totp_enabled && !totp.verify(req.user.totp_secret, req.body.code)) fail(400, 'Authenticator kodu hatalı');
    q.run("UPDATE users SET totp_enabled=0, totp_secret=NULL, backup_codes='[]' WHERE id=?", req.user.id);
    res.json({ ok: true });
  }));

  api.post('/users/@me/2fa/backup-codes', auth, humanOnly, ah(async (req, res) => {
    await checkPassword(req.user, req.body.password);
    if (!req.user.totp_enabled) fail(400, 'Önce Authenticator ile doğrulamayı aç');
    res.json({ backup_codes: newBackupCodes(req.user.id) });
  }));

  api.post('/users/@me/sessions/logout-others', auth, (req, res) => {
    const current = sha(String(req.headers.authorization || '').replace(/^Bearer /, '').trim());
    q.run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?', req.user.id, current);
    res.json({ ok: true });
  });

  // READY içinde kullanıcının kendi güvenlik bayrakları
  ctx.hooks.ready.push((ready, uid) => {
    const u = getUser(uid);
    Object.assign(ready.user, { email: u.email, email_verified: !!u.email_verified, mfa_enabled: !!(u.totp_enabled || u.email_2fa), muted_until: u.muted_until || null });
  });
};
