// Kod blokları: sözdizimi renklendirme ve tek tuşla çalıştırma (JavaScript ve Python, tarayıcıda yalıtılmış olarak)
import { ctx } from '../ctx.js';
import { esc } from '../util.js';

const HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0';
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
export const RUNNABLE = { js: 'js', javascript: 'js', node: 'js', py: 'py', python: 'py' };

let hljsLoad = null;
function loadHljs() {
  if (hljsLoad) return hljsLoad;
  hljsLoad = new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${HLJS}/styles/github-dark.min.css`;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = `${HLJS}/highlight.min.js`;
    s.onload = () => res(window.hljs);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return hljsLoad;
}

// Mesaj kutusundaki yeni kod bloklarını renklendir
export function highlightIn(root) {
  if (document.documentElement.dataset.lowend) return;
  const blocks = root.querySelectorAll('pre code:not([data-hl])');
  if (!blocks.length) return;
  loadHljs().then((hljs) => blocks.forEach((b) => {
    b.dataset.hl = 1;
    const lang = b.closest('pre')?.dataset.lang;
    try {
      if (lang && hljs.getLanguage(lang)) b.innerHTML = hljs.highlight(b.textContent, { language: lang }).value;
      else if (b.textContent.length < 20000) b.innerHTML = hljs.highlightAuto(b.textContent).value;
    } catch { /* düz kalsın */ }
  })).catch(() => {});
}

// ---------------------------------------------------------------- çalıştırıcılar (Web Worker içinde, sayfadan yalıtılmış)
const JS_WORKER = `
const out = (type, args) => postMessage({ type, text: args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a, null, 2); } catch { return String(a); } }).join(' ') });
console.log = (...a) => out('log', a); console.info = console.log; console.warn = (...a) => out('warn', a); console.error = (...a) => out('error', a);
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined; self.indexedDB = undefined;
onmessage = async (e) => {
  try { const r = await (0, eval)('(async () => {\\n' + e.data + '\\n})()'); if (r !== undefined) out('result', [r]); }
  catch (err) { out('error', [String(err && err.stack ? err.stack.split('\\n').slice(0, 3).join('\\n') : err)]); }
  postMessage({ type: 'done' });
};`;

const PY_WORKER = `
importScripts('${PYODIDE}pyodide.js');
let py = null;
onmessage = async (e) => {
  try {
    if (!py) { postMessage({ type: 'info', text: 'Python yükleniyor (ilk seferde birkaç saniye sürer)…' }); py = await loadPyodide({ indexURL: '${PYODIDE}' }); }
    py.setStdout({ batched: (t) => postMessage({ type: 'log', text: t }) });
    py.setStderr({ batched: (t) => postMessage({ type: 'error', text: t }) });
    const r = await py.runPythonAsync(e.data);
    if (r !== undefined && r !== null) postMessage({ type: 'result', text: String(r) });
  } catch (err) { postMessage({ type: 'error', text: String(err.message || err).split('\\n').slice(-4).join('\\n') }); }
  postMessage({ type: 'done' });
};`;

let pyWorker = null;
const workerFrom = (code) => new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));

export function runCode(lang, code, onLine) {
  return new Promise((resolve) => {
    const kind = RUNNABLE[lang];
    if (!kind) { onLine({ type: 'error', text: 'Bu dil çalıştırılamıyor (JavaScript ve Python desteklenir)' }); return resolve(); }
    let w;
    let limit;
    if (kind === 'js') { w = workerFrom(JS_WORKER); limit = 5000; } else { pyWorker ||= workerFrom(PY_WORKER); w = pyWorker; limit = 60000; }
    let lines = 0;
    const finish = (killed) => {
      clearTimeout(t);
      w.onmessage = null;
      if (kind === 'js') w.terminate();
      else if (killed) { w.terminate(); pyWorker = null; }
      resolve();
    };
    const t = setTimeout(() => { onLine({ type: 'error', text: `⏱ Zaman aşımı (${limit / 1000} sn) — kod durduruldu` }); finish(true); }, limit);
    w.onmessage = (e) => {
      if (e.data.type === 'done') return finish(false);
      if (++lines > 500) { if (lines === 501) onLine({ type: 'warn', text: '… çıktı çok uzun, kesildi' }); return; }
      onLine(e.data);
    };
    w.postMessage(code);
  });
}

// Mesajdaki ▶ Çalıştır düğmesi
export async function runBlock(btn) {
  const pre = btn.closest('.code-wrap')?.querySelector('pre');
  if (!pre) return;
  let out = btn.closest('.code-wrap').querySelector('.code-out');
  if (!out) { out = document.createElement('div'); out.className = 'code-out'; btn.closest('.code-wrap').appendChild(out); }
  out.innerHTML = '';
  btn.disabled = true;
  btn.textContent = '⏳ Çalışıyor';
  const t0 = performance.now();
  await runCode(pre.dataset.lang, pre.querySelector('code').textContent, (l) => out.insertAdjacentHTML('beforeend', `<div class="ln ${l.type}">${esc(l.text)}</div>`));
  out.insertAdjacentHTML('beforeend', `<div class="ln meta">— ${Math.round(performance.now() - t0)} ms</div>`);
  btn.disabled = false;
  btn.textContent = '▶ Çalıştır';
}

// Sohbetten bağımsız mini kod editörü
export function sandboxModal(ch) {
  const sample = { js: 'const ad = "Biscord";\nconsole.log(`Merhaba ${ad}! 👋`);\n[1, 2, 3].map((x) => x * x)', py: 'ad = "Biscord"\nprint(f"Merhaba {ad}! 👋")\nsum(range(1, 11))' };
  ctx.modal({
    title: '💻 Kod Çalıştırıcı', wide: true,
    sub: 'Kod tarayıcında yalıtılmış bir alanda çalışır; sitene ve hesabına erişemez.',
    body: `<div class="row" style="margin-bottom:8px"><select class="input" id="sb-lang" style="width:auto"><option value="js">JavaScript</option><option value="py">Python</option></select><span class="grow"></span><button class="btn green sm" id="sb-run">▶ Çalıştır</button></div>
      <textarea class="textarea code" id="sb-code" spellcheck="false" style="min-height:200px">${esc(sample.js)}</textarea>
      <div class="code-out" id="sb-out" style="margin-top:8px"><div class="ln meta">Çıktı burada görünecek</div></div>`,
    foot: `${ch ? '<button class="btn secondary" data-send>Sohbete Gönder</button>' : ''}<button class="btn ghost" data-close>Kapat</button>`,
    onMount(m, close) {
      const lang = m.querySelector('#sb-lang');
      const code = m.querySelector('#sb-code');
      const out = m.querySelector('#sb-out');
      lang.onchange = () => { if (Object.values(sample).includes(code.value)) code.value = sample[lang.value]; };
      code.onkeydown = (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const p = code.selectionStart; code.setRangeText('  ', p, code.selectionEnd, 'end'); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) m.querySelector('#sb-run').click();
      };
      m.querySelector('#sb-run').onclick = async (e) => {
        out.innerHTML = '';
        e.target.disabled = true;
        await runCode(lang.value, code.value, (l) => out.insertAdjacentHTML('beforeend', `<div class="ln ${l.type}">${esc(l.text)}</div>`));
        e.target.disabled = false;
      };
      m.querySelector('[data-send]')?.addEventListener('click', async () => {
        try { await ctx.api.post(`/channels/${ch.id}/messages`, { content: '```' + lang.value + '\n' + code.value + '\n```' }); close(); } catch (err) { ctx.fail(err); }
      });
    },
  });
}

export { loadHljs };
