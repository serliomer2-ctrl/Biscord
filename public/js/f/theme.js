// Tema motoru: vurgu rengi, arka plan resmi, bulanıklık/saydamlık, yazı tipi, neon parıltı, özel CSS ve düşük donanım modu
import { ctx } from '../ctx.js';
import { esc, store } from '../util.js';

const FONTS = {
  Inter: 'Inter', Poppins: 'Poppins', Nunito: 'Nunito', 'JetBrains Mono': 'JetBrains+Mono', 'Comic Neue': 'Comic+Neue',
  'Press Start 2P': 'Press+Start+2P', Orbitron: 'Orbitron', 'Fira Sans': 'Fira+Sans', Quicksand: 'Quicksand',
};
const PRESETS = {
  'Varsayılan': { accent: '#6c5ce7', glow: false, bg: '', blur: 0, opacity: 100 },
  'Neon Gece': { accent: '#ff2bd6', glow: true, bg: 'linear-gradient(135deg,#0b0221,#2a0845 50%,#0b0221)', blur: 12, opacity: 72 },
  'Okyanus': { accent: '#22d3ee', glow: false, bg: 'linear-gradient(160deg,#032b44,#0b4f6c 60%,#01141f)', blur: 10, opacity: 78 },
  'Gün Batımı': { accent: '#f97316', glow: false, bg: 'linear-gradient(150deg,#3b0a2a,#7c2d12 55%,#1f1020)', blur: 10, opacity: 78 },
  'Orman': { accent: '#22c55e', glow: false, bg: 'linear-gradient(160deg,#052e16,#14532d 60%,#022c22)', blur: 8, opacity: 80 },
  'Matrix': { accent: '#00ff66', glow: true, bg: '#000', blur: 0, opacity: 92, font: 'JetBrains Mono' },
  'Retro': { accent: '#facc15', glow: true, bg: 'linear-gradient(180deg,#1a1033,#3b1d5c)', blur: 0, opacity: 85, font: 'Press Start 2P' },
};
const DEFAULTS = { base: 'dark', accent: '#6c5ce7', bg: '', blur: 0, opacity: 100, font: 'Inter', glow: false, radius: 8, customCss: '' };

export const cfg = () => ({ ...DEFAULTS, base: store.get('theme', 'dark'), ...store.get('themeCfg', {}) });

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const shade = (h, f) => '#' + hexToRgb(h).map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');

