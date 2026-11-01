// Ses efekt paneli: hazır (tarayıcıda sentezlenen) sesler + sunucuya yüklenen kendi seslerin; ses filtreleri ve telsiz modu
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { esc, icon, store } from '../util.js';
import { VOICE_FILTERS } from '../voice.js';

const RATE = 44100;
const BUILTIN = {
  boom: { name: 'Vine Boom', emoji: '💥', len: 1.2 },
  airhorn: { name: 'Korna', emoji: '📯', len: 1.4 },
  rimshot: { name: 'Ba Dum Tss', emoji: '🥁', len: 1.1 },
  ding: { name: 'Ding', emoji: '🔔', len: 1.2 },
  buzzer: { name: 'Yanlış!', emoji: '❌', len: 0.8 },
  tada: { name: 'Ta-da', emoji: '🎉', len: 1.3 },
  applause: { name: 'Alkış', emoji: '👏', len: 2.4 },
  laser: { name: 'Lazer', emoji: '🔫', len: 0.5 },
};

const bufCache = new Map();

// Hazır sesleri dosya indirmeden, OfflineAudioContext ile üret
async function synth(kind) {
  const def = BUILTIN[kind];
  const oc = new OfflineAudioContext(1, Math.ceil(RATE * def.len), RATE);
  const out = oc.createGain();
  out.connect(oc.destination);
  const env = (node, t0, peak, dur, attack = 0.005) => {
    const g = oc.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g).connect(out);
    return g;
  };
  const osc = (type, f, t0, dur, peak, f2) => {
    const o = oc.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    env(o, t0, peak, dur);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  };
  const noise = (t0, dur, peak, filterType, freq) => {
    const b = oc.createBuffer(1, Math.ceil(RATE * dur), RATE);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = oc.createBufferSource();
    s.buffer = b;
    let n = s;
    if (filterType) { const f = oc.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; s.connect(f); n = f; }
    env(n, t0, peak, dur, 0.002);
    s.start(t0);
  };
  if (kind === 'boom') {
    const ws = oc.createWaveShaper();
    const c = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(x * 4); }
    ws.curve = c;
    const o = oc.createOscillator();
    o.frequency.setValueAtTime(140, 0);
    o.frequency.exponentialRampToValueAtTime(38, 0.9);
    const g = oc.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.9, 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, 1.15);
    o.connect(ws).connect(g).connect(out);
    o.start(0);
    o.stop(1.2);
    noise(0, 0.08, 0.5, 'lowpass', 900);
  } else if (kind === 'airhorn') {
    for (const f of [440, 554, 659]) {
      const o = oc.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lfo = oc.createOscillator();
      lfo.frequency.value = 6;
      const lg = oc.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      const lp = oc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const g = oc.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.18, 0.04);
      g.gain.setValueAtTime(0.18, 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, 1.35);
      o.connect(lp).connect(g).connect(out);
      o.start(0); lfo.start(0); o.stop(1.4); lfo.stop(1.4);
    }
  } else if (kind === 'rimshot') {
    osc('sine', 190, 0, 0.18, 0.8, 90);
    osc('sine', 140, 0.25, 0.22, 0.8, 70);
    noise(0.55, 0.5, 0.35, 'highpass', 6000);
  } else if (kind === 'ding') {
    osc('sine', 1318, 0, 1.15, 0.5);
    osc('sine', 2636, 0, 0.6, 0.15);
  } else if (kind === 'buzzer') {
    osc('square', 150, 0, 0.7, 0.3);
    osc('square', 155, 0, 0.7, 0.2);
  } else if (kind === 'tada') {
    [523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, i * 0.09, i === 3 ? 1.0 : 0.25, 0.35));
  } else if (kind === 'applause') {
    for (let i = 0; i < 70; i++) noise(Math.random() * 2.1, 0.06, 0.12 + Math.random() * 0.2, 'bandpass', 1500 + Math.random() * 2500);
  } else if (kind === 'laser') {
    osc('sawtooth', 2200, 0, 0.45, 0.25, 180);
  }
  return oc.startRendering();
}

