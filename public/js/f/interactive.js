// Mesaj içi etkileşimli bileşenler: anket, yapılacaklar listesi, seviye atlama kartı
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, icon, avatar } from '../util.js';

export function componentHTML(m, sid) {
  const c = m.components;
  if (!c) return '';
  const me = ctx.S.me.id;
  if (c.type === 'poll') {
    const closed = c.closed || (c.ends_at && c.ends_at < Date.now());
    const total = c.options.reduce((n, o) => n + o.votes.length, 0);
    const voters = new Set(c.options.flatMap((o) => o.votes)).size;
    const max = Math.max(1, ...c.options.map((o) => o.votes.length));
    return `<div class="poll ${closed ? 'closed' : ''}">
      <div class="poll-q">📊 ${esc(c.question)}</div>
      <div class="poll-sub">${c.multi ? 'Birden fazla seçebilirsin' : 'Bir seçenek seç'}${c.ends_at && !closed ? ` • ${endsIn(c.ends_at)} sonra kapanır` : ''}${closed ? ' • <b>Anket kapandı</b>' : ''}</div>
      ${c.options.map((o) => {
        const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
        const mine = o.votes.includes(me);
        const win = closed && o.votes.length === max && total > 0;
        return `<button class="poll-opt ${mine ? 'mine' : ''} ${win ? 'win' : ''}" data-action="poll-vote" data-mid="${m.id}" data-opt="${o.id}" ${closed ? 'disabled' : ''}>
          <span class="bar" style="width:${pct}%"></span>
          <span class="txt">${mine ? '✔ ' : ''}${esc(o.text)}</span>
          <span class="voters">${o.votes.slice(0, 3).map((u) => avatar(ctx.user(u) || { id: u }, 18)).join('')}</span>
          <span class="pct">${pct}% <small>(${o.votes.length})</small></span></button>`;
      }).join('')}
      <div class="poll-foot"><span>${voters} kişi oy verdi</span>${!closed && (m.author.id === me || ctx.can(sid, ctx.P.MANAGE_MESSAGES)) ? `<button class="link-btn" data-action="poll-close" data-mid="${m.id}">Anketi bitir</button>` : ''}</div>
    </div>`;
  }
  if (c.type === 'todo') {
    const done = c.items.filter((i) => i.done_by).length;
    return `<div class="todo">
      <div class="todo-head"><b>✅ ${esc(c.title)}</b><span class="muted">${done}/${c.items.length}</span></div>
      <div class="todo-progress"><i style="width:${c.items.length ? (done / c.items.length) * 100 : 0}%"></i></div>
      ${c.items.map((i) => {
        const who = i.done_by && ctx.user(i.done_by);
        return `<div class="todo-item ${i.done_by ? 'done' : ''}">
          <button class="todo-check" data-action="todo-toggle" data-mid="${m.id}" data-item="${i.id}" aria-label="İşaretle">${i.done_by ? icon('check', 'xs') : ''}</button>
          <span class="txt">${esc(i.text)}</span>
          ${who ? `<span class="todo-who" title="${esc(ctx.displayName(who.id, sid))} tamamladı">${avatar(who, 18)}${esc(ctx.displayName(who.id, sid))}</span>` : ''}
          <button class="todo-rm" data-action="todo-remove" data-mid="${m.id}" data-item="${i.id}" title="Kaldır">${icon('x', 'xs')}</button>
        </div>`;
      }).join('')}
      ${c.open || m.author.id === me ? `<form class="todo-add" data-todo-add="${m.id}"><input placeholder="+ Madde ekle" maxlength="200"></form>` : ''}
    </div>`;
  }
  if (c.type === 'levelup') {
    return `<div class="levelup">🎉 <b>Seviye ${c.level}</b> oldu! <span class="muted">+${c.bonus} 🪙 bonus</span></div>`;
  }
  return '';
}

function endsIn(t) {
  const m = Math.round((t - Date.now()) / 60000);
  return m >= 1440 ? `${Math.round(m / 1440)} gün` : m >= 60 ? `${Math.round(m / 60)} saat` : `${Math.max(1, m)} dk`;
}

export const interact = (mid, body) => api.post(`/messages/${mid}/interact`, body).then((msg) => ctx.H.MESSAGE_UPDATE(msg)).catch(ctx.fail);

// Mesaj kutusundaki "madde ekle" formları
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-todo-add]');
  if (!f) return;
  e.preventDefault();
  const inp = f.querySelector('input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  interact(f.dataset.todoAdd, { action: 'add', text });
});

export function pollModal(ch) {
  ctx.modal({
    title: '📊 Anket Oluştur',
    body: `<label class="field"><span>Soru</span><input class="input" id="pl-q" maxlength="300" placeholder="Bu akşam ne oynayalım?"></label>
      <div class="field"><span>Seçenekler</span><div id="pl-opts"></div><button class="btn ghost sm" id="pl-add" type="button">+ Seçenek ekle</button></div>
      <div class="row wrap">
        <label class="check" style="border:0"><input type="checkbox" id="pl-multi"><div><b>Çoklu seçim</b><small>Birden fazla seçeneğe oy verilebilir</small></div></label>
        <label class="field grow"><span>Süre</span><select class="input" id="pl-dur"><option value="0">Süresiz</option><option value="1">1 saat</option><option value="4">4 saat</option><option value="24">1 gün</option><option value="72">3 gün</option><option value="168">1 hafta</option></select></label>
      </div>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Gönder</button>',
    onMount(m, close) {
      const opts = m.querySelector('#pl-opts');
      const add = (v = '') => {
        if (opts.children.length >= 10) return;
        opts.insertAdjacentHTML('beforeend', `<div class="row" style="margin-bottom:6px"><input class="input" maxlength="100" placeholder="Seçenek ${opts.children.length + 1}" value="${esc(v)}"><button class="icon-btn" type="button" data-rm>${icon('x', 'sm')}</button></div>`);
      };
      add(); add();
      m.querySelector('#pl-add').onclick = () => add();
      opts.onclick = (e) => { if (e.target.closest('[data-rm]') && opts.children.length > 2) e.target.closest('.row').remove(); };
      m.querySelector('[data-ok]').onclick = async () => {
        const options = [...opts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
        try {
          await api.post(`/channels/${ch.id}/messages`, { components: { type: 'poll', question: m.querySelector('#pl-q').value, options, multi: m.querySelector('#pl-multi').checked, duration_hours: +m.querySelector('#pl-dur').value } });
          close();
        } catch (e) { ctx.fail(e); }
      };
    },
  });
}

export function todoModal(ch) {
  ctx.modal({
    title: '✅ Ortak Yapılacaklar Listesi',
    body: `<label class="field"><span>Başlık</span><input class="input" id="td-t" maxlength="200" value="Yapılacaklar"></label>
      <label class="field"><span>Maddeler (her satıra bir tane)</span><textarea class="textarea" id="td-i" placeholder="Sunucuyu kur&#10;Botu ekle&#10;Arkadaşları davet et"></textarea></label>
      <label class="check"><input type="checkbox" id="td-open" checked><div><b>Herkes madde ekleyebilsin</b></div></label>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Gönder</button>',
    onMount(m, close) {
      m.querySelector('[data-ok]').onclick = async () => {
        const items = m.querySelector('#td-i').value.split('\n').map((s) => s.trim()).filter(Boolean);
        try {
          await api.post(`/channels/${ch.id}/messages`, { components: { type: 'todo', title: m.querySelector('#td-t').value, items, open: m.querySelector('#td-open').checked } });
          close();
        } catch (e) { ctx.fail(e); }
      };
    },
  });
}
