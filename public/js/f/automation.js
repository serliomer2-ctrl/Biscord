// Kod bilmeden bot yap: blok tabanlı "EĞER → O ZAMAN" otomasyon kuralları
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, icon } from '../util.js';

const TRIG = {
  message_contains: { label: 'Mesaj şunu içeriyorsa', input: 'Kelime veya cümle', emoji: '💬' },
  message_equals: { label: 'Mesaj tam olarak şuysa', input: 'Tam metin', emoji: '🎯' },
  message_starts: { label: 'Mesaj şununla başlıyorsa', input: 'Başlangıç (ör. !kurallar)', emoji: '▶️' },
  member_join: { label: 'Biri sunucuya katıldığında', emoji: '👋' },
  link: { label: 'Mesajda bağlantı varsa', emoji: '🔗' },
  caps: { label: 'Mesaj BÜYÜK HARFLE yazılmışsa', emoji: '🔠' },
  mention_spam: { label: 'Mesaj çok fazla kişiyi etiketlerse', input: 'Etiket sınırı (ör. 5)', emoji: '📣' },
  bad_words: { label: 'Mesajda yasaklı kelime varsa', input: 'Virgülle ayrılmış kelimeler', emoji: '🤬' },
};
const ACT = {
  reply: { label: 'Kanala cevap yaz', emoji: '💬', fields: ['text'] },
  send: { label: 'Başka kanala mesaj gönder', emoji: '📨', fields: ['channel', 'text'] },
  dm: { label: 'Kişiye özel mesaj at', emoji: '✉️', fields: ['text'] },
  react: { label: 'Mesaja tepki ekle', emoji: '😀', fields: ['emoji'] },
  delete: { label: 'Mesajı sil', emoji: '🗑️', fields: [] },
  timeout: { label: 'Kişiyi zaman aşımına al', emoji: '⏳', fields: ['minutes'] },
  add_role: { label: 'Kişiye rol ver', emoji: '🛡️', fields: ['role'] },
  coins: { label: 'Coin ver / al', emoji: '🪙', fields: ['amount'] },
};
const TEMPLATES = [
  { name: 'Hoş geldin mesajı', trigger_type: 'member_join', actions: [{ type: 'reply', text: '👋 Hoş geldin {kullanici}! {sunucu} sunucusunun {uye_sayisi}. üyesisin 🎉' }] },
  { name: 'Küfür filtresi', trigger_type: 'bad_words', trigger_value: 'kötükelime1, kötükelime2', actions: [{ type: 'delete' }, { type: 'dm', text: 'Lütfen {sunucu} sunucusunda küfür etme 🙏' }] },
  { name: 'Link engelleyici', trigger_type: 'link', actions: [{ type: 'delete' }, { type: 'reply', text: '{kullanici}, bu sunucuda bağlantı paylaşmak yasak.' }] },
  { name: 'Büyük harf uyarısı', trigger_type: 'caps', actions: [{ type: 'reply', text: '{kullanici} lütfen bağırma 🙉' }] },
  { name: 'Kurallar komutu', trigger_type: 'message_equals', trigger_value: '!kurallar', actions: [{ type: 'reply', text: '📜 **Kurallar**\n1. Saygılı ol\n2. Spam yapma\n3. Eğlen!' }] },
  { name: 'Spam etiket koruması', trigger_type: 'mention_spam', trigger_value: '5', actions: [{ type: 'delete' }, { type: 'timeout', minutes: 10 }] },
];

