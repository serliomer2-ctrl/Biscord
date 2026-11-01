'use strict';
// E-posta gönderimi (SMTP). Ayarlar yoksa kodlar sunucu kayıtlarına yazılır.
const nodemailer = require('nodemailer');

module.exports = (ctx) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = host ? nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  }) : null;
  const from = process.env.SMTP_FROM || (process.env.SMTP_USER ? `Biscord <${process.env.SMTP_USER}>` : 'Biscord <no-reply@biscord.local>');

  const PURPOSE = {
    verify: { subject: 'E-posta adresini doğrula', line: 'Biscord hesabına bu e-posta adresini eklemek için doğrulama kodun:' },
    login: { subject: 'Giriş kodun', line: 'Biscord hesabına giriş yapmak için kodun:' },
    reset: { subject: 'Şifre sıfırlama kodu', line: 'Biscord şifreni sıfırlamak için kodun:' },
  };

  async function send(to, subject, text, html) {
    if (!transport) {
      console.log(`\n[E-POSTA — SMTP ayarlı değil] Alıcı: ${to}\nKonu: ${subject}\n${text}\n`);
      return false;
    }
    await transport.sendMail({ from, to, subject, text, html });
    return true;
  }

  async function sendCode(to, purpose, code, user) {
    const p = PURPOSE[purpose] || PURPOSE.verify;
    const text = `Merhaba ${user.display_name || user.username},\n\n${p.line}\n\n${code}\n\nKod 10 dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.\n\n— Biscord`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f5f5f7;border-radius:12px">
      <h2 style="color:#6c5ce7;margin:0 0 12px">Biscord</h2>
      <p>Merhaba <b>${escapeHtml(user.display_name || user.username)}</b>,</p>
      <p>${p.line}</p>
      <div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#fff;padding:16px;text-align:center;border-radius:8px">${code}</div>
      <p style="color:#666;font-size:13px">Kod 10 dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p></div>`;
    try {
      return await send(to, `Biscord — ${p.subject}`, text, html);
    } catch (e) {
      console.error('E-posta gönderilemedi:', e.message);
      ctx.fail(502, 'E-posta gönderilemedi. Yönetici SMTP ayarlarını kontrol etmeli.');
    }
  }

  ctx.mail = {
    configured: !!transport,
    send,
    sendCode,
    async verify() {
      if (!transport) return { ok: false, error: 'SMTP ayarlanmamış' };
      try { await transport.verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
    },
  };
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
