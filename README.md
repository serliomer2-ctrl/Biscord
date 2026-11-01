# Biscord

Kendi sunucunda çalışan, gerçek zamanlı sohbet + sesli/görüntülü konuşma + bot platformu.

## Özellikler

| Alan | Özellikler |
|---|---|
| **Hesap** | Kayıt/giriş, avatar, görünen ad, hakkımda, afiş rengi, özel durum, çevrimiçi/boşta/rahatsız etmeyin/görünmez |
| **Sunucular** | Oluşturma, simge, davet bağlantıları (süre/kullanım limitli), sahiplik devri, silme |
| **Kanallar** | Metin ve ses kanalları, kategoriler (daraltılabilir), konu, sıralama |
| **Mesajlaşma** | Gerçek zamanlı, düzenleme, silme, yanıtlama, tepkiler, sabitleme, dosya/resim/video yükleme (sürükle-bırak, yapıştır), markdown (**kalın**, *italik*, __altı çizili__, ~~üstü çizili~~, `kod`, kod blokları, \|\|spoiler\|\|, > alıntı), @bahsetme, @everyone, "yazıyor…" göstergesi, okunmamış/bahsetme rozetleri, arama |
| **Ses** | Sesli kanallar, kamera, ekran paylaşımı, susturma/sağırlaştırma, konuşma göstergesi, kişi başı ses seviyesi, gürültü azaltma, cihaz seçimi, moderatör susturma/atma |
| **DM** | Birebir mesaj, sesli/görüntülü arama ("arıyor" bildirimi ile) |
| **Arkadaşlar** | İstek gönder/kabul et/reddet, çevrimiçi listesi, "Şu An Aktif" |
| **Yönetim** | Roller (renk, ayrı gösterim, 18 izin), rol hiyerarşisi, at, yasakla, takma ad |
| **Botlar** | Bot hesapları, token, REST API + gerçek zamanlı olaylar, `/` komut kaydı ve otomatik tamamlama, embed mesajlar, örnek bot |
| **Diğer** | Masaüstü bildirimleri, sesler, koyu/açık tema, Ctrl+K hızlı geçiş, mobil uyumlu |

## Yerelde çalıştırma

