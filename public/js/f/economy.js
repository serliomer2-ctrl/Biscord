// Biscord Coin, seviye ve mağaza arayüzü
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, avatar } from '../util.js';

const fmt = (n) => Number(n || 0).toLocaleString('tr-TR');

export async function shopModal(sid, tab = 'me') {
  let data;
  try { data = await api.get(`/servers/${sid}/economy`); } catch (e) { return ctx.fail(e); }
  if (!data.enabled) return ctx.toast('Bu sunucuda coin sistemi kapalı (Sunucu Ayarları → Özellikler)', 'error');
  const { el } = ctx.modal({ title: `🪙 ${esc(ctx.server(sid).name)} — Mağaza ve Seviye`, wide: true, body: '<div id="eco"></div>' });
  const box = el.querySelector('#eco');
  const draw = () => {
    const me = data.me;
    const pct = Math.round((me.into / me.need) * 100);
    box.innerHTML = `<div class="tabs">${[['me', 'Profilim'], ['shop', 'Mağaza'], ['top', 'Sıralama'], ['pay', 'Coin Gönder']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="eco-body">${PANES[tab](me, pct)}</div>`;
    box.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(); });
    BIND[tab]?.();
  };
  const PANES = {
    me: (me, pct) => `<div class="eco-hero">${avatar(ctx.S.me, 64)}<div class="grow">
        <div class="eco-level">Seviye <b>${me.level}</b> <span class="muted">• Sıralama #${me.rank}</span></div>
        <div class="xpbar"><i style="width:${pct}%"></i></div><small class="muted">${fmt(me.into)} / ${fmt(me.need)} XP — sonraki seviyeye ${fmt(me.need - me.into)} XP</small></div>
        <div class="coin-big">🪙 ${fmt(me.coins)}</div></div>
      <div class="card" style="margin-top:14px"><div class="kv"><div><b>🎁 Günlük Ödül</b><small style="text-transform:none;font-weight:400">${me.daily_ready ? `${data.daily} coin seni bekliyor!` : `Sonraki ödül: ${new Date(me.next_daily_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}</small></div>
        <button class="btn ${me.daily_ready ? 'green' : 'secondary'}" data-daily ${me.daily_ready ? '' : 'disabled'}>Ödülü Al</button></div></div>
      <p class="muted" style="font-size:13px">Mesaj yazdıkça (dakikada bir kez) XP ve coin kazanırsın. Seviye atladığında bonus coin alırsın!</p>`,
    shop: (me) => `<p class="muted" style="margin-top:0">Bakiyen: <b>🪙 ${fmt(me.coins)}</b></p>` + Object.entries(data.shop).map(([k, it]) => `
      <div class="shop-item"><div class="grow"><b>${esc(it.name)}</b><small>${esc(it.desc)}</small>
        ${it.input === 'color' ? '<div class="row" style="margin-top:6px"><input type="color" value="#ff6b6b" data-val="name_color"><span class="muted" style="font-size:12px">rengini seç</span></div>' : ''}
        ${it.input === 'text' ? '<input class="input" data-val="title" maxlength="24" placeholder="Unvanın (ör. Efsane)" style="margin-top:6px">' : ''}</div>
        <button class="btn sm" data-buy="${k}" ${me.coins < it.price ? 'disabled' : ''}>${it.price ? `🪙 ${fmt(it.price)}` : 'Ücretsiz'}</button></div>`).join(''),
    top: () => `<div class="leaderboard">${data.leaderboard.map((r) => {
      const u = ctx.user(r.user_id);
      return `<div class="lb-row ${r.user_id === ctx.S.me.id ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][r.rank - 1] || '#' + r.rank}</span>${avatar(u, 32)}<b class="grow">${esc(ctx.displayName(r.user_id, sid))}</b><span>Sv. ${r.level}</span><span class="muted">${fmt(r.xp)} XP</span><span>🪙 ${fmt(r.coins)}</span></div>`;
    }).join('') || '<p class="muted">Henüz kimse XP kazanmadı.</p>'}</div>`,
    pay: (me) => `<p class="muted" style="margin-top:0">Bakiyen: <b>🪙 ${fmt(me.coins)}</b></p>
      <label class="field"><span>Kime</span><select class="input" id="pay-to">${[...ctx.server(sid).members.keys()].filter((id) => id !== ctx.S.me.id && !ctx.user(id)?.is_bot).map((id) => `<option value="${id}">${esc(ctx.displayName(id, sid))}</option>`).join('')}</select></label>
      <label class="field"><span>Miktar</span><input class="input" id="pay-amt" type="number" min="1" max="${me.coins}" value="10"></label>
      <button class="btn" data-pay>Gönder</button>`,
  };
  const BIND = {
    me: () => box.querySelector('[data-daily]')?.addEventListener('click', async () => {
      try { const r = await api.post(`/servers/${sid}/economy/daily`); data.me = r.me; ctx.toast(`🎁 ${r.gained} coin kazandın!`, 'ok'); draw(); } catch (e) { ctx.fail(e); }
    }),
    shop: () => box.querySelectorAll('[data-buy]').forEach((b) => b.onclick = async () => {
      const item = b.dataset.buy;
      const value = box.querySelector(`[data-val="${item}"]`)?.value;
      try { const r = await api.post(`/servers/${sid}/economy/buy`, { item, value }); data.me = r.me; ctx.toast('Satın alındı! 🎉', 'ok'); draw(); } catch (e) { ctx.fail(e); }
    }),
    pay: () => box.querySelector('[data-pay]')?.addEventListener('click', async () => {
      try {
        const r = await api.post(`/servers/${sid}/economy/pay`, { user_id: box.querySelector('#pay-to').value, amount: +box.querySelector('#pay-amt').value });
        data.me = r.me;
        ctx.toast('Coin gönderildi', 'ok');
        draw();
      } catch (e) { ctx.fail(e); }
    }),
  };
  draw();
}

export async function claimDaily(sid) {
  try { const r = await api.post(`/servers/${sid}/economy/daily`); ctx.toast(`🎁 ${r.gained} coin kazandın! Bakiye: ${fmt(r.me.coins)}`, 'ok'); } catch (e) { ctx.fail(e); }
}
