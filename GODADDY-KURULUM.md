# Biscord'u GoDaddy'ye Yükleme — Tam Kılavuz

Bu kılavuz Biscord'u **GitHub + GoDaddy Node.js Hosting** ile internete açmayı, her tıklamayı tek tek anlatarak gösterir. Hiç GitHub kullanmamış olsan da takip edebilirsin.

**Toplam süre:** İlk seferde yaklaşık 45–60 dakika. DNS'in yayılması bunun üstüne birkaç saat sürebilir.

> **Önemli not:** GoDaddy ve GitHub sitelerindeki buton adları zaman zaman değişir, sitenin dil ayarına göre de İngilizce ya da Türkçe görünebilir. Bu yüzden her butonun iki dildeki adını birlikte yazdım (ör. **Yayınla / Publish**). Birebir aynı yazıyı bulamazsan anlamca en yakın butonu kullan. Takıldığın yerde ekran görüntüsü atarsan birlikte bakarız.

---

## İçindekiler

- [Büyük resim: Ne yapacağız?](#büyük-resim-ne-yapacağız)
- [Bölüm 1 — Hazırlık](#bölüm-1--hazırlık)
- [Bölüm 2 — GitHub hesabı açma](#bölüm-2--github-hesabı-açma)
- [Bölüm 3 — GitHub'da depo (repository) oluşturma](#bölüm-3--githubda-depo-repository-oluşturma)
- [Bölüm 4 — Biscord dosyalarını GitHub'a yükleme](#bölüm-4--biscord-dosyalarını-githuba-yükleme)
- [Bölüm 5 — GoDaddy'de Node.js Hosting'i açma](#bölüm-5--godaddyde-nodejs-hostingi-açma)
- [Bölüm 6 — GoDaddy'yi GitHub'a bağlama ve ilk yükleme](#bölüm-6--godaddyyi-githuba-bağlama-ve-ilk-yükleme)
- [Bölüm 7 — Kayıtları (log) okuma](#bölüm-7--kayıtları-log-okuma)
- [Bölüm 8 — Önizlemede test](#bölüm-8--önizlemede-test)
- [Bölüm 9 — ⚠️ Verilerin kalıcılık testi](#bölüm-9--️-verilerin-kalıcılık-testi)
- [Bölüm 10 — Yayınlama ve alan adı bağlama](#bölüm-10--yayınlama-ve-alan-adı-bağlama)
- [Bölüm 11 — İlk kullanım ve arkadaşları davet etme](#bölüm-11--ilk-kullanım-ve-arkadaşları-davet-etme)
- [Bölüm 12 — Botu yükleme](#bölüm-12--botu-yükleme)
- [Bölüm 13 — Sesli konuşma için TURN](#bölüm-13--sesli-konuşma-için-turn)
- [Bölüm 14 — Güncelleme yayınlama](#bölüm-14--güncelleme-yayınlama)
- [Bölüm 15 — Sorun giderme](#bölüm-15--sorun-giderme)
- [Bölüm 16 — Güvenlik kontrol listesi](#bölüm-16--güvenlik-kontrol-listesi)
- [Ek A — Zip ile yükleme (GitHub'sız yol)](#ek-a--zip-ile-yükleme-githubsız-yol)
- [Ek B — Sözlük](#ek-b--sözlük)

---

## Büyük resim: Ne yapacağız?

```
 Senin bilgisayarın           GitHub                    GoDaddy Node.js Hosting           Ziyaretçiler
 ┌───────────────┐   push   ┌──────────────┐  otomatik  ┌─────────────────────────┐  HTTPS  ┌──────────┐
 │  D:\Biscord   │ ───────▶ │ biscord deposu│ ─────────▶ │ npm install → npm start │ ◀─────▶ │ Tarayıcı │
 └───────────────┘          └──────────────┘   yükleme   │ biscord.alanadin.com    │         └──────────┘
                                                         └─────────────────────────┘
```

1. Kodu **GitHub**'a koyuyoruz. GitHub, kodun internetteki deposu gibi düşünülebilir.
2. **GoDaddy**'yi bu depoya bağlıyoruz. GoDaddy kodu alıyor, gerekli paketleri kuruyor ve Biscord'u çalıştırıyor.
3. Bundan sonra kodda bir değişiklik yapıp GitHub'a gönderdiğinde GoDaddy **siteyi kendiliğinden günceller**.

### Neden cPanel değil de Node.js Hosting?

Web Hosting Deluxe paketinde iki ayrı şey var:

| | cPanel (klasik hosting) | Node.js Hosting |
|---|---|---|
| Ne için | PHP / HTML siteleri, WordPress | Sürekli çalışan Node.js uygulamaları |
| Biscord çalışır mı? | ❌ Hayır | ✅ Evet |
| Mevcut siten | Burada kalır, dokunmuyoruz | Biscord buraya gidecek |
| Deluxe'te hak | — | **10 yayınlanmış uygulama** (ek ücret yok) |

Biscord'un mesajları anında iletmesi ve sesli konuşma bağlantılarını kurması için 7/24 açık duran bir sunucu gerekir. cPanel bunu sağlamaz, Node.js Hosting sağlar.

### GitHub mı, Zip mi?

| | GitHub ile | Zip ile ([Ek A](#ek-a--zip-ile-yükleme-githubsız-yol)) |
|---|---|---|
| İlk kurulum | Biraz daha uzun (hesap + depo) | Daha kısa |
| Güncelleme | `git push` → site kendiliğinden güncellenir | Her seferinde yeni zip yükle |
| Değişiklik geçmişi | Tüm sürümler saklanır, geri dönülebilir | Yok |
| Önerim | ✅ **Uzun vadede bu** | Hızlı deneme için |

---

## Bölüm 1 — Hazırlık

### 1.1 Gerekenler

- [ ] GoDaddy hesabı ve aktif **Web Hosting Deluxe** paketi
- [ ] Bir alan adı (GoDaddy'de ya da başka bir firmada)
- [ ] Bir e-posta adresi (GitHub hesabı için)
- [ ] Bilgisayarında **Git** — ✅ zaten kurulu (sürüm 2.50)
- [ ] `D:\Biscord` klasörü — ✅ hazır

### 1.2 Hangi alan adını kullanacağına karar ver

Mevcut web siteni bozmamak için Biscord'u bir **alt alan adında** çalıştırmanı öneririm:

| Seçenek | Örnek | Ne olur |
|---|---|---|
| ✅ Alt alan adı (önerilen) | `biscord.alanadin.com` | Ana siten aynen kalır |
| Ana alan adı | `alanadin.com` | Ana sitenin yerini Biscord alır |
| Ayrı alan adı | `biscord-sohbet.com` | Yeni bir alan adı satın alman gerekir |

Kararını bir kenara not et; Bölüm 10'da kullanacağız.

### 1.3 Yüklenecek ve yüklenmeyecek dosyalar

`D:\Biscord` klasöründe şunlar var:

| Dosya / Klasör | GitHub'a gidecek mi? | Neden |
|---|---|---|
| `server.js`, `db.js`, `permissions.js` | ✅ Evet | Sunucu kodu |
| `package.json`, `package-lock.json` | ✅ Evet | GoDaddy hangi paketleri kuracağını buradan öğrenir |
| `public/` | ✅ Evet | Arayüz (HTML, CSS, JS) |
| `bots/` | ✅ Evet | Örnek bot |
| `README.md`, `GODADDY-KURULUM.md`, `.env.example`, `.gitignore` | ✅ Evet | Belgeler ve ayarlar |
| `node_modules/` | ❌ **Hayır** | Çok büyük; GoDaddy kendisi kurar |
| `data/` | ❌ **Hayır** | Senin bilgisayarındaki test veritabanı |
| `.env` | ❌ **Asla** | Şifreler ve tokenlar burada durur |
| `dist/` | ❌ Hayır | Zip paketleri; GitHub yolunda gerek yok |

`.gitignore` dosyası bu ❌ işaretli olanları **otomatik olarak dışarıda bırakır**, senin ayrıca bir şey yapmana gerek yok.

---

## Bölüm 2 — GitHub hesabı açma

> Zaten bir GitHub hesabın varsa [Bölüm 3](#bölüm-3--githubda-depo-repository-oluşturma)'e geç.

1. Tarayıcıda **https://github.com** adresine git.
2. Sağ üstteki **Sign up** (Kaydol) butonuna tıkla.
3. Sırasıyla iste­nenleri doldur:
   - **Email:** e-posta adresin → **Continue**
   - **Password:** en az 15 karakter, ya da en az 8 karakter + bir rakam + bir küçük harf → **Continue**
   - **Username:** kullanıcı adın (ör. `omerserli`). Depo adresin `github.com/omerserli/biscord` gibi görünecek. → **Continue**
   - **Email preferences:** kutuyu boş bırakabilirsin → **Continue**
4. **Bulmacayı çöz** ("Verify your account"). Bu bir robot kontrolüdür.
5. **Create account**'a tıkla.
6. E-postana gelen **8 haneli kodu** GitHub sayfasına yaz.
7. "Welcome" ekranında birkaç soru sorabilir; **Skip personalization** (Atla) diyebilirsin.
8. **İki adımlı doğrulama (2FA):** GitHub bunu bir süre sonra zorunlu tutar. İstediğinde telefonuna bir doğrulama uygulaması kur (ör. Google Authenticator, Microsoft Authenticator) ve ekrandaki QR kodunu okut. **Kurtarma kodlarını (recovery codes) indirip güvenli bir yere kaydet.**

✅ **Kontrol:** github.com'da sağ üstte profil resmin görünüyorsa hesabın hazır.

---

## Bölüm 3 — GitHub'da depo (repository) oluşturma

**Depo (repository / repo):** Bir projenin tüm dosyalarının ve değişiklik geçmişinin GitHub'da tutulduğu yerdir.

1. github.com'da oturum açıkken sağ üstteki **+** simgesine tıkla → **New repository** (Yeni depo).
2. Formu şöyle doldur:

   | Alan | Değer | Açıklama |
   |---|---|---|
   | **Owner** | Kendi kullanıcı adın | Değiştirme |
   | **Repository name** | `biscord` | Küçük harf, boşluksuz |
   | **Description** | `Kendi sohbet platformum` | İsteğe bağlı |
   | **Public / Private** | 🔒 **Private** | ⚠️ **Mutlaka Private seç.** Kodunu herkes görmesin. |
   | **Add a README file** | ☐ **İşaretleme** | Bizde zaten var |
   | **Add .gitignore** | **None** | Bizde zaten var |
   | **Choose a license** | **None** | |

3. En alttaki yeşil **Create repository** butonuna tıkla.
4. Açılan sayfada "Quick setup" başlığının altında depo adresin yazar:

   ```
   https://github.com/KULLANICI_ADIN/biscord.git
   ```

   **Bu adresi kopyala**, Bölüm 4'te lazım olacak.

✅ **Kontrol:** Sol üstte 🔒 kilit simgesi ve `KULLANICI_ADIN / biscord` yazısı görünüyorsa depo hazır ve gizli.

---

## Bölüm 4 — Biscord dosyalarını GitHub'a yükleme

Üç yol var; **birini** seç:

| Yol | Zorluk | Kime uygun |
|---|---|---|
| **4A — Bana yaptır** | ⭐ En kolay | Claude'a "depo adresim şu, yükle" de |
| **4B — Komut satırı** | ⭐⭐ | Komut yazmaktan çekinmiyorsan |
| **4C — GitHub sitesine sürükle-bırak** | ⭐⭐ | Hiç komut yazmak istemiyorsan |

### 4A — Bana yaptır (önerilen)

Bölüm 3'te kopyaladığın depo adresini bana gönder, örneğin:

> Depo adresim: https://github.com/omerserli/biscord.git — yükle

Ben şunları yaparım:
1. `D:\Biscord` klasöründe Git deposunu başlatırım.
2. Yalnızca gereken dosyaları eklerim (`node_modules`, `data`, `.env` dışarıda kalır) ve kontrol ederim.
3. İlk kaydı (commit) oluşturur, GitHub'a gönderirim (push).

İlk gönderimde Windows'ta bir **GitHub giriş penceresi** açılabilir. **Sign in with your browser** (Tarayıcıyla giriş yap) seçeneğine tıkla, açılan sayfada **Authorize** (Yetkilendir) de. Bu girişi sen yaparsın; şifreni bana söyleme.

### 4B — Komut satırı ile kendin yükle

1. **Başlat** menüsüne `powershell` yaz ve **Windows PowerShell**'i aç.
2. Aşağıdaki komutları **teker teker** kopyalayıp yapıştır ve her birinden sonra **Enter**'a bas.

   Proje klasörüne geç:
   ```powershell
   cd D:\Biscord
   ```

   Git'e kim olduğunu söyle (yalnızca ilk seferde; kendi adını ve GitHub e-postanı yaz):
   ```powershell
   git config --global user.name "Ömer Serli"
   git config --global user.email "github-epostan@ornek.com"
   ```

   Depoyu başlat ve ana dalın adını `main` yap:
   ```powershell
   git init -b main
   ```

   Dosyaları ekle:
   ```powershell
   git add .
   ```

   **Kontrol et** (çok önemli):
   ```powershell
   git status
   ```
   Listede `node_modules`, `data`, `.env` veya `dist` **olmamalı**. Görürsen dur ve bana sor.

   İlk kaydı oluştur:
   ```powershell
   git commit -m "Biscord ilk sürüm"
   ```

   GitHub deposunu bağla (adresi kendi adresinle değiştir):
   ```powershell
   git remote add origin https://github.com/KULLANICI_ADIN/biscord.git
   ```

   Gönder:
   ```powershell
   git push -u origin main
   ```

3. Son komutta GitHub giriş penceresi açılır: **Sign in with your browser** → tarayıcıda **Authorize**.
4. Komut satırında `main -> main` gibi bir satır görürsen yükleme bitmiştir.

### 4C — GitHub sitesine sürükle-bırak

1. Bölüm 3'te oluşturduğun boş depo sayfasında **uploading an existing file** (var olan bir dosyayı yükle) bağlantısına tıkla.
2. Windows Gezgini'nde `D:\Biscord` klasörünü aç.
3. **Yalnızca** şunları seç (Ctrl tuşuna basılı tutarak tek tek tıkla):
   - `bots` klasörü
   - `public` klasörü
   - `server.js`, `db.js`, `permissions.js`
   - `package.json`, `package-lock.json`
   - `README.md`, `GODADDY-KURULUM.md`
4. Seçtiklerini tarayıcıdaki **"Drag files here"** alanına sürükle.
   - ⚠️ `node_modules`, `data` ve `dist` klasörlerini **sürükleme**.
   - `.gitignore` ve `.env.example` dosyaları Gezgin'de gizli görünebilir. Görünmüyorlarsa Gezgin'de **Görünüm → Göster → Gizli öğeler**'i işaretle ve onları da sürükle.
5. Yükleme bitince alttaki **Commit changes** kutusuna `Biscord ilk sürüm` yaz.
6. **Commit directly to the main branch** seçili olsun → yeşil **Commit changes** butonuna tıkla.

### ✅ Bölüm 4 kontrolü

GitHub'da depo sayfanı yenile. Şunu görmelisin:

```
📁 bots
📁 public
📄 .env.example
📄 .gitignore
📄 GODADDY-KURULUM.md
📄 README.md
📄 db.js
📄 package-lock.json
📄 package.json
📄 permissions.js
📄 server.js
```

❌ `node_modules`, `data` veya `.env` görürsen: **dur ve bana yaz.** Özellikle `.env` yanlışlıkla yüklendiyse içindeki şifreleri değiştirmemiz gerekir.

---

## Bölüm 5 — GoDaddy'de Node.js Hosting'i açma

1. **https://www.godaddy.com** → sağ üstte **Oturum Aç / Sign In** → giriş yap.
2. Sağ üstte adına tıkla → **Ürünlerim / My Products**.
3. Ürün listesinde **Web Hosting** (Deluxe) kartını bul.
4. Kartın içinde veya yanında **Node.js** ifadesi geçen bir bölüm ya da buton ara. Muhtemel adları:
   - **Node.js Hosting**
   - **Node.js Apps / Node.js Uygulamaları**
   - **Başla / Get Started** ya da **Yönet / Manage**
5. Bulamazsan tarayıcıda doğrudan şu adrese git:
   ```
   https://www.godaddy.com/hosting/nodejs
   ```
   Buradaki **Başla / Get Started** butonu seni hesabındaki Node.js paneline götürür.
6. İlk girişte **bölge (Region)** seçmeni ister:
   - **Europe (Avrupa)** seç. Türkiye'ye daha yakın olduğu için mesajlar daha hızlı gider.
   - ⚠️ Bu seçim büyük olasılıkla sonradan **değiştirilemez**.

✅ **Kontrol:** Boş bir uygulama listesi ve **Yeni Uygulama / Create App / New App** gibi bir buton görüyorsan hazırsın.

---

## Bölüm 6 — GoDaddy'yi GitHub'a bağlama ve ilk yükleme

### 6.1 Uygulama oluştur

1. **Yeni Uygulama / Create App** butonuna tıkla.
2. Kaynak seçimi ekranında **GitHub** seçeneğini seç (Zip değil).

### 6.2 GitHub'ı yetkilendir

1. **GitHub'a Bağlan / Connect to GitHub** butonuna tıkla.
2. GitHub sayfası açılır ve GoDaddy'nin hesabına erişmek istediğini söyler.
3. Erişim kapsamı sorulursa:
   - ✅ **Only select repositories** (Yalnızca seçili depolar) → listeden **biscord**'u seç.
   - Bu, GoDaddy'nin yalnızca Biscord deposunu görmesini sağlar; diğer depoların gizli kalır.
4. **Install / Authorize** (Yükle / Yetkilendir) butonuna tıkla.
5. GitHub şifreni veya 2FA kodunu tekrar isteyebilir; gir.
6. Otomatik olarak GoDaddy'ye geri dönersin.

### 6.3 Depoyu ve dalı seç

| Alan | Seçim |
|---|---|
| **Repository / Depo** | `KULLANICI_ADIN/biscord` |
| **Branch / Dal** | `main` |
| **Otomatik yükleme / Auto-deploy** | ✅ Açık (varsa) |

### 6.4 Uygulama ayarları

Ekranda bu ayarlardan bazılarını görebilirsin. Görmediğin alanları boş geç; GoDaddy Express uygulamalarını otomatik tanır.

| Ayar | Değer | Açıklama |
|---|---|---|
| **Uygulama adı / App name** | `biscord` | |
| **Node.js sürümü** | **22** (en yenisi) | Biscord'un yerleşik veritabanı için 22.13 veya üstü gerekir |
| **Kök klasör / Root directory** | Boş ya da `/` | `package.json` deponun kökünde |
| **Kurulum / Install command** | `npm install` (veya boş) | |
| **Derleme / Build command** | **Boş bırak** | Biscord derleme gerektirmez |
| **Başlatma / Start command** | `npm start` | `node server.js` çalıştırır |
| **Port** | **Boş bırak** | Biscord portu GoDaddy'den otomatik alır |

### 6.5 Ortam değişkenleri (şimdilik isteğe bağlı)

**Environment Variables / Ortam Değişkenleri** bölümünü görürsen şimdilik **boş bırakabilirsin**. Biscord bunlar olmadan çalışır. İleride ekleyebileceklerin:

| Değişken | Örnek değer | Ne işe yarar | Ne zaman |
|---|---|---|---|
| `MAX_UPLOAD_MB` | `25` | Tek dosyada en büyük yükleme boyutu | İstersen |
| `TURN_URL` | `turn:sunucu.com:3478` | Mobil veride sesli konuşma | [Bölüm 13](#bölüm-13--sesli-konuşma-için-turn) |
| `TURN_USER` | `kullanici` | TURN kullanıcı adı | Bölüm 13 |
| `TURN_PASS` | `sifre` | TURN şifresi | Bölüm 13 |
| `DATA_DIR` | `/kalici/klasor` | Verilerin yazılacağı klasör | Yalnızca GoDaddy kalıcı bir klasör verirse ([Bölüm 9](#bölüm-9--️-verilerin-kalıcılık-testi)) |

> ⚠️ `PORT` değişkenini **ekleme**, onu GoDaddy kendisi verir.

### 6.6 Başlat

1. **Oluştur ve Yükle / Create & Deploy / Deploy** butonuna tıkla.
2. GoDaddy şu adımlardan geçer (ekranda ilerlemesini görebilirsin):
   1. GitHub'dan kodu çeker
   2. `npm install` ile paketleri kurar (1–2 dakika)
   3. `npm start` ile Biscord'u başlatır
3. Durum **Çalışıyor / Running / Live** (genelde yeşil) olunca hazırdır.

---

## Bölüm 7 — Kayıtları (log) okuma

**Kayıtlar (Logs):** Uygulamanın çalışırken yazdığı mesajlardır. Bir şey ters gittiğinde ilk bakılacak yer burasıdır.

Uygulama sayfasında **Logs / Kayıtlar** sekmesini aç.

### ✅ Her şey yolundaysa

```
added 112 packages in 14s
> biscord@1.0.0 start
> node server.js

  Biscord çalışıyor →  http://localhost:8080
```

`localhost:8080` gibi bir adres görmen normaldir; bu GoDaddy'nin iç adresidir. Dışarıdan erişim GoDaddy'nin sana verdiği bağlantıyla olur.

### ❌ Sık görülen hata mesajları

| Kayıtta gördüğün | Anlamı | Çözüm |
|---|---|---|
| `SQLite bulunamadı. Node.js 22.13+ kullanın…` | Node sürümü eski | Ayarlardan en yeni Node 22'yi seç ve yeniden yükle. Seçenek yoksa bana yaz. |
| `Cannot find module 'express'` | Paketler kurulmamış | Install command'ın `npm install` olduğundan emin ol, yeniden yükle. |
| `Cannot find module '/…/server.js'` | `package.json` kökte değil | GitHub'da dosyaların doğrudan depo kökünde olduğunu kontrol et (Bölüm 4 kontrolü). |
| `EADDRINUSE` | Port çakışması | `PORT` değişkeni eklediysen sil. |
| `npm ERR! code ENOTFOUND` | Paket indirilemedi | Geçici ağ sorunu; **Yeniden yükle / Redeploy**. |

---

## Bölüm 8 — Önizlemede test

GoDaddy önce bir **önizleme (preview) bağlantısı** verir. Bu bağlantıyı yalnızca sen, GoDaddy'ye giriş yapmışken açabilirsin; arkadaşların henüz göremez.

1. Uygulama sayfasında **Önizleme / Preview / Open** bağlantısına tıkla.
2. Biscord giriş ekranı açılmalı. Açılmıyorsa → [Bölüm 7](#bölüm-7--kayıtları-log-okuma).

### Test listesi — sırayla dene ve işaretle

**Hesap**
- [ ] **Kaydol** → görünen ad, kullanıcı adı (küçük harf), şifre → **Devam Et**
- [ ] Arkadaşlar ekranı açıldı

**Sunucu ve mesaj**
- [ ] Sol sütundaki yeşil **+** → **Kendi Sunucumu Oluştur** → **Oluştur**
- [ ] `#genel` kanalına `Merhaba **dünya**` yaz → **dünya** kalın görünüyor
- [ ] Mesajın üzerine gel → 👍 ile tepki ekle
- [ ] Mesaj kutusunun solundaki **⊕** ile bir resim yükle → resim görünüyor
- [ ] Mesajın üzerine gel → kalem simgesi → düzenle → **Enter**

**Ses**
- [ ] Sol listede **🔊 Genel** kanalına tıkla
- [ ] Tarayıcı "mikrofon kullanılsın mı?" diye sorunca → **İzin ver**
- [ ] Sol altta yeşil **Ses Bağlandı** yazısı çıktı
- [ ] Konuştuğunda avatarının çevresinde yeşil halka yanıyor
- [ ] Kırmızı telefon simgesiyle sesten çık

**İkinci kişiyle test (isteğe bağlı)**
- [ ] **Başka bir tarayıcıda** (Chrome'dan Edge'e gibi) önizleme bağlantısını aç
  - Gizli sekme işe yaramayabilir, çünkü önizleme GoDaddy girişi istiyor.
- [ ] İkinci bir hesap oluştur, ilk hesaptan bir davet bağlantısı al ve katıl
- [ ] İki pencereden aynı ses kanalına gir; birbirinizi duyabiliyor musunuz?
  - Aynı bilgisayarda iki pencere yankı yapabilir; kulaklık kullan.

---

## Bölüm 9 — ⚠️ Verilerin kalıcılık testi

> **Bu bölümü atlama.** Arkadaşlarını davet etmeden önce mutlaka yap.

### Neden önemli?

Biscord şu verileri sunucunun diskinde tutar:
- `data/biscord.db` → hesaplar, sunucular, mesajlar
- `data/uploads/` → yüklenen resimler ve dosyalar

GoDaddy, uygulama **yeniden başlatıldığında** veya **yeniden yüklendiğinde** diskteki dosyaların korunup korunmadığını açıkça belirtmiyor. Korunmuyorsa her güncellemede **herkesin hesabı ve tüm mesajlar silinir.** GitHub yolunda her `git push` bir yeniden yükleme demek olduğu için bu daha da önemli.

### Test adımları

**Test 1 — Yeniden başlatma**
1. Önizlemede bir hesapla giriş yap, birkaç mesaj ve **bir resim** gönder.
2. GoDaddy panelinde uygulama sayfasında **Yeniden Başlat / Restart** butonuna tıkla.
3. Durum tekrar "Çalışıyor" olunca Biscord sekmesini yenile (**F5**).
4. Sonucu not et:
   - [ ] Hâlâ giriş yapılıyım
   - [ ] Mesajlar duruyor
   - [ ] Resim görünüyor

**Test 2 — Yeniden yükleme**
1. Panelde **Yeniden Yükle / Redeploy** butonuna tıkla. Böyle bir buton yoksa GitHub'da küçük bir değişiklik yap:
   - GitHub'da depo → `README.md` → sağ üstteki kalem simgesi → en alta bir satır ekle → **Commit changes**
   - GoDaddy otomatik olarak yeniden yükler.
2. Durum "Çalışıyor" olunca Biscord'u yenile.
3. Sonucu not et:
   - [ ] Hâlâ giriş yapılıyım
   - [ ] Mesajlar duruyor
   - [ ] Resim görünüyor

### Sonuca göre ne yapmalı?

| Test 1 | Test 2 | Durum | Ne yapmalı |
|---|---|---|---|
| ✅ | ✅ | Veriler kalıcı 🎉 | [Bölüm 10](#bölüm-10--yayınlama-ve-alan-adı-bağlama)'a geç |
| ✅ | ❌ | Güncellemede siliniyor | Günlük kullanım olur ama her güncellemede veriler gider. **MySQL'e geçmemiz gerekir — bana yaz.** |
| ❌ | ❌ | Hiç kalıcı değil | **MySQL'e geçmemiz gerekir — bana yaz.** |

**MySQL'e geçiş nedir?** GoDaddy her yayınlanan uygulamaya ücretsiz bir **MySQL veritabanı** veriyor. Biscord'u verilerini oraya yazacak şekilde değiştirebilirim. Bu senin panelde yapacağın bir ayar değil, benim yapacağım bir kod değişikliği. Yüklenen resimler için de ayrıca bir depolama çözümü gerekebilir.

### GoDaddy desteğine sorulacak hazır soru

Emin olamazsan GoDaddy desteğine (sohbet ya da telefon) şunu sorabilirsin:

> Merhaba, Web Hosting Deluxe paketimle birlikte gelen Node.js Hosting'i kullanıyorum. Uygulamamın yerel diske yazdığı dosyalar (bir SQLite veritabanı dosyası ve kullanıcıların yüklediği resimler), uygulama yeniden başlatıldığında ve GitHub'dan yeniden dağıtıldığında (redeploy) korunuyor mu? Korunmuyorsa, uygulamanın kullanabileceği kalıcı bir klasör yolu (persistent storage / volume) var mı?

Kalıcı bir klasör yolu verirlerse (ör. `/data` ya da `/mnt/storage`), [Bölüm 6.5](#65-ortam-değişkenleri-şimdilik-isteğe-bağlı)'teki gibi `DATA_DIR` ortam değişkenine o yolu yaz ve yeniden başlat. Biscord verilerini oraya yazar.

---

## Bölüm 10 — Yayınlama ve alan adı bağlama

### 10.1 Yayınla

1. Uygulama sayfasında **Yayınla / Publish** butonuna tıkla.
2. Bu işlem Deluxe paketindeki **10 yayın hakkından birini** kullanır.

### 10.2 Alan adını bağla

GoDaddy alan adı soracak.

#### Durum A — Alan adın GoDaddy'de

1. Listeden alan adını seç.
2. **Alt alan adı** kullanacaksan (önerilen) alt alan kısmına `biscord` yaz → sonuç: `biscord.alanadin.com`.
3. **Bağla / Connect** butonuna tıkla. GoDaddy DNS kayıtlarını **kendisi** ayarlar.
4. ⚠️ Ana alan adını (`alanadin.com`) seçersen mevcut sitenin yerini Biscord alır. Emin değilsen alt alan adı kullan.

#### Durum B — Alan adın başka bir firmada

1. Alan adını elle yaz (ör. `biscord.alanadin.com`).
2. GoDaddy sana eklemen gereken DNS kayıtlarını gösterir. Bunları bir yere kopyala. Örnek görünüm (değerler sana özel olacak):

   | Tür | Ad / Host | Değer |
   |---|---|---|
   | CNAME | `biscord` | `xxxxx.godaddy-app.com` gibi bir adres |
   | A | `@` | `123.45.67.89` gibi bir IP |

3. Alan adını aldığın firmanın paneline gir (ör. Natro, Turhost, Isimtescil, Cloudflare) → **DNS Yönetimi**.
4. GoDaddy'nin verdiği **her kaydı birebir** ekle:
   - **Tür:** A veya CNAME
   - **Ad / Host:** alt alan adı için yalnızca `biscord`, ana alan adı için `@`
   - **Değer / Hedef:** GoDaddy'nin verdiği değer
   - **TTL:** varsayılan ya da `3600`
5. Kaydet ve GoDaddy'ye dönüp **Doğrula / Verify** butonuna tıkla.

### 10.3 DNS'in yayılmasını bekle

- Genelde **5–30 dakika**, bazen **48 saate kadar** sürebilir.
- Kontrol etmek için **https://dnschecker.org** adresine alan adını yaz ve doğru adresi gösterip göstermediğine bak.

### 10.4 HTTPS (kilit simgesi)

- GoDaddy SSL sertifikasını **otomatik** oluşturur ve yeniler.
- DNS yayıldıktan sonra sertifikanın hazırlanması birkaç dakika daha sürebilir.
- `https://biscord.alanadin.com` adresini aç; adres çubuğunda 🔒 kilit görünmeli.
- ⚠️ **Kilit görünmeden sesli konuşmayı deneme.** Tarayıcılar mikrofonu yalnızca HTTPS sitelerde açar.

✅ **Kontrol:** Telefonundan, **Wi-Fi'yi kapatıp mobil veriyle** `https://biscord.alanadin.com` adresini aç. Giriş ekranı geliyorsa site internete açılmıştır.

---

## Bölüm 11 — İlk kullanım ve arkadaşları davet etme

### 11.1 Kendi hesabını aç

1. `https://biscord.alanadin.com` → **Kaydol**.
2. ⚠️ Önizlemede açtığın test hesapları, veriler kalıcıysa canlı sitede de duruyor olabilir. Önizleme ve canlı site aynı veriyi kullanıyorsa o hesapla giriş yapabilirsin.

### 11.2 Profilini düzenle

Sol alttaki ⚙️ → **Profiller**:
- **Avatarı Değiştir** → resim yükle
- **Afiş Rengi**, **Özel Durum**, **Hakkımda** → **Değişiklikleri Kaydet**

### 11.3 Sunucunu kur

1. Sol sütun → yeşil **+** → **Kendi Sunucumu Oluştur**.
2. Simgeye tıklayıp resim yükle, ad ver → **Oluştur**.
3. Kanal eklemek için sunucu adına tıkla → **Kanal Oluştur** → **Metin** veya **Ses** → ad ver.
4. Kategori için: sunucu adı → **Kategori Oluştur**.

### 11.4 Roller (moderatör vb.)

1. Sunucu adı → **Sunucu Ayarları** → **Roller** → **Rol Oluştur**.
2. Ad (ör. `Moderatör`), renk ve izinleri seç. Örnek moderatör izinleri:
   - ✅ Mesajları Yönet
   - ✅ Üyeleri At
   - ✅ Üyeleri Sustur
   - ❌ Yönetici (bunu yalnızca çok güvendiğin kişilere ver)
3. **Değişiklikleri Kaydet**.
4. Rolü birine vermek için: sağdaki üye listesinde kişiye **sağ tıkla** → **Roller** → işaretle → **Kaydet**.

### 11.5 Davet et

1. Sunucu adı → **İnsanları Davet Et**.
2. **Süre Sonu:** `7 gün` veya `Asla`. **Maksimum Kullanım:** `Sınırsız`.
3. **Kopyala** → bağlantıyı WhatsApp/Instagram vb. ile gönder:
   ```
   https://biscord.alanadin.com/invite/aBcD2345
   ```
4. Arkadaşın bağlantıyı açınca "X seni Y sunucusuna davet etti" yazan kayıt ekranını görür, kaydolur ve doğrudan sunucuna katılır.

### 11.6 Telefonda uygulama gibi kullanma

- **Android (Chrome):** siteyi aç → sağ üstteki **⋮** → **Ana ekrana ekle**
- **iPhone (Safari):** siteyi aç → alttaki **Paylaş** simgesi → **Ana Ekrana Ekle**

---

## Bölüm 12 — Botu yükleme

Bot, Biscord'dan **ayrı ikinci bir GoDaddy uygulaması** olarak çalışır. 10 uygulama hakkından birini kullanır.

### 12.1 Botu Biscord'da oluştur

1. `https://biscord.alanadin.com` → sol alttaki ⚙️ → **Botlarım**.
2. Kutucuğa bot kullanıcı adı yaz (ör. `yardimci`) → **Yeni Bot**.
3. Sarı çerçeveli kutuda **token** görünür → **Kopyala** → Not Defteri'ne yapıştırıp kaydet.
   - ⚠️ Token **yalnızca bir kez** gösterilir.
   - ⚠️ Token, botunun şifresi gibidir. **Asla** GitHub'a, ekran görüntüsüne veya sohbete koyma.
4. Bot kartında **"Sunucuya ekle…"** listesinden sunucunu seç → "Bot sunucuya eklendi".
5. (İsteğe bağlı) Bot avatarına tıklayıp resim yükle.

### 12.2 Botu GoDaddy'ye yükle

Bot kodu zaten GitHub deponda (`bots/` klasörü). İki yol var:

**Yol 1 — Hazır zip (en kolay)**
1. GoDaddy Node.js paneli → **Yeni Uygulama / Create App** → **Zip yükle**.
2. `D:\Biscord\dist\biscord-bot-godaddy.zip` dosyasını seç.
3. Ad: `biscord-bot`. Başlatma komutu: `npm start`.

**Yol 2 — Aynı GitHub deposundan**
1. **Yeni Uygulama** → **GitHub** → depo: `biscord`, dal: `main`.
2. **Başlatma komutu / Start command:** `npm run bot`
   - Bu alanı değiştirme imkânı yoksa Yol 1'i kullan.

### 12.3 Bot ortam değişkenleri

Bot uygulamasının **Ortam Değişkenleri** bölümüne şunları ekle. Varsa **gizli / şifreli (secret)** seçeneğini işaretle:

| Değişken | Değer |
|---|---|
| `BISCORD_URL` | `https://biscord.alanadin.com` (sonunda `/` olmadan) |
| `BOT_TOKEN` | 12.1'de kopyaladığın token |
| `BOT_PREFIX` | `!` (isteğe bağlı; `!ping` gibi komutlar için) |

**Yükle / Deploy** butonuna tıkla.

### 12.4 Kontrol

Bot uygulamasının **Kayıtlar** sekmesinde şunu görmelisin:

```
✅ yardimci olarak giriş yapıldı — 1 sunucu
```

Biscord'da bir kanala `/` yaz; botun komutları önerilerde görünmeli. `/yardim` gönder, bot cevap vermeli.

| Bot kayıtlarında gördüğün | Çözüm |
|---|---|
| `Bağlantı hatası: Token geçersiz` | Token yanlış ya da yenilenmiş. Biscord → Botlarım → **Token Yenile** → yeni tokeni `BOT_TOKEN`'a yaz. |
| `BOT_TOKEN gerekli` | Ortam değişkeni eklenmemiş ya da adı yanlış yazılmış |
| `Bağlantı hatası: xhr poll error` | `BISCORD_URL` yanlış ya da `https://` eksik |

### 12.5 Önizleme mi, yayın mı?

Bot bir web sitesi değil. Önizleme modunda da 7/24 çalışmaya devam ediyorsa yayınlamana gerek yok. Bir süre sonra duruyorsa (Kayıtlar'da kapanma görürsen ya da bot "çevrimdışı" görünürse) **Yayınla / Publish** de. Botun alan adına ihtiyacı yok.

---

## Bölüm 13 — Sesli konuşma için TURN

### Sorun

Biscord'da ses, kullanıcıların tarayıcıları arasında **doğrudan** akar; senin sunucundan geçmez. Ev internetlerinin çoğunda sorunsuz çalışır. Ancak:
- bazı **mobil veri** (4G/5G) bağlantıları,
- **iş yeri, okul ve yurt** ağları

doğrudan bağlantıyı engeller.

**Belirtisi:** "Ses Bağlandı" yazar, kişi listede görünür, ama birbirinizi **duyamazsınız**.

### Çözüm: TURN sunucusu

TURN, doğrudan bağlanamayan kullanıcıların sesini aradan aktaran bir sunucudur. GoDaddy bunu sağlamaz; harici bir hizmet gerekir.

1. Bir TURN hizmeti seç. Metered.ca gibi sağlayıcılarda başlangıç için ücretsiz kota olabilir; güncel fiyat ve kotaları sağlayıcının sitesinden kontrol et.
2. Hesap aç ve panelden **TURN sunucu adresi**, **kullanıcı adı** ve **şifre** (credential) bilgilerini al.
3. GoDaddy → **biscord** uygulaması → **Ortam Değişkenleri**:

   | Değişken | Değer |
   |---|---|
   | `TURN_URL` | Sağlayıcının verdiği adres, ör. `turn:global.relay.ornek.com:3478` |
   | `TURN_USER` | Sağlayıcının verdiği kullanıcı adı |
   | `TURN_PASS` | Sağlayıcının verdiği şifre |

   Birden fazla adres verildiyse virgülle ayır:
   ```
   turn:a.ornek.com:3478,turn:a.ornek.com:443,turns:a.ornek.com:443
   ```
4. **Yeniden Başlat / Restart**.
5. Herkes Biscord sayfasını **yenilesin** (F5), sonra mobil veriyle tekrar dene.

---

## Bölüm 14 — Güncelleme yayınlama

> ⚠️ Güncellemeden önce [Bölüm 9](#bölüm-9--️-verilerin-kalıcılık-testi)'daki Test 2'nin **✅ geçtiğinden** emin ol. Geçmediyse her güncellemede veriler silinir.

### Yol A — Bana yaptır

Bana "şu özelliği ekle ve GitHub'a gönder" de. Ben değişikliği yapar, test eder ve gönderirim. GoDaddy birkaç dakika içinde siteyi kendiliğinden günceller.

### Yol B — Kendin gönder (PowerShell)

```powershell
cd D:\Biscord
```

```powershell
git add .
```

```powershell
git commit -m "Ne değiştiğini kısaca yaz"
```

```powershell
git push
```

Sonra GoDaddy panelinde **Kayıtlar**'ı izle: yeni bir yükleme başlar ve birkaç dakika içinde biter.

### Yol C — GitHub sitesinden küçük düzenleme

GitHub'da dosyayı aç → sağ üstteki kalem → düzenle → **Commit changes**. GoDaddy otomatik olarak yeniden yükler.

### Bir güncelleme siteyi bozarsa: geri alma

1. GitHub → depo → **Commits** (saat simgeli "X commits" bağlantısı).
2. Sorunlu kaydı bul → sağdaki **⋯** → **Revert** (geri al) varsa kullan.
3. Ya da bana "son güncellemeyi geri al" de; tek komutla geri alırım ve GoDaddy önceki sürümü yükler.

---

## Bölüm 15 — Sorun giderme

### Site açılmıyor

| Belirti | Kontrol et |
|---|---|
| "Bu siteye ulaşılamıyor" | DNS henüz yayılmamış olabilir → dnschecker.org ([Bölüm 10.3](#103-dnsin-yayılmasını-bekle)) |
| GoDaddy hata sayfası / 502 / 503 | Uygulama çökmüş → **Kayıtlar** ([Bölüm 7](#bölüm-7--kayıtları-log-okuma)) |
| "Bağlantınız gizli değil" uyarısı | SSL henüz hazır değil → 15–30 dakika bekle |
| Ana web sitem gitti | Ana alan adını Biscord'a bağladın → Biscord'u alt alan adına taşı ([Bölüm 10.2](#102-alan-adını-bağla)) |

### Giriş ve mesajlaşma

| Belirti | Kontrol et |
|---|---|
| Sürekli kırmızı **"Bağlantı koptu, yeniden bağlanılıyor…"** | Gerçek zamanlı bağlantı engelleniyor. Kayıtlara bak; devam ederse GoDaddy desteğine WebSocket desteğini sor. |
| "Oturum geçersiz" ve herkes çıkış yapmış | Veriler silinmiş → [Bölüm 9](#bölüm-9--️-verilerin-kalıcılık-testi) |
| Resim yüklenmiyor, "Dosya çok büyük" | `MAX_UPLOAD_MB` değerini artır (en fazla 50 öneririm) |
| Güncelleme yaptım ama değişiklik görünmüyor | Sayfayı **Ctrl+F5** ile zorla yenile. GoDaddy kayıtlarında yeni yüklemenin bittiğini kontrol et. |

### Ses ve görüntü

| Belirti | Kontrol et |
|---|---|
| Mikrofon izni hiç sorulmuyor | Adres `https://` ile mi başlıyor? Kilit simgesi var mı? |
| "Mikrofona erişilemedi" | Adres çubuğundaki 🔒 → **Mikrofon** → **İzin ver** → sayfayı yenile. Windows: **Ayarlar → Gizlilik → Mikrofon** → tarayıcıya izin ver. |
| Bağlandım ama kimseyi duymuyorum | [Bölüm 13 (TURN)](#bölüm-13--sesli-konuşma-için-turn). Ayrıca kulaklık simgesi kırmızı mı (sağırlaştırma açık mı)? |
| Beni duymuyorlar | Mikrofon simgesi kırmızı mı? ⚙️ → **Ses ve Görüntü** → doğru **Giriş Cihazı** seçili mi? **Kontrol Edelim** ile test et. |
| Yankı / cızırtı | Kulaklık kullan. ⚙️ → Ses ve Görüntü → **Yankı Giderme** ve **Gürültü Azaltma** açık olsun. |
| Ekran paylaşımı çalışmıyor | Telefon tarayıcıları ekran paylaşımını desteklemez; bilgisayardan dene. |
| Kalabalık kanalda ses kesiliyor | Ses doğrudan kişiler arasında aktığı için her kişi diğer herkesle ayrı bağlantı kurar. Kamera açıkken 6–8 kişiyi aşma. |

### Hâlâ çözülmediyse

Bana şunları gönder:
1. GoDaddy **Kayıtlar** sekmesinden son 30–50 satırın ekran görüntüsü
2. Sorunun olduğu sayfanın ekran görüntüsü
3. Tarayıcıda **F12** → **Console** sekmesindeki kırmızı yazılar

---

## Bölüm 16 — Güvenlik kontrol listesi

- [ ] GitHub deposu **Private** (🔒)
- [ ] GitHub hesabında **iki adımlı doğrulama** açık
- [ ] GoDaddy hesabında **iki adımlı doğrulama** açık (Hesap Ayarları → Giriş ve PIN → 2 Adımlı Doğrulama)
- [ ] `.env` dosyası GitHub'da **yok**
- [ ] Bot tokeni yalnızca GoDaddy ortam değişkeninde (gizli olarak), başka hiçbir yerde değil
- [ ] Biscord'daki kendi hesabının şifresi güçlü ve başka sitelerde kullanılmıyor
- [ ] **Yönetici** rolü yalnızca çok güvendiğin kişilerde
- [ ] Davet bağlantıları herkese açık bir yerde paylaşılacaksa süre sınırlı (ör. 7 gün)
- [ ] Bot tokeni sızdıysa: Biscord → Botlarım → **Token Yenile** (eski token anında geçersiz olur)

---

## Ek A — Zip ile yükleme (GitHub'sız yol)

GitHub kullanmak istemezsen:

1. GoDaddy Node.js paneli → **Yeni Uygulama** → **Zip yükle / Upload zip**.
2. `D:\Biscord\dist\biscord-godaddy.zip` dosyasını seç. Dosyayı **açmadan**, zip olarak yükle.
3. Ayarlar [Bölüm 6.4](#64-uygulama-ayarları)'tekiyle aynı.
4. Bölüm 7'den itibaren her şey aynı.

**Güncelleme:** Bana "yeni zip hazırla" de. Sonra GoDaddy'de **Yeniden Yükle / Redeploy** → yeni zip'i seç.

**Sonradan GitHub'a geçmek:** İstediğin zaman GitHub'a geçebilirsin. Veriler kalıcıysa (Bölüm 9) geçişte bir şey kaybolmaz. Emin olmak için geçişi yeni bir uygulama açarak değil, mevcut uygulamanın kaynağını değiştirerek yap.

---

## Ek B — Sözlük

| Terim | Anlamı |
|---|---|
| **Node.js** | Biscord'un sunucu tarafının yazıldığı JavaScript çalıştırma ortamı |
| **Depo (repository)** | GitHub'da projenin dosyalarının ve geçmişinin durduğu yer |
| **Commit** | Değişikliklerin kaydedilmiş bir anlık görüntüsü |
| **Push** | Bilgisayardaki commit'leri GitHub'a göndermek |
| **Dal (branch)** | Projenin bir kolu; bizde ana dal `main` |
| **Deploy / Dağıtım** | Kodu sunucuya kurup çalıştırmak |
| **Redeploy** | Kodu yeniden kurup yeniden başlatmak |
| **Önizleme (preview)** | Yalnızca senin görebildiğin, yayın öncesi test adresi |
| **Ortam değişkeni (env var)** | Koda yazılmayan ayarlar ve şifreler (ör. `BOT_TOKEN`) |
| **Log / Kayıt** | Uygulamanın çalışırken yazdığı mesajlar |
| **DNS** | Alan adını sunucunun adresine yönlendiren sistem |
| **A / CNAME kaydı** | DNS'te alan adının nereye gideceğini söyleyen kayıt türleri |
| **SSL / HTTPS** | Şifreli bağlantı; adres çubuğundaki kilit |
| **WebRTC** | Tarayıcılar arası doğrudan ses/görüntü teknolojisi |
| **TURN** | Doğrudan bağlanamayan kullanıcıların sesini aktaran sunucu |
| **Token** | Botun şifresi gibi çalışan gizli anahtar |
| **SQLite** | Biscord'un şu an kullandığı, tek dosyalık veritabanı |
| **MySQL** | GoDaddy'nin verdiği, ayrı çalışan veritabanı |
