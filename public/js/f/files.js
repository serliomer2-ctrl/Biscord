// Gelişmiş dosya paylaşımı: P2P (doğrudan) büyük dosya aktarımı, 3D model (.stl/.obj) ve kod dosyası önizleme
import { ctx } from '../ctx.js';
import { esc, fmtSize, icon } from '../util.js';
import { loadHljs, RUNNABLE, runCode } from './coderun.js';

const CHUNK = 64 * 1024;
const outgoing = new Map(); // transfer id -> { file, peers: Map(uid -> pc) }
const incoming = new Map(); // transfer id -> { pc, ... }

export const p2pOffers = new Map(); // channel id -> teklif listesi (yalnızca bellekte)

export function initFiles(socket) {
  socket.on('p2p:signal', ({ id, from, data }) => {
    if (outgoing.has(id)) senderSignal(id, from, data);
    else if (incoming.has(id)) receiverSignal(id, data);
  });
}

// ---------------------------------------------------------------- gönderen
export function startP2P(ch) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.onchange = () => { if (inp.files[0]) shareFile(ch, inp.files[0]); };
  inp.click();
}

export function shareFile(ch, file) {
  ctx.socket.emit('p2p:offer', { channel_id: ch.id, file: { name: file.name, size: file.size, type: file.type } }, (r) => {
    if (!r?.ok) return ctx.toast(r?.error || 'Paylaşılamadı', 'error');
    outgoing.set(r.id, { file, peers: new Map() });
    ctx.renderP2P?.();
    ctx.toast('Dosya paylaşıldı — alıcılar indirene kadar bu sekmeyi açık tut', 'ok');
  });
}

export function cancelOffer(id) {
  ctx.socket.emit('p2p:cancel', { id });
  const o = outgoing.get(id);
  o?.peers.forEach((pc) => pc.close());
  outgoing.delete(id);
}

const signal = (id, to, data) => ctx.socket.emit('p2p:signal', { id, to, data });