export async function automationPage(sid, el) {
  el.innerHTML = '<h2>Otomasyon (Kendi Botunu Yap)</h2><p class="muted">Yükleniyor…</p>';
  let rules;
  try { rules = await api.get(`/servers/${sid}/automations`); } catch (e) { return ctx.fail(e); }
  const draw = () => {
    el.innerHTML = `<h2>🤖 Otomasyon — Kendi Botunu Yap</h2>
      <p class="muted">Kod bilmeden kurallar oluştur: <b>EĞER</b> bir şey olursa → <b>O ZAMAN</b> şunları yap. Cevaplarda <code class="inline">{kullanici}</code>, <code class="inline">{kullanici_adi}</code>, <code class="inline">{sunucu}</code>, <code class="inline">{kanal}</code>, <code class="inline">{uye_sayisi}</code> kullanabilirsin.</p>
      <div class="row wrap" style="margin-bottom:14px"><button class="btn" data-new>${icon('plus', 'sm')} Boş Kural</button>
        ${TEMPLATES.map((t, i) => `<button class="btn secondary sm" data-tpl="${i}">${esc(t.name)}</button>`).join('')}</div>
      ${rules.map((r) => `<div class="rule-card ${r.enabled ? '' : 'off'}">
        <div class="rule-blocks"><span class="blk if">${TRIG[r.trigger_type]?.emoji} EĞER ${esc(TRIG[r.trigger_type]?.label || r.trigger_type)}${r.trigger_value ? ` <i>“${esc(r.trigger_value)}”</i>` : ''}</span>
          ${r.actions.map((a) => `<span class="blk then">${ACT[a.type]?.emoji} ${esc(ACT[a.type]?.label || a.type)}</span>`).join('')}</div>
        <div class="row"><b class="grow">${esc(r.name)}</b>
          <label class="switch"><input type="checkbox" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''}><i></i></label>
          <button class="btn secondary sm" data-edit="${r.id}">Düzenle</button><button class="btn red sm" data-del="${r.id}">Sil</button></div></div>`).join('') || '<div class="empty"><div class="art">🤖</div><p>Henüz kural yok. Bir şablonla başla!</p></div>'}`;
  };
  draw();
  el.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-new]')) return builder(sid, null, onSaved);
    if (t.closest('[data-tpl]')) return builder(sid, { ...TEMPLATES[+t.closest('[data-tpl]').dataset.tpl] }, onSaved);
    const ed = t.closest('[data-edit]');
    if (ed) return builder(sid, rules.find((r) => r.id === ed.dataset.edit), onSaved);
    const del = t.closest('[data-del]');
    if (del && await ctx.confirmDialog('Kuralı sil', 'Bu otomasyon kuralı silinsin mi?', 'Sil')) {
      try { await api.del(`/servers/${sid}/automations/${del.dataset.del}`); rules = rules.filter((r) => r.id !== del.dataset.del); draw(); } catch (err) { ctx.fail(err); }
    }
  };
  el.onchange = async (e) => {
    const tg = e.target.closest('[data-toggle]');
    if (!tg) return;
    try { const r = await api.patch(`/servers/${sid}/automations/${tg.dataset.toggle}`, { enabled: tg.checked }); rules = rules.map((x) => (x.id === r.id ? r : x)); draw(); } catch (err) { ctx.fail(err); }
  };
  function onSaved(r) {
    const i = rules.findIndex((x) => x.id === r.id);
    if (i >= 0) rules[i] = r; else rules.push(r);
    draw();
  }
}

