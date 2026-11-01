// Zengin durum (Rich Presence): özel simge, başlık, ayrıntı ve sayaçlı durumlar
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc } from '../util.js';

const PRESETS = [
  ['🚀', 'Uzayda geziyor', 'Bilinmeyen galaksiler'], ['💻', 'Biscord 2.0 kodluyor', 'Hata ayıklıyor…'], ['🎮', 'Oyun oynuyor', ''],
  ['🎧', 'Müzik dinliyor', ''], ['📚', 'Ders çalışıyor', 'Sınav haftası'], ['🍿', 'Film izliyor', ''],
  ['😴', 'Uyuyor', 'Rahatsız etmeyin'], ['🏋️', 'Sporda', ''], ['🍳', 'Yemek yapıyor', ''], ['✈️', 'Yolda', ''],
];

export function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : m ? `${m} dk` : `${s} sn`;
}

// Listeler için kısa metin
export function presenceLine(u) {
  const p = u?.presence;
  if (p) return `${p.emoji ? p.emoji + ' ' : ''}${p.text || ''}`;
  return u?.custom_status || '';
}

// Profil kartı için ayrıntılı blok
export function presenceCard(u) {
  const p = u?.presence;
  if (!p) return u?.custom_status ? `<p style="margin-top:8px">${esc(u.custom_status)}</p>` : '';
  return `<div class="presence-card"><div class="pc-emoji">${esc(p.emoji || '✨')}</div><div class="grow">
    <b>${esc(p.text || '')}</b>${p.details ? `<div class="muted">${esc(p.details)}</div>` : ''}
    ${p.started_at ? `<div class="pc-timer" data-since="${p.started_at}">⏱ ${elapsed(p.started_at)}</div>` : ''}</div></div>`;
}

// Sayaçları canlı güncelle
setInterval(() => {
  document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = '⏱ ' + elapsed(+el.dataset.since); });
}, 1000);

export function presenceEditor() {
  const cur = ctx.S.me.presence || {};
  let emoji = cur.emoji || '✨';
  ctx.modal({
    title: 'Durumunu Tasarla',
    sub: 'Profilinde ve üye listesinde görünen, simgeli ve isteğe bağlı sayaçlı özel durum.',
    wide: true,
    body: `<div class="presence-presets">${PRESETS.map(([e, t, d], i) => `<button class="preset-chip" data-p="${i}">${e} ${esc(t)}</button>`).join('')}</div>
      <div class="row" style="align-items:flex-end;margin-top:14px">
        <div class="field"><span>Simge</span><button class="emoji-btn" id="pe-emoji" type="button">${esc(emoji)}</button></div>
        <label class="field grow"><span>Başlık</span><input class="input" id="pe-text" maxlength="64" value="${esc(cur.text || '')}" placeholder="Şu an uzayda geziyor"></label>
      </div>
      <label class="field"><span>Ayrıntı (isteğe bağlı)</span><input class="input" id="pe-details" maxlength="128" value="${esc(cur.details || '')}" placeholder="Mars yörüngesinde"></label>
      <div class="row wrap">
        <label class="check" style="border:0;padding:0"><input type="checkbox" id="pe-timer" ${cur.started_at ? 'checked' : ''}><div><b>Sayaç göster</b><small>"⏱ 25 dk" gibi geçen süre görünür</small></div></label>
        <label class="field grow" style="margin:0"><span>Temizle</span><select class="input" id="pe-exp">
          <option value="0">Temizleme</option><option value="1800">30 dakika sonra</option><option value="3600">1 saat sonra</option>
          <option value="14400">4 saat sonra</option><option value="86400">Yarın</option></select></label>
      </div>
      <h4 style="margin:16px 0 6px;font-size:12px;text-transform:uppercase;color:var(--text-3)">Önizleme</h4><div id="pe-prev"></div>`,
    foot: '<button class="btn ghost danger" data-clear style="margin-right:auto">Durumu Temizle</button><button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Kaydet</button>',
    onMount(m, close) {
      const q = (s) => m.querySelector(s);
      const prev = () => {
        q('#pe-prev').innerHTML = presenceCard({ presence: { emoji, text: q('#pe-text').value, details: q('#pe-details').value, started_at: q('#pe-timer').checked ? Date.now() : null } });
      };
      prev();
      m.addEventListener('input', prev);
      m.addEventListener('change', prev);
      q('#pe-emoji').onclick = (e) => ctx.emojiPicker(e.currentTarget, (em) => { emoji = em; q('#pe-emoji').textContent = em; prev(); });
      m.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
        const [e, t, d] = PRESETS[+b.dataset.p];
        emoji = e;
        q('#pe-emoji').textContent = e;
        q('#pe-text').value = t;
        q('#pe-details').value = d;
        q('#pe-timer').checked = true;
        prev();
      });
      q('[data-clear]').onclick = async () => { try { ctx.H.ME_UPDATE(await api.patch('/users/@me', { presence: null })); close(); } catch (e) { ctx.fail(e); } };
      q('[data-ok]').onclick = async () => {
        const text = q('#pe-text').value.trim();
        if (!text) return ctx.toast('Bir başlık yaz', 'error');
        const keepStart = cur.started_at && q('#pe-timer').checked && cur.text === text ? cur.started_at : Date.now();
        try {
          ctx.H.ME_UPDATE(await api.patch('/users/@me', { presence: { emoji, text, details: q('#pe-details').value, timer: q('#pe-timer').checked, started_at: keepStart, expires_in: +q('#pe-exp').value } }));
          close();
          ctx.toast('Durumun güncellendi', 'ok');
        } catch (e) { ctx.fail(e); }
      };
    },
  });
}