async function senderSignal(id, from, data) {
  const o = outgoing.get(id);
  if (data.type === 'request') {
    const pc = new RTCPeerConnection({ iceServers: ctx.CONFIG.iceServers });
    o.peers.set(from, pc);
    pc.onicecandidate = (e) => e.candidate && signal(id, from, { candidate: e.candidate });
    const dc = pc.createDataChannel('file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    dc.onopen = () => pump(o, dc);
    await pc.setLocalDescription(await pc.createOffer());
    signal(id, from, { description: pc.localDescription });
  } else {
    const pc = o.peers.get(from);
    if (!pc) return;
    if (data.description) await pc.setRemoteDescription(data.description);
    if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
  }
}

async function pump(o, dc) {
  const { file } = o;
  dc.send(JSON.stringify({ name: file.name, size: file.size, type: file.type }));
  let off = 0;
  const waitLow = () => new Promise((r) => { if (dc.bufferedAmount < 4 * 1024 * 1024) r(); else dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
  while (off < file.size && dc.readyState === 'open') {
    await waitLow();
    const buf = await file.slice(off, off + CHUNK).arrayBuffer();
    dc.send(buf);
    off += buf.byteLength;
  }
}

// ---------------------------------------------------------------- alıcı
export async function acceptOffer(offer, btn) {
  if (incoming.has(offer.id)) return;
  let writable = null;
  if (window.showSaveFilePicker && offer.file.size > 200 * 1024 * 1024) {
    try { writable = await (await window.showSaveFilePicker({ suggestedName: offer.file.name })).createWritable(); } catch { return; }
  }
  const pc = new RTCPeerConnection({ iceServers: ctx.CONFIG.iceServers });
  const st = { pc, chunks: [], got: 0, writable, offer, btn };
  incoming.set(offer.id, st);
  pc.onicecandidate = (e) => e.candidate && signal(offer.id, offer.from.id, { candidate: e.candidate });
  pc.ondatachannel = ({ channel }) => {
    channel.binaryType = 'arraybuffer';
    let meta = null;
    channel.onmessage = async (e) => {
      if (!meta) { meta = JSON.parse(e.data); return; }
      if (writable) await writable.write(e.data); else st.chunks.push(e.data);
      st.got += e.data.byteLength;
      progress(st);
      if (st.got >= meta.size) finish(st, meta);
    };
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { ctx.toast('Bağlantı kurulamadı — gönderen çevrimdışı olabilir', 'error'); incoming.delete(offer.id); } };
  btn.disabled = true;
  btn.textContent = 'Bağlanıyor…';
  signal(offer.id, offer.from.id, { type: 'request' });
}

async function receiverSignal(id, data) {
  const st = incoming.get(id);
  if (data.description) {
    await st.pc.setRemoteDescription(data.description);
    await st.pc.setLocalDescription(await st.pc.createAnswer());
    signal(id, st.offer.from.id, { description: st.pc.localDescription });
  }
  if (data.candidate) await st.pc.addIceCandidate(data.candidate).catch(() => {});
}

function progress(st) {
  const pct = Math.floor((st.got / st.offer.file.size) * 100);
  if (st.btn?.isConnected) st.btn.textContent = `%${pct} • ${fmtSize(st.got)}`;
}

async function finish(st, meta) {
  if (st.writable) await st.writable.close();
  else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(st.chunks, { type: meta.type || 'application/octet-stream' }));
    a.download = meta.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  st.pc.close();
  incoming.delete(st.offer.id);
  if (st.btn?.isConnected) st.btn.textContent = '✔ İndirildi';
  ctx.toast(`${meta.name} indirildi`, 'ok');
}

export function p2pCardsHTML(cid) {
  const list = p2pOffers.get(cid) || [];
  if (!list.length) return '';
  return `<div class="p2p-strip">${list.map((o) => {
    const mine = o.from.id === ctx.S.me.id;
    return `<div class="p2p-card"><span class="p2p-ic">📦</span><div class="grow"><b>${esc(o.file.name)}</b>
      <small>${fmtSize(o.file.size)} • ${esc(o.from.display_name)} doğrudan paylaşıyor${mine ? (outgoing.has(o.id) ? ' (sen)' : ' (başka sekme)') : ''}</small></div>
      ${mine ? (outgoing.has(o.id) ? `<button class="btn ghost sm" data-action="p2p-cancel" data-id="${o.id}">Durdur</button>` : '') : `<button class="btn sm" data-action="p2p-get" data-id="${o.id}">İndir</button>`}</div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- önizleme
const CODE_EXT = /\.(js|mjs|ts|tsx|jsx|py|json|html|css|scss|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|sh|bat|ps1|sql|yml|yaml|toml|ini|md|txt|lua|swift|xml|csv|log)$/i;
const MODEL_EXT = /\.(stl|obj)$/i;
export const previewKind = (a) => (MODEL_EXT.test(a.filename) ? '3d' : CODE_EXT.test(a.filename) && a.size < 400 * 1024 ? 'code' : null);

export async function previewCode(a) {
  let text;
  try { text = await (await fetch(a.url)).text(); } catch { return ctx.toast('Dosya açılamadı', 'error'); }
  const ext = a.filename.split('.').pop().toLowerCase();
  const lines = text.split('\n').length;
  const { el } = ctx.modal({
    title: `${icon('file', 'sm')} ${esc(a.filename)}`, wide: true,
    sub: `${lines} satır • ${fmtSize(a.size)}`,
    body: `<div class="code-wrap"><pre class="code-preview" data-lang="${esc(RUNNABLE[ext] ? (RUNNABLE[ext] === 'py' ? 'python' : 'javascript') : ext)}"><code>${esc(text)}</code></pre></div><div class="code-out hidden" id="cp-out"></div>`,
    foot: `${RUNNABLE[ext] ? '<button class="btn green" data-run>▶ Çalıştır</button>' : ''}<a class="btn secondary" href="${esc(a.url)}" download="${esc(a.filename)}">İndir</a><button class="btn ghost" data-close>Kapat</button>`,
  });
  loadHljs().then((hljs) => {
    const c = el.querySelector('code');
    try { c.innerHTML = (hljs.getLanguage(ext) ? hljs.highlight(text, { language: ext }) : hljs.highlightAuto(text)).value; } catch { /* düz */ }
  }).catch(() => {});
  el.querySelector('[data-run]')?.addEventListener('click', async () => {
    const out = el.querySelector('#cp-out');
    out.classList.remove('hidden');
    out.innerHTML = '';
    await runCode(ext, text, (l) => out.insertAdjacentHTML('beforeend', `<div class="ln ${l.type}">${esc(l.text)}</div>`));
  });
}

const THREE = 'https://cdn.jsdelivr.net/npm/three@0.128.0';
let threeLoad = null;
function loadThree() {
  const s = (src) => new Promise((res, rej) => { const e = document.createElement('script'); e.src = src; e.onload = res; e.onerror = rej; document.head.appendChild(e); });
  threeLoad ||= s(`${THREE}/build/three.min.js`).then(() => Promise.all([
    s(`${THREE}/examples/js/loaders/STLLoader.js`), s(`${THREE}/examples/js/loaders/OBJLoader.js`), s(`${THREE}/examples/js/controls/OrbitControls.js`),
  ]));
  return threeLoad;
}

export async function preview3D(a) {
  const { el } = ctx.modal({
    title: `🧊 ${esc(a.filename)}`, wide: true, sub: 'Sürükleyerek döndür, tekerlekle yakınlaştır.',
    body: '<div class="model-view" id="m3d"><p class="muted" style="padding:40px;text-align:center">3D görüntüleyici yükleniyor…</p></div>',
    foot: `<label class="row" style="margin-right:auto;gap:6px;font-size:14px"><input type="checkbox" id="m3d-rot" checked> Otomatik döndür</label><a class="btn secondary" href="${esc(a.url)}" download="${esc(a.filename)}">İndir</a><button class="btn ghost" data-close>Kapat</button>`,
  });
  try { await loadThree(); } catch { el.querySelector('#m3d').innerHTML = '<p class="muted" style="padding:40px">3D kütüphanesi yüklenemedi.</p>'; return; }
  const T = window.THREE;
  const box = el.querySelector('#m3d');
  box.innerHTML = '';
  const w = box.clientWidth || 600;
  const h = 420;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(w, h);
  box.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(45, w / h, 0.01, 10000);
  scene.add(new T.HemisphereLight(0xffffff, 0x444466, 1.0));
  const dl = new T.DirectionalLight(0xffffff, 0.8);
  dl.position.set(1, 2, 3);
  scene.add(dl);
  const controls = new T.OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  const mat = new T.MeshStandardMaterial({ color: 0x8b7cf6, metalness: 0.2, roughness: 0.5 });
  const buf = await (await fetch(a.url)).arrayBuffer();
  let obj;
  if (/\.stl$/i.test(a.filename)) obj = new T.Mesh(new T.STLLoader().parse(buf), mat);
  else {
    obj = new T.OBJLoader().parse(new TextDecoder().decode(buf));
    obj.traverse((c) => { if (c.isMesh) c.material = mat; });
  }
  const bb = new T.Box3().setFromObject(obj);
  const size = bb.getSize(new T.Vector3()).length() || 1;
  obj.position.sub(bb.getCenter(new T.Vector3()));
  const pivot = new T.Group();
  pivot.add(obj);
  scene.add(pivot);
  cam.position.set(size * 0.8, size * 0.6, size * 0.9);
  cam.near = size / 1000;
  cam.far = size * 100;
  cam.updateProjectionMatrix();
  controls.update();
  let raf;
  const loop = () => {
    if (!box.isConnected) { cancelAnimationFrame(raf); renderer.dispose(); return; }
    raf = requestAnimationFrame(loop);
    if (el.querySelector('#m3d-rot')?.checked) pivot.rotation.y += 0.01;
    controls.update();
    renderer.render(scene, cam);
  };
  loop();
}