function builder(sid, rule, onSaved) {
  const s = ctx.server(sid);
  const channels = ctx.serverChannels(sid).filter((c) => c.type === 'text');
  const roles = [...s.roles.values()].filter((r) => r.id !== sid);
  const r = { name: 'Yeni kural', trigger_type: 'message_contains', trigger_value: '', actions: [{ type: 'reply', text: '' }], ...(rule || {}) };
  r.actions = r.actions.map((a) => ({ ...a }));
  const { el, close } = ctx.modal({ title: rule?.id ? 'Kuralı Düzenle' : 'Yeni Otomasyon Kuralı', wide: true, body: '<div id="bld"></div>', foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-save>Kaydet</button>' });
  const box = el.querySelector('#bld');
  const field = (a, i, f) => {
    if (f === 'text') return `<textarea class="input blk-in" data-i="${i}" data-k="text" rows="2" placeholder="Mesaj metni">${esc(a.text || '')}</textarea>`;
    if (f === 'channel') return `<select class="input blk-in" data-i="${i}" data-k="channel_id">${channels.map((c) => `<option value="${c.id}" ${c.id === a.channel_id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>`;
    if (f === 'emoji') return `<input class="input blk-in" data-i="${i}" data-k="emoji" maxlength="16" value="${esc(a.emoji || '👍')}" style="width:80px">`;
    if (f === 'minutes') return `<input class="input blk-in" type="number" min="1" max="10080" data-i="${i}" data-k="minutes" value="${a.minutes || 5}" style="width:100px"> dakika`;
    if (f === 'amount') return `<input class="input blk-in" type="number" data-i="${i}" data-k="amount" value="${a.amount || 10}" style="width:110px"> coin`;
    if (f === 'role') return `<select class="input blk-in" data-i="${i}" data-k="role_id">${roles.map((ro) => `<option value="${ro.id}" ${ro.id === a.role_id ? 'selected' : ''}>${esc(ro.name)}</option>`).join('') || '<option value="">Önce rol oluştur</option>'}</select>`;
    return '';
  };
  const draw = () => {
    const tr = TRIG[r.trigger_type];
    box.innerHTML = `<label class="field"><span>Kural adı</span><input class="input" id="b-name" maxlength="64" value="${esc(r.name)}"></label>
      <div class="block-canvas">
        <div class="block if"><div class="blk-title">EĞER</div>
          <select class="input" id="b-trig">${Object.entries(TRIG).map(([k, v]) => `<option value="${k}" ${k === r.trigger_type ? 'selected' : ''}>${v.emoji} ${v.label}</option>`).join('')}</select>
          ${tr.input ? `<input class="input" id="b-val" placeholder="${esc(tr.input)}" value="${esc(r.trigger_value || '')}">` : ''}</div>
        <div class="block-stack">${r.actions.map((a, i) => `<div class="block then" draggable="true" data-i="${i}">
          <div class="blk-title"><span class="grip">⋮⋮</span> O ZAMAN</div>
          <select class="input blk-type" data-i="${i}">${Object.entries(ACT).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v.emoji} ${v.label}</option>`).join('')}</select>
          ${ACT[a.type].fields.map((f) => field(a, i, f)).join('')}
          <button class="icon-btn blk-x" data-rm="${i}" title="Kaldır">${icon('x', 'sm')}</button></div>`).join('')}</div>
        ${r.actions.length < 6 ? `<button class="btn ghost sm" data-add-act>${icon('plus', 'sm')} Eylem bloğu ekle</button>` : ''}
      </div>
      <p class="muted" style="font-size:12.5px">İpucu: Blokları sürükleyip bırakarak sıralarını değiştirebilirsin. Moderatörler zaman aşımından etkilenmez.</p>`;
    box.querySelector('#b-trig').onchange = (e) => { r.trigger_type = e.target.value; draw(); };
  };
  draw();
  box.addEventListener('input', (e) => {
    if (e.target.id === 'b-name') r.name = e.target.value;
    if (e.target.id === 'b-val') r.trigger_value = e.target.value;
    if (e.target.classList.contains('blk-in')) r.actions[+e.target.dataset.i][e.target.dataset.k] = e.target.type === 'number' ? +e.target.value : e.target.value;
  });
  box.addEventListener('change', (e) => {
    if (e.target.classList.contains('blk-type')) { r.actions[+e.target.dataset.i] = { type: e.target.value }; draw(); }
    if (e.target.classList.contains('blk-in') && e.target.tagName === 'SELECT') r.actions[+e.target.dataset.i][e.target.dataset.k] = e.target.value;
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-act]')) { r.actions.push({ type: 'reply', text: '' }); draw(); }
    const rm = e.target.closest('[data-rm]');
    if (rm && r.actions.length > 1) { r.actions.splice(+rm.dataset.rm, 1); draw(); }
  });
  let dragI = null;
  box.addEventListener('dragstart', (e) => { const b = e.target.closest('.block.then'); if (b) { dragI = +b.dataset.i; b.classList.add('dragging'); } });
  box.addEventListener('dragover', (e) => { if (dragI !== null) e.preventDefault(); });
  box.addEventListener('drop', (e) => {
    const b = e.target.closest('.block.then');
    if (dragI === null || !b) return;
    e.preventDefault();
    const to = +b.dataset.i;
    const [m] = r.actions.splice(dragI, 1);
    r.actions.splice(to, 0, m);
    dragI = null;
    draw();
  });
  box.addEventListener('dragend', () => { dragI = null; box.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });
  el.querySelector('[data-save]').onclick = async () => {
    // seçilmemiş varsayılan değerleri doldur
    for (const a of r.actions) {
      if (ACT[a.type].fields.includes('channel') && !a.channel_id) a.channel_id = channels[0]?.id;
      if (ACT[a.type].fields.includes('role') && !a.role_id) a.role_id = roles[0]?.id;
      if (a.type === 'react' && !a.emoji) a.emoji = '👍';
      if (a.type === 'timeout' && !a.minutes) a.minutes = 5;
      if (a.type === 'coins' && !a.amount) a.amount = 10;
    }
    try {
      const saved = rule?.id ? await api.patch(`/servers/${sid}/automations/${rule.id}`, r) : await api.post(`/servers/${sid}/automations`, r);
      onSaved(saved);
      close();
      ctx.toast('Kural kaydedildi', 'ok');
    } catch (err) { ctx.fail(err); }
  };
}
