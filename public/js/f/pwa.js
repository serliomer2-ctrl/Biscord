// Uygulama olarak yükleme (PWA) ve anlık bildirimler (Web Push)
import { ctx } from '../ctx.js';
import { api } from '../api.js';
import { icon, store } from '../util.js';

let deferred = null;
let reg = null;

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

export function initPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    ctx.renderGuilds?.();
  });
  addEventListener('appinstalled', () => { deferred = null; ctx.toast?.('Biscord yüklendi! 🎉', 'ok'); ctx.renderGuilds?.(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((r) => { reg = r; }).catch((e) => console.warn('SW', e));
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'navigate' && e.data.url) { history.pushState(null, '', e.data.url); dispatchEvent(new PopStateEvent('popstate')); }
    });
  }
}

export const canShowInstall = () => !isStandalone();

export async function promptInstall() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') return;
  }
  installModal();
}

function installModal() {
  ctx.modal({ title: 'Biscord\'u İndir', wide: true, body: installBody(), onMount: bindInstall });
}

function installBody() {
  const installed = isStandalone();
  return `${installed ? '<div class="notice ok">✅ Biscord şu an uygulama olarak çalışıyor.</div>' : ''}
    <div class="install-grid">
      <div class="install-card ${isAndroid() ? 'hl' : ''}"><div class="ic">🤖</div><b>Android</b>
        <ol><li>Siteyi <b>Chrome</b> ile aç</li><li>Sağ üstteki <b>⋮</b> menüsüne dokun</li><li><b>Uygulamayı yükle</b> / <b>Ana ekrana ekle</b></li></ol></div>
      <div class="install-card ${isIOS() ? 'hl' : ''}"><div class="ic">🍎</div><b>iPhone / iPad</b>
        <ol><li>Siteyi <b>Safari</b> ile aç</li><li>Alttaki <b>Paylaş</b> (□↑) simgesine dokun</li><li><b>Ana Ekrana Ekle</b> → <b>Ekle</b></li></ol>
        <small class="muted">iOS'ta bildirimler yalnızca ana ekrana eklenen uygulamada çalışır (iOS 16.4+).</small></div>
      <div class="install-card ${!isIOS() && !isAndroid() ? 'hl' : ''}"><div class="ic">💻</div><b>Windows / Mac / Linux</b>
        <ol><li>Siteyi <b>Chrome</b> veya <b>Edge</b> ile aç</li><li>Adres çubuğunun sağındaki <b>yükle</b> simgesine (⊕) tıkla</li><li><b>Yükle</b> — masaüstüne ve Başlat menüsüne eklenir</li></ol></div>
    </div>
    ${deferred && !installed ? `<button class="btn block" data-install style="margin-top:14px">${icon('download', 'sm')} Şimdi Yükle</button>` : ''}
    <h3>Bildirimler</h3>
    <p class="muted" style="margin-top:0">Uygulama kapalıyken bile DM, bahsetme, arkadaşlık isteği ve aramalar için bildirim al.</p>
    <button class="btn ${pushState() === 'on' ? 'secondary' : ''}" data-push>${pushLabel()}</button>
    <p class="muted" style="font-size:12.5px">Not: Uygulama, Biscord'un tarayıcı motorunu kullanır; ayrı bir Electron kopyası taşımadığı için Discord masaüstü uygulamasından çok daha az yer kaplar.</p>`;
}

function bindInstall(m) {
  m.querySelector('[data-install]')?.addEventListener('click', async () => { await promptInstall(); });
  m.querySelector('[data-push]')?.addEventListener('click', async (e) => {
    if (pushState() === 'on') await disablePush(); else await enablePush();
    e.target.textContent = pushLabel();
  });
}

export function installPage(el) {
  el.innerHTML = `<h2>Uygulamayı İndir</h2>${installBody()}`;
  bindInstall(el);
}

// ---------------------------------------------------------------- anlık bildirimler
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushState = () => {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return store.get('push', false) && Notification.permission === 'granted' ? 'on' : 'off';
};
const pushLabel = () => ({
  on: '🔕 Anlık bildirimleri kapat', off: '🔔 Anlık bildirimleri aç',
  denied: '🚫 Bildirim izni engellendi (tarayıcı ayarlarından izin ver)', unsupported: 'Bu tarayıcı anlık bildirimleri desteklemiyor',
}[pushState()]);

const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function subscribe() {
  reg ||= await navigator.serviceWorker.ready;
  const { key } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
}

export async function enablePush() {
  if (!pushSupported()) return ctx.toast(isIOS() ? 'iPhone\'da bildirimler için önce Biscord\'u Ana Ekrana ekle ve oradan aç' : 'Bu tarayıcı anlık bildirimleri desteklemiyor', 'error');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return ctx.toast('Bildirim izni verilmedi', 'error');
  try {
    await subscribe();
    store.set('push', true);
    store.set('notifications', true);
    ctx.toast('Anlık bildirimler açıldı 🔔', 'ok');
  } catch (e) { ctx.fail(e); }
}

export async function disablePush() {
  store.set('push', false);
  try {
    reg ||= await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    ctx.toast('Anlık bildirimler kapatıldı');
  } catch { /* yok say */ }
}

// Her açılışta aboneliği sunucuya yeniden bildir (anahtar ya da hesap değişmiş olabilir)
export async function syncPush() {
  if (pushState() !== 'on') return;
  try { await subscribe(); } catch { /* sessiz */ }
}

export { pushState };