Gerekli: **Node.js 22.13 veya üstü** (https://nodejs.org).

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresini aç, hesap oluştur. Arkadaşlarınla test etmek için siteyi bir hostinge koyman gerekir (aşağıda).

## Hostinge yükleme

> **Önemli:** Biscord bir **Node.js** uygulamasıdır. Sadece PHP/HTML destekleyen klasik paylaşımlı hostinglerde çalışmaz.
> Hosting panelinde **"Setup Node.js App"** (cPanel) ya da **Node.js** seçeneği olmalı, veya bir **VPS** kullanmalısın.
>
> Mikrofon ve kamera tarayıcıda yalnızca **HTTPS** üzerinden çalışır — sitende SSL sertifikası (ör. ücretsiz Let's Encrypt) açık olmalı.

### Seçenek A — cPanel "Setup Node.js App"

1. Proje klasörünü (`node_modules` ve `data` hariç) zipleyip cPanel → **Dosya Yöneticisi** ile örn. `~/biscord` klasörüne yükle ve aç.
2. cPanel → **Setup Node.js App** → **Create Application**:
   - Node.js version: **22.x** (yoksa en yüksek sürümü seç ve aşağıdaki nota bak)
   - Application root: `biscord`
   - Application URL: alan adın (ör. `biscord.siten.com`)
   - Application startup file: `server.js`
3. **Run NPM Install** butonuna bas, ardından **Restart**.
4. Alan adını aç. SSL için cPanel → **SSL/TLS Status** → AutoSSL.

> Node 22 yoksa: uygulamanın terminalinde `npm install better-sqlite3` çalıştır; Biscord otomatik olarak onu kullanır.
> Paylaşımlı hostinglerde WebSocket kapalıysa Biscord otomatik olarak HTTP long-polling'e düşer; çalışır ama biraz daha yavaştır.

### Seçenek B — VPS (Ubuntu) — en iyi performans

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
# Uygulama
cd /opt && sudo git clone <depon> biscord   # veya dosyaları scp ile kopyala
cd biscord && sudo npm install --omit=dev
sudo npm install -g pm2
pm2 start server.js --name biscord && pm2 save && pm2 startup
```

Nginx (`/etc/nginx/sites-available/biscord`):

```nginx
server {
  server_name biscord.siten.com;
  client_max_body_size 30M;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/biscord /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d biscord.siten.com
```

### Ses kalitesi ve TURN sunucusu

Sesli konuşma, tarayıcılar arasında doğrudan (WebRTC, eşler arası) kurulur. Çoğu ağda varsayılan STUN sunucusuyla çalışır; ama bazı mobil ağlar ve kurumsal güvenlik duvarları doğrudan bağlantıyı engeller. Herkesin her yerden bağlanabilmesi için bir **TURN** sunucusu kur (VPS'te `coturn`) ve `.env` dosyasına ekle:

```
TURN_URL=turn:turn.siten.com:3478
TURN_USER=biscord
TURN_PASS=gizli-sifre
```

Eşler arası yapı sayesinde ses trafiği senin sunucundan geçmez. Ses kanalı başına en fazla 25 kişi desteklenir; rahat kullanım için kamera açıkken 6-8 kişi önerilir.

### Yedekleme

Tüm veriler `data/` klasöründedir (`biscord.db` + `uploads/`). Bu klasörü düzenli yedekle.

## Bot geliştirme

1. Biscord'da **Kullanıcı Ayarları → Botlarım → Yeni Bot**. Token'ı kopyala (sadece bir kez gösterilir).
2. Aynı sayfadan botu sunucuna ekle (veya Sunucu Ayarları → Botlar → bot kimliği).
3. Örnek botu çalıştır:

```bash
BISCORD_URL=https://biscord.siten.com BOT_TOKEN=xxxxx npm run bot
```

Windows PowerShell için:

```powershell
$env:BISCORD_URL="https://biscord.siten.com"; $env:BOT_TOKEN="xxxxx"; npm run bot
```

Örnek bot komutları: `/yardim`, `/ping`, `/zar`, `/yazitura`, `/sec`, `/saat`, `/avatar`, `/sunucu`, `/anket`, `/temizle`.

### API özeti

Tüm istekler `Authorization: Bot <token>` başlığı ile yapılır. Temel adres: `https://siten.com/api`

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/users/@me` | Botun kendi bilgisi |
| GET | `/channels/:id/messages?limit=50&before=<id>` | Mesaj geçmişi |
| POST | `/channels/:id/messages` | `{ content, embeds?, reply_to? }` mesaj gönder |
| PATCH | `/messages/:id` | Mesajı düzenle |
| DELETE | `/messages/:id` | Mesajı sil |
| POST | `/channels/:id/messages/bulk-delete` | `{ messages: [id…] }` |
| PUT / DELETE | `/messages/:id/reactions/:emoji` | Tepki ekle / kaldır |
| PUT | `/messages/:id/pin` | `{ pinned: true/false }` |
| POST | `/channels/:id/typing` | "yazıyor…" göster |
| PUT | `/bots/@me/commands` | `[{ name, description, usage }]` — `/` önerilerinde görünür |
| GET | `/servers/:id` | Sunucu, kanallar, roller, üyeler |
| PATCH / DELETE | `/servers/:id/members/:uid` | Takma ad/rol değiştir, at |
| PUT | `/servers/:id/bans/:uid` | Yasakla |
| POST | `/dms` | `{ user_id }` DM kanalı aç |

Embed biçimi: `{ title, description, url, color (sayı, ör. 0x6c5ce7), author, fields: [{ name, value, inline }], image, thumbnail, footer, timestamp }`

### Gerçek zamanlı olaylar

`socket.io-client` ile `io(URL, { auth: { token: 'Bot <token>' } })` bağlan ve `dispatch` olayını dinle: `{ t, d }`.

`READY`, `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `REACTION_UPDATE`, `TYPING_START`, `SERVER_CREATE`, `SERVER_UPDATE`, `SERVER_DELETE`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE`, `MEMBER_ADD`, `MEMBER_UPDATE`, `MEMBER_REMOVE`, `ROLE_UPDATE`, `ROLE_DELETE`, `USER_UPDATE`, `PRESENCE_UPDATE`, `VOICE_STATE_UPDATE`, `DM_CREATE`

## Proje yapısı

```
server.js          API, gerçek zamanlı olaylar, ses sinyalleşmesi
db.js              SQLite şeması
permissions.js     İzin bitleri
public/            Arayüz (derleme gerektirmez)
  js/app.js        Ana uygulama
  js/voice.js      WebRTC ses/görüntü
bots/example-bot.js
data/              Veritabanı ve yüklemeler (otomatik oluşur)
```