async function bufferFor(s) {
  const key = s.builtin || s.url;
  if (bufCache.has(key)) return bufCache.get(key);
  let buf;
  if (s.builtin) buf = await synth(s.builtin);
  else {
    const ac = await ctx.voice.ensureAudio();
    buf = await ac.decodeAudioData(await (await fetch(s.url)).arrayBuffer());
  }
  bufCache.set(key, buf);
  return buf;
}

export async function playSound(s) {
  try {
    const buf = await bufferFor(s);
    await ctx.voice.playEffect(buf, { name: s.name, emoji: s.emoji });
  } catch { ctx.toast('Ses çalınamadı', 'error'); }
}

const serverSounds = new Map(); // sid -> liste
export const invalidateSounds = (sid) => serverSounds.delete(sid);

export async function soundboardPanel(anchor) {
  const sid = ctx.voice.serverId;
  let list = [];
  if (sid) {
    if (!serverSounds.has(sid)) {
      try { serverSounds.set(sid, await api.get(`/servers/${sid}/sounds`)); } catch { serverSounds.set(sid, []); }
    }
    list = serverSounds.get(sid);
  }
  ctx.closeFloating();
  const el = document.createElement('div');
  el.className = 'popover soundboard';
  const v = ctx.voice;
  el.innerHTML = `<div class="sb-head"><b>🔊 Ses Efektleri</b><span class="muted">${v.connected ? 'Kanaldaki herkes duyar' : 'Önizleme (seste değilsin)'}</span></div>
    <div class="sb-grid">
      ${Object.entries(BUILTIN).map(([k, s]) => `<button class="sb-btn" data-b="${k}"><span>${s.emoji}</span>${esc(s.name)}</button>`).join('')}
      ${list.map((s) => `<button class="sb-btn custom" data-s="${s.id}" title="${esc(s.user?.display_name || '')} ekledi"><span>${esc(s.emoji || '🔊')}</span>${esc(s.name)}
        ${s.user_id === ctx.S.me.id || ctx.can(sid, ctx.P.MANAGE_SERVER) ? `<i class="sb-del" data-del="${s.id}" title="Sil">${icon('x', 'xs')}</i>` : ''}</button>`).join('')}
      ${sid ? `<button class="sb-btn add" data-add><span>➕</span>Ses Ekle</button>` : ''}
    </div>
    <label class="sb-vol">Efekt sesi <input type="range" min="0" max="1" step="0.05" value="${store.get('sfxVolume', 0.8)}" data-vol></label>
    <div class="sb-head" style="margin-top:6px"><b>🎙️ Ses Filtresi</b></div>
    <div class="sb-filters">${Object.entries(VOICE_FILTERS).map(([k, l]) => `<button class="${v.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="sb-head" style="margin-top:6px"><b>📻 Konuşma Modu</b></div>
    <div class="sb-filters">
      <button class="${v.mode === 'vad' ? 'on' : ''}" data-m="vad">🎤 Ses Etkinliği</button>
      <button class="${v.mode === 'ptt' ? 'on' : ''}" data-m="ptt">⌨️ Bas-Konuş</button>
      <button class="${v.mode === 'walkie' ? 'on' : ''}" data-m="walkie">📻 Telsiz</button>
    </div>
    ${v.mode !== 'vad' ? `<small class="muted" style="display:block;margin-top:6px">Konuşmak için <b>${esc(keyName(v.pttKey))}</b> tuşuna basılı tut ya da alttaki düğmeyi kullan. Tuşu Ayarlar → Ses ve Görüntü'den değiştirebilirsin.</small>` : ''}`;
  el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      try { await api.del('/sounds/' + del.dataset.del); invalidateSounds(sid); soundboardPanel(anchor); } catch (err) { ctx.fail(err); }
      return;
    }
    const b = e.target.closest('[data-b]');
    if (b) return playSound({ builtin: b.dataset.b, ...BUILTIN[b.dataset.b] });
    const s = e.target.closest('[data-s]');
    if (s) return playSound(list.find((x) => x.id === s.dataset.s));
    if (e.target.closest('[data-add]')) { ctx.closeFloating(); return addSoundModal(sid); }
    const f = e.target.closest('[data-f]');
    if (f) { v.setFilter(f.dataset.f); return soundboardPanel(anchor); }
    const m = e.target.closest('[data-m]');
    if (m) { v.setMode(m.dataset.m); return soundboardPanel(anchor); }
  });
  el.querySelector('[data-vol]').oninput = (e) => v.setSfxVolume(+e.target.value);
  const r = anchor.getBoundingClientRect();
  ctx.place(el, r.left, r.top - 8, { above: true });
}

export const keyName = (code) => ({ Backquote: '" (1\'in solundaki tuş)', Space: 'Boşluk', CapsLock: 'Caps Lock', ShiftLeft: 'Sol Shift', ControlLeft: 'Sol Ctrl', AltLeft: 'Sol Alt' }[code] || code.replace(/^Key|^Digit/, ''));

function addSoundModal(sid) {
  let blob = null;
  let rec = null;
  ctx.modal({
    title: '🔊 Ses Paneline Ses Ekle',
    sub: 'En fazla 1 MB ve birkaç saniye uzunluğunda bir ses yükle ya da mikrofonundan kaydet.',
    body: `<div class="row wrap"><button class="btn secondary" data-file>📁 Dosya Seç</button><button class="btn secondary" data-rec>⏺ Kaydet (5 sn)</button><span class="muted" id="snd-status">Henüz ses yok</span></div>
      <audio id="snd-prev" controls style="width:100%;margin:12px 0;display:none"></audio>
      <div class="row"><button class="emoji-btn" id="snd-emoji" type="button">🔊</button><label class="field grow" style="margin:0"><span>Ad</span><input class="input" id="snd-name" maxlength="32" placeholder="Bruh"></label></div>`,
    foot: '<button class="btn ghost" data-close>İptal</button><button class="btn" data-ok>Yükle</button>',
    onMount(m, close) {
      let emoji = '🔊';
      const setBlob = (b, label) => {
        blob = b;
        m.querySelector('#snd-status').textContent = label;
        const a = m.querySelector('#snd-prev');
        a.src = URL.createObjectURL(b);
        a.style.display = '';
      };
      m.querySelector('#snd-emoji').onclick = (e) => ctx.emojiPicker(e.currentTarget, (em) => { emoji = em; m.querySelector('#snd-emoji').textContent = em; });
      m.querySelector('[data-file]').onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'audio/*';
        inp.onchange = () => {
          const f = inp.files[0];
          if (!f) return;
          if (f.size > 1024 * 1024) return ctx.toast('Dosya 1 MB\'tan büyük olamaz', 'error');
          setBlob(f, f.name);
          if (!m.querySelector('#snd-name').value) m.querySelector('#snd-name').value = f.name.replace(/\.[^.]+$/, '').slice(0, 32);
        };
        inp.click();
      };
      m.querySelector('[data-rec]').onclick = async (e) => {
        if (rec) return;
        try {
          const st = await navigator.mediaDevices.getUserMedia({ audio: true });
          rec = new MediaRecorder(st);
          const chunks = [];
          rec.ondataavailable = (ev) => chunks.push(ev.data);
          rec.onstop = () => { st.getTracks().forEach((t) => t.stop()); setBlob(new Blob(chunks, { type: rec.mimeType }), 'Kayıt hazır'); rec = null; e.target.textContent = '⏺ Kaydet (5 sn)'; };
          rec.start();
          e.target.textContent = '● Kaydediliyor…';
          setTimeout(() => rec?.state === 'recording' && rec.stop(), 5000);
        } catch { ctx.toast('Mikrofona erişilemedi', 'error'); }
      };
      m.querySelector('[data-ok]').onclick = async () => {
        if (!blob) return ctx.toast('Önce bir ses seç ya da kaydet', 'error');
        const fd = new FormData();
        const ext = (blob.type.includes('ogg') && 'ogg') || (blob.type.includes('mpeg') && 'mp3') || (blob.type.includes('wav') && 'wav') || (blob.type.includes('mp4') && 'm4a') || 'webm';
        fd.append('file', blob, blob.name || `ses.${ext}`);
        fd.append('name', m.querySelector('#snd-name').value || 'Ses');
        fd.append('emoji', emoji);
        try { await api.post(`/servers/${sid}/sounds`, fd); invalidateSounds(sid); close(); ctx.toast('Ses eklendi', 'ok'); } catch (err) { ctx.fail(err); }
      };
    },
  });
}