export function applyTheme() {
  const c = cfg();
  const root = document.documentElement;
  root.dataset.theme = c.base;
  if (store.get('lowend', false)) root.dataset.lowend = '1'; else delete root.dataset.lowend;
  const [r, g, b] = hexToRgb(/^#[0-9a-f]{6}$/i.test(c.accent) ? c.accent : DEFAULTS.accent);
  root.style.setProperty('--brand', c.accent);
  root.style.setProperty('--brand-hover', shade(c.accent, 0.85));
  root.style.setProperty('--brand-soft', `rgba(${r},${g},${b},.18)`);
  root.style.setProperty('--radius', c.radius + 'px');
  const hasBg = !!c.bg && !root.dataset.lowend;
  root.classList.toggle('has-bg', hasBg);
  root.classList.toggle('neon', !!c.glow && !root.dataset.lowend);
  root.style.setProperty('--app-bg', hasBg ? (c.bg.startsWith('data:') || c.bg.startsWith('http') || c.bg.startsWith('/') ? `url("${c.bg}") center/cover fixed` : c.bg) : 'none');
  root.style.setProperty('--panel-alpha', String((c.opacity ?? 100) / 100));
  root.style.setProperty('--panel-blur', (hasBg ? c.blur : 0) + 'px');
  // yazı tipi
  const fam = FONTS[c.font] ? c.font : 'Inter';
  root.style.setProperty('--font', `'${fam}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);
  if (fam !== 'Inter' && !document.getElementById('font-' + fam)) {
    const l = document.createElement('link');
    l.id = 'font-' + fam;
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${FONTS[fam]}:wght@400;600;700&display=swap`;
    document.head.appendChild(l);
  }
  // özel CSS (yalnızca bu cihazda, yalnızca sana uygulanır)
  let st = document.getElementById('custom-css');
  if (!st) { st = document.createElement('style'); st.id = 'custom-css'; document.head.appendChild(st); }
  st.textContent = root.dataset.lowend ? '' : (c.customCss || '');
}

const save = (patch) => { store.set('themeCfg', { ...store.get('themeCfg', {}), ...patch }); applyTheme(); };

// Büyük resimleri tarayıcıda küçültüp yerel depoya sığdır
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function appearancePage(el) {
  const c = cfg();
  const low = store.get('lowend', false);
  el.innerHTML = `<h2>Görünüm</h2>
    <div class="card lowend-card">
      <label class="check"><input type="checkbox" id="th-low" ${low ? 'checked' : ''}><div><b>⚡ Ultra Hafif Mod (Düşük Donanım)</b>
        <small>Tüm animasyonları, gölgeleri, bulanıklığı, arka plan resmini, özel CSS'i ve kod renklendirmeyi kapatır; konuşma algılamayı seyrekleştirir, bellekte daha az mesaj tutar. Eski bilgisayar ve telefonlar için.</small></div></label>
    </div>
    <h3>Temel Tema</h3>
    <div class="theme-pick">
      <button data-base="dark" class="${c.base === 'dark' ? 'sel' : ''}" style="background:#2a2b30" title="Koyu"></button>
      <button data-base="light" class="${c.base === 'light' ? 'sel' : ''}" style="background:#fff;box-shadow:inset 0 0 0 1px #ccc" title="Açık"></button>
    </div>
    <h3>Hazır Temalar</h3>
    <div class="preset-row">${Object.entries(PRESETS).map(([n, p]) => `<button class="preset" data-preset="${esc(n)}" style="background:${p.bg || 'var(--bg-3)'};--pc:${p.accent}"><i></i>${esc(n)}</button>`).join('')}</div>
    <h3>Vurgu Rengi</h3>
    <div class="color-row"><input type="color" id="th-accent" value="${esc(c.accent)}"><span class="muted">Butonlar, bağlantılar ve seçili öğeler</span></div>
    <h3>Arka Plan</h3>
    <div class="card">
      <div class="row wrap"><button class="btn sm" data-bg-upload>Resim Yükle</button><input class="input grow" id="th-bg-url" placeholder="veya bir resim bağlantısı (https://…) ya da CSS gradyanı" value="${esc(c.bg && !c.bg.startsWith('data:') ? c.bg : '')}"><button class="btn ghost sm" data-bg-clear>Kaldır</button></div>
      <label class="field" style="margin-top:14px"><span>Panel Saydamlığı — <b id="th-op-v">${c.opacity}%</b></span><input type="range" id="th-op" min="35" max="100" value="${c.opacity}" class="range"></label>
      <label class="field"><span>Bulanıklık (cam / mica efekti) — <b id="th-bl-v">${c.blur}px</b></span><input type="range" id="th-bl" min="0" max="30" value="${c.blur}" class="range"></label>
    </div>
    <h3>Yazı Tipi ve Efektler</h3>
    <div class="card">
      <label class="field"><span>Yazı Tipi</span><select class="input" id="th-font">${Object.keys(FONTS).map((f) => `<option ${f === c.font ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
      <label class="field"><span>Köşe Yuvarlaklığı — <b id="th-rad-v">${c.radius}px</b></span><input type="range" id="th-rad" min="0" max="18" value="${c.radius}" class="range"></label>
      <label class="check"><input type="checkbox" id="th-glow" ${c.glow ? 'checked' : ''}><div><b>✨ Neon Parıltı</b><small>Vurgu rengindeki öğeler ve isimler parlar</small></div></label>
    </div>
    <h3>Özel CSS <span class="muted" style="font-weight:400;font-size:13px">(ileri düzey — yalnızca bu cihazda sana uygulanır)</span></h3>
    <textarea class="textarea code" id="th-css" spellcheck="false" placeholder=".msg-author { text-transform: uppercase; }">${esc(c.customCss)}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn" data-css-save>CSS'i Uygula</button><button class="btn ghost" data-reset>Her Şeyi Sıfırla</button></div>`;

  const q = (s) => el.querySelector(s);
  q('#th-low').onchange = (e) => { store.set('lowend', e.target.checked); applyTheme(); ctx.onLowendChange?.(); appearancePage(el); };
  el.querySelectorAll('[data-base]').forEach((b) => b.onclick = () => { store.set('theme', b.dataset.base); applyTheme(); appearancePage(el); });
  el.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
    const p = PRESETS[b.dataset.preset];
    save({ accent: p.accent, glow: p.glow, bg: p.bg, blur: p.blur, opacity: p.opacity, font: p.font || 'Inter' });
    if (p.bg && store.get('theme', 'dark') !== 'dark') store.set('theme', 'dark');
    applyTheme();
    appearancePage(el);
  });
  q('#th-accent').oninput = (e) => save({ accent: e.target.value });
  q('#th-op').oninput = (e) => { q('#th-op-v').textContent = e.target.value + '%'; save({ opacity: +e.target.value }); };
  q('#th-bl').oninput = (e) => { q('#th-bl-v').textContent = e.target.value + 'px'; save({ blur: +e.target.value }); };
  q('#th-rad').oninput = (e) => { q('#th-rad-v').textContent = e.target.value + 'px'; save({ radius: +e.target.value }); };
  q('#th-font').onchange = (e) => save({ font: e.target.value });
  q('#th-glow').onchange = (e) => save({ glow: e.target.checked });
  q('#th-bg-url').onchange = (e) => {
    const v = e.target.value.trim();
    if (v && !/^(https:\/\/|\/uploads\/|linear-gradient|radial-gradient|#)/.test(v)) return ctx.toast('https:// ile başlayan bir resim bağlantısı ya da CSS gradyanı gir', 'error');
    save({ bg: v, opacity: cfg().opacity === 100 ? 80 : cfg().opacity, blur: cfg().blur || 8 });
    appearancePage(el);
  };
  q('[data-bg-clear]').onclick = () => { save({ bg: '' }); appearancePage(el); };
  q('[data-bg-upload]').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      try {
        const data = await shrinkImage(inp.files[0]);
        save({ bg: data, opacity: cfg().opacity === 100 ? 80 : cfg().opacity, blur: cfg().blur || 8 });
        appearancePage(el);
      } catch { ctx.toast('Resim yüklenemedi (çok büyük olabilir)', 'error'); }
    };
    inp.click();
  };
  q('[data-css-save]').onclick = () => { save({ customCss: q('#th-css').value.slice(0, 20000) }); ctx.toast('Özel CSS uygulandı', 'ok'); };
  q('[data-reset]').onclick = () => { store.set('themeCfg', {}); store.set('theme', 'dark'); applyTheme(); appearancePage(el); };
}
