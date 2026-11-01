// Dahili ekran kaydedici: klip modu açıkken ekranın son ~30 saniyesini tek tuşla (Alt+C) yakalar
// Kesintisiz kayıt için 60 sn'lik iki kaydedici 30 sn arayla dönüşümlü çalışır; klip her zaman son 30-60 saniyeyi içerir.
import { ctx } from '../ctx.js';
import { fmtSize } from '../util.js';

let stream = null;
let recs = [];
let mime = '';

const pickMime = () => ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

export const clipActive = () => !!stream;

function makeRecorder(offset) {
  const r = { chunks: [], started: 0, rec: null, timer: null, waiting: null };
  const start = () => {
    if (!stream) return;
    r.chunks = [];
    r.rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 });
    r.rec.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
    r.rec.onstop = () => {
      const blob = new Blob(r.chunks, { type: r.rec.mimeType || mime || 'video/webm' });
      const dur = (performance.now() - r.started) / 1000;
      if (r.waiting) { r.waiting({ blob, dur }); r.waiting = null; }
      start();
    };
    r.rec.start(1000);
    r.started = performance.now();
    clearTimeout(r.timer);
    r.timer = setTimeout(() => r.rec.state === 'recording' && r.rec.stop(), 60000);
  };
  r.timer = setTimeout(start, offset);
  r.stopAll = () => { clearTimeout(r.timer); r.waiting = null; if (r.rec?.state === 'recording') { r.rec.onstop = null; r.rec.stop(); } };
  return r;
}

export async function toggleClipMode() {
  if (stream) return stopClipMode();
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) return ctx.toast('Tarayıcın ekran kaydını desteklemiyor', 'error');
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, height: { ideal: 1080 } }, audio: true });
  } catch { return; }
  mime = pickMime();
  stream.getVideoTracks()[0].onended = stopClipMode;
  recs = [makeRecorder(0), makeRecorder(30000)];
  ctx.toast('🎬 Klip modu açık — son 30 saniyeyi kaydetmek için Alt+C', 'ok');
  ctx.onClipChange?.();
}

export function stopClipMode() {
  recs.forEach((r) => r.stopAll());
  recs = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  ctx.onClipChange?.();
}

export async function saveClip() {
  if (!stream) return ctx.toast('Önce klip modunu aç (ses panelindeki 🎬 düğmesi)', 'error');
  const active = recs.filter((r) => r.rec?.state === 'recording').sort((a, b) => a.started - b.started)[0];
  if (!active) return ctx.toast('Kayıt henüz başlamadı', 'error');
  const got = await new Promise((res) => { active.waiting = res; active.rec.stop(); });
  if (got.dur < 2) return ctx.toast('Klip çok kısa', 'error');
  const ext = got.blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([got.blob], `biscord-klip-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, { type: got.blob.type });
  const url = URL.createObjectURL(got.blob);
  const ch = ctx.curChannel();
  const canSend = ch && (ch.type === 'text' || ch.type === 'dm');
  const tooBig = file.size > ctx.CONFIG.maxUploadMB * 1048576;
  ctx.modal({
    title: '🎬 Klip hazır', wide: true,
    sub: `${Math.round(got.dur)} saniye • ${fmtSize(file.size)} • ${ext.toUpperCase()}`,
    body: `<video src="${url}" controls autoplay muted style="width:100%;max-height:60vh;border-radius:8px;background:#000"></video>
      ${tooBig ? `<p class="danger" style="font-size:13px">Klip, yükleme sınırından (${ctx.CONFIG.maxUploadMB} MB) büyük. İndirebilir ya da P2P ile paylaşabilirsin.</p>` : ''}`,
    foot: `<a class="btn secondary" href="${url}" download="${file.name}">İndir</a>${canSend && !tooBig ? `<button class="btn" data-send>#${ch.name || 'sohbet'} kanalına gönder</button>` : ''}<button class="btn ghost" data-close>Kapat</button>`,
    onMount(m, close) {
      m.querySelector('[data-send]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Yükleniyor…';
        const fd = new FormData();
        fd.append('content', '🎬 Klip');
        fd.append('files', file, file.name);
        try { await ctx.api.post(`/channels/${ch.id}/messages`, fd); close(); } catch (err) { ctx.fail(err); e.target.disabled = false; }
      });
    },
  });
}

addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'KeyC' && stream) { e.preventDefault(); saveClip(); }
});
