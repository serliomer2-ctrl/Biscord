'use strict';
// Zamana dayalı tek kullanımlık şifre (RFC 6238) — Google/Microsoft Authenticator ile uyumlu
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let val = 0;
  let out = '';
  for (const b of buf) {
    val = ((val << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let val = 0;
  const out = [];
  for (const c of str.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = ((val << 5) | B32.indexOf(c)) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function verify(secret, code, window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, step + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

const uri = (secret, account) =>
  `otpauth://totp/Biscord:${encodeURIComponent(account)}?secret=${secret}&issuer=Biscord&digits=6&period=30`;

module.exports = { generateSecret, verify, uri, base32Encode, base32Decode, hotp };
