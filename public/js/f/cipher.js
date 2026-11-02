// Şifreli sohbet: mesaj gizli anahtarla AES-GCM ile şifrelenir; ekranda Mors / ikili / runik / emoji olarak görünür.
// Anahtarı bilenler üzerine gelince orijinal metni görür. Anahtar sunucuya hiç gönderilmez.
import { ctx } from '../ctx.js';
import { esc, store } from '../util.js';

export const ALPHABETS = { binary: '💾 İkili (01000001)', morse: '📡 Mors (.- -...)', rune: 'ᚱ Runik', emoji: '🔮 Emoji' };
const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
const EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '⭐', '✨', '🔮', '🗝️', '🌀', '🔥', '💧', '🍃'];
const MORSE = ['.-', '-...', '-.-.', '-..', '.', '..-.', '--.', '....', '..', '.---', '-.-', '.-..', '--', '-.', '---', '.--.'];

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { ct: b64(ct), iv: b64(iv), salt: b64(salt) };
}

export async function decrypt(c, pass) {
  const key = await deriveKey(pass, unb64(c.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(c.iv) }, key, unb64(c.ct));
  return new TextDecoder().decode(pt);
}

// Şifreli baytları seçilen alfabeyle göster
function render(c, max = 90) {
  const bytes = unb64(c.ct).slice(0, 48);
  let out = '';
  for (const b of bytes) {
    if (c.alphabet === 'binary') out += b.toString(2).padStart(8, '0') + ' ';
    else if (c.alphabet === 'morse') out += MORSE[b >> 4] + ' ' + MORSE[b & 15] + ' / ';
    else if (c.alphabet === 'rune') out += RUNES[b % RUNES.length] + RUNES[(b >> 3) % RUNES.length];
    else out += EMOJI[b >> 4] + EMOJI[b & 15];
    if (out.length > max) break;
  }
  return out.trim() + '…';
}

// Kanal başına kayıtlı anahtarlar (yalnızca bu cihazda)
const keyring = () => store.get('cipherKeys', {});
const saveKey = (cid, pass) => { const k = keyring(); k[cid] = [...new Set([pass, ...(k[cid] || [])])].slice(0, 5); store.set('cipherKeys', k); };

const plainCache = new Map();
export function cipherHTML(m) {
  const c = m.components;
  if (c?.type !== 'cipher') return '';
  const plain = plainCache.get(m.id);
  return `<div class="cipher ${plain != null ? 'unlocked' : ''}" data-cipher="${m.id}">
    <div class="cipher-ct ${c.alphabet}">${esc(render(c))}</div>
    ${plain != null ? `<div class="cipher-pt">🔓 ${esc(plain)}</div>` : `<button class="link-btn" data-action="cipher-key" data-mid="${m.id}">🔑 Anahtarı gir</button>`}
    ${c.hint ? `<small class="muted">İpucu: ${esc(c.hint)}</small>` : ''}</div>`;
}

// Mesaj görününce kayıtlı anahtarlarla sessizce çözmeyi dene
export async function tryUnlock(m) {
  if (m.components?.type !== 'cipher' || plainCache.has(m.id)) return;
  for (const pass of keyring()[m.channel_id] || []) {
    try { plainCache.set(m.id, await decrypt(m.components, pass)); ctx.replaceMessage?.(m.id); return; } catch { /* yanlış anahtar */ }
  }
}

export async function askKey(m) {
  const pass = await ctx.promptDialog('🔑 Gizli anahtar', 'Anahtar', '', { sub: 'Bu mesajı çözmek için gönderenin paylaştığı anahtarı gir. Anahtar yalnızca bu cihazda saklanır.', ok: 'Çöz', max: 128 });
  if (!pass) return;
  try {
    plainCache.set(m.id, await decrypt(m.components, pass));
    saveKey(m.channel_id, pass);
    ctx.renderMessages?.();
  } catch { ctx.toast('Anahtar yanlış', 'error'); }
}

export function cipherModal(ch) {
  ctx.modal({
    title: '🔐 Şifreli Mesaj',
    sub: 'Mesaj tarayıcında şifrelenir; sunucu ve diğerleri yalnızca anlamsız semboller görür. Anahtarı bilenler okuyabilir.',
    body: `<label class="field"><span>Mesaj</span><textarea class="textarea" id="cp-text" maxlength="2000"></textarea></label>
      <div class="row wrap"><label class="field grow"><span>Gizli anahtar</span><input class="input" id="cp-key" value="${esc((keyring()[ch.id] || [])[0] || '')}" maxlength="128"></label>
      <label class="field"><span>Görünüm</span><select class="input" id="cp-alpha">${Object.entries(ALPHABETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <label class="field"><span>İpucu (isteğe bağlı, herkes görür)</span><input class="input" id="cp-hint" maxlength="64" placeholder="Bizim takımın adı"></label>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Şifrele ve Gönder</button>',
    onMount(el, close) {
      el.querySelector('[data-ok]').onclick = async () => {
        const text = el.querySelector('#cp-text').value.trim();
        const pass = el.querySelector('#cp-key').value;
        if (!text || pass.length < 3) return ctx.toast('Mesaj ve en az 3 karakterlik anahtar gerekli', 'error');
        try {
          const enc = await encrypt(text, pass);
          const msg = await ctx.api.post(`/channels/${ch.id}/messages`, { components: { type: 'cipher', alphabet: el.querySelector('#cp-alpha').value, hint: el.querySelector('#cp-hint').value, ...enc } });
          saveKey(ch.id, pass);
          plainCache.set(msg.id, text);
          ctx.replaceMessage?.(msg.id); // mesaj anahtar kaydedilmeden önce çizilmiş olabilir
          close();
        } catch (e) { ctx.fail(e); }
      };
    },
  });
}
