# Biscord E-postalarını Brevo ile Gönderme — Kılavuz

Biscord şu e-postaları gönderir:
- şifre sıfırlama kodu,
- e-posta doğrulama kodu,
- iki adımlı doğrulama açıksa giriş kodu.

Bu kılavuz, bu e-postaları **Brevo** (eski adıyla Sendinblue) ile göndermeyi adım adım anlatır.

> **Neden Brevo?** Ücretsiz planında günde yaklaşık 300 e-posta gönderilebilir; Biscord için fazlasıyla yeterli. Güncel kotaları Brevo'nun fiyat sayfasından kontrol et.
> Biscord, Brevo'ya **API anahtarı** ile bağlanır. Bu yöntem HTTPS üzerinden çalışır. GoDaddy gibi barındırma firmaları e-posta portlarını (25/465/587) sıklıkla engellediği için SMTP yerine API daha güvenilirdir.

> Not: Brevo panelindeki menü adları zamanla değişebilir; sitenin dili İngilizce görünüyorsa aşağıda her adımın İngilizce adını da yazdım.

---

## İçindekiler

1. [Brevo hesabı aç](#1-brevo-hesabı-aç)
2. [Gönderen e-posta adresini doğrula](#2-gönderen-e-posta-adresini-doğrula)
3. [(Önerilen) Alan adını doğrula — spam'e düşmesin](#3-önerilen-alan-adını-doğrula--spame-düşmesin)
4. [API anahtarı oluştur](#4-api-anahtarı-oluştur)
5. [Biscord'a anahtarı gir](#5-biscorda-anahtarı-gir)
6. [Test et](#6-test-et)
7. [Alternatif: SMTP ile bağlanma](#7-alternatif-smtp-ile-bağlanma)
8. [Sorun giderme](#8-sorun-giderme)

---

## 1. Brevo hesabı aç

1. **https://www.brevo.com** adresine git → sağ üstte **Ücretsiz Kaydol / Sign up free**.
2. E-posta ve şifreni gir (ya da Google ile kaydol).
3. E-postana gelen bağlantıya tıklayıp hesabını onayla.
4. Brevo birkaç soru sorar (şirket adı, web sitesi, adres, telefon). Gerçek bilgilerini gir:
   - **Şirket / Company:** `Biscord` ya da kendi adın
   - **Web sitesi / Website:** `https://biscord.alanadin.com`
   - Plan seçimi sorulursa **Ücretsiz / Free** seç.
5. Brevo hesabını kısa bir süre inceleyebilir (genelde dakikalar ile birkaç saat arası). Bu süre içinde gönderim kısıtlı olabilir.

✅ **Kontrol:** Brevo paneline giriş yapabiliyorsun.

---

## 2. Gönderen e-posta adresini doğrula

Biscord e-postalarının **kimden** geleceğini belirle; örneğin `bildirim@alanadin.com` ya da kendi Gmail adresin.

> En iyisi **kendi alan adındaki** bir adres (ör. `bildirim@alanadin.com`). Gmail/Hotmail adresinden gönderilen e-postalar alıcılarda daha sık spam'e düşer.
> GoDaddy'den e-posta hesabın yoksa ücretsiz bir yönlendirme (forwarding) adresi de iş görür; önemli olan o adrese gelen doğrulama e-postasını açabilmen.

1. Sağ üstte adına tıkla → **Gönderenler, Alan Adları ve Özel IP'ler / Senders, Domains & Dedicated IPs**.
2. **Gönderenler / Senders** sekmesi → **Gönderen ekle / Add sender**.
3. Formu doldur:
   - **Ad / From Name:** `Biscord`
   - **E-posta / From Email:** `bildirim@alanadin.com`
4. **Kaydet / Add sender**. Brevo o adrese bir doğrulama e-postası (ya da 6 haneli kod) gönderir.
5. Gelen e-postadaki bağlantıya tıkla ya da kodu Brevo'ya gir.

✅ **Kontrol:** Gönderen listesinde adresinin yanında yeşil **Doğrulandı / Verified** yazıyor.

---

## 3. (Önerilen) Alan adını doğrula — spam'e düşmesin

Bu adım zorunlu değil, ama yapılmazsa kodlar alıcıların **Spam / Gereksiz** klasörüne düşebilir. Alan adın GoDaddy'deyse 10 dakikada biter.

1. Brevo → **Gönderenler, Alan Adları ve Özel IP'ler** → **Alan Adları / Domains** sekmesi → **Alan adı ekle / Add a domain**.
2. Alan adını yaz: `alanadin.com` → **Kaydet**.
3. Brevo sana eklemen gereken **DNS kayıtlarını** gösterir. Genelde şunlardır:

   | Tür | Ad / Host | Değer (Brevo'nun gösterdiği) |
   |---|---|---|
   | TXT | `@` | `brevo-code:xxxxxxxx` (sahiplik doğrulama) |
   | TXT (veya CNAME) | `mail._domainkey` gibi | DKIM anahtarı (uzun bir metin) |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:...` |

   Bu sayfayı açık bırak.
4. Yeni bir sekmede **GoDaddy** → **Ürünlerim** → alan adının yanında **DNS** / **DNS'i Yönet**.
5. Brevo'nun verdiği **her kaydı** GoDaddy'de ekle:
   - **Ekle / Add New Record** → **Tür:** Brevo'daki tür (TXT veya CNAME)
   - **Ad / Name:** Brevo'daki "Host" değeri. GoDaddy alan adını kendisi ekler; `mail._domainkey.alanadin.com` yazıyorsa yalnızca `mail._domainkey` yaz.
   - **Değer / Value:** Brevo'daki değeri **eksiksiz** kopyala-yapıştır.
   - **TTL:** varsayılan → **Kaydet**.
   > ⚠️ Alan adında zaten `v=spf1 ...` ile başlayan bir TXT kaydı varsa ikinci bir SPF kaydı **ekleme**. Brevo bir SPF bilgisi veriyorsa mevcut kaydın içine `include:spf.brevo.com` ifadesini ekle (ör. `v=spf1 include:secureserver.net include:spf.brevo.com ~all`).
6. Brevo'ya dön → **Doğrula / Authenticate this email domain**.
7. DNS'in yayılması birkaç dakika ile birkaç saat sürebilir. Hemen olmazsa bir süre sonra tekrar **Doğrula**'ya bas.

✅ **Kontrol:** Alan adının yanında **Doğrulandı / Authenticated** yazıyor.

---

## 4. API anahtarı oluştur

1. Brevo → sağ üstte adına tıkla → **SMTP ve API / SMTP & API**.
2. **API Anahtarları / API Keys** sekmesi → **Yeni API anahtarı oluştur / Generate a new API key**.
3. Ad: `Biscord` → **Oluştur / Generate**.
4. Ekranda `xkeysib-...` ile başlayan uzun bir anahtar görünür.
   - ⚠️ **Hemen kopyala.** Brevo bu anahtarı bir daha göstermez.
   - ⚠️ Bu anahtar şifre gibidir: GitHub'a, ekran görüntüsüne veya sohbete **koyma**.
5. Panelde "IP adreslerini yetkilendir / Authorised IPs" gibi bir uyarı görürsen, en kolayı bu kısıtlamayı **kapatmaktır**. GoDaddy'nin sunucu IP'si değişebilir; kısıtlama açık kalırsa e-postalar "unauthorized IP" hatasıyla reddedilir.

---

## 5. Biscord'a anahtarı gir

### GoDaddy'de (canlı site)

1. **GoDaddy** → **Node.js Hosting** → **biscord** uygulaması → **Ortam Değişkenleri / Environment Variables**.
2. Şu iki değişkeni ekle:

   | Değişken | Değer | Gizli mi? |
   |---|---|---|
   | `BREVO_API_KEY` | `xkeysib-...` (4. adımda kopyaladığın) | ✅ Evet, gizli olarak işaretle |
   | `MAIL_FROM` | `Biscord <bildirim@alanadin.com>` | Hayır |

   > `MAIL_FROM` içindeki adres, **2. adımda doğruladığın** adresle birebir aynı olmalı. Aksi hâlde Brevo e-postayı reddeder.
3. Uygulamayı **Yeniden Başlat / Restart**.

### Bilgisayarında (yerel deneme)

`D:\Biscord\.env` dosyasını aç ve şu satırları ekle (dosya GitHub'a gönderilmez):

```
BREVO_API_KEY=xkeysib-...
MAIL_FROM=Biscord <bildirim@alanadin.com>
```

Sonra sunucuyu yeniden başlat:

```powershell
npm start
```

---

## 6. Test et

1. Biscord'a yönetici hesabınla gir (`Adminolmakben`).
2. Sol alttaki profilin → **Yönetim Paneli** → **Duyuru ve Ayarlar**.
3. **E-posta** bölümünde kendi e-posta adresini yaz → **Test Gönder**.
4. Birkaç saniye içinde "Biscord test e-postası" gelmeli. Gelen kutunda yoksa **Spam / Gereksiz** klasörüne bak.

Gerçek bir akışla denemek için:
1. Normal bir hesapla **Ayarlar → Gizlilik ve Güvenlik → E-posta Ekle**.
2. Gelen 6 haneli kodu gir → e-posta doğrulanır.
3. Çıkış yap → giriş ekranında **Şifreni mi unuttun?** → kod e-postana gelir.

Brevo panelinde **İşlemsel / Transactional → Kayıtlar / Logs** bölümünden giden her e-postanın durumunu (gönderildi, açıldı, reddedildi) görebilirsin.

---

## 7. Alternatif: SMTP ile bağlanma

API anahtarı kullanmak istemezsen Brevo'nun SMTP sunucusu da çalışır. **Ancak GoDaddy çoğu zaman bu portları engeller**, o yüzden önce API'yi dene.

1. Brevo → **SMTP ve API / SMTP & API** → **SMTP** sekmesi.
2. **SMTP anahtarı oluştur / Generate a new SMTP key**. Anahtarı kopyala.
3. Aynı sayfada **Giriş / Login** bilgisini gör (genelde `xxxx@smtp-brevo.com` gibi bir adres).
4. Ortam değişkenleri:

   | Değişken | Değer |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | Brevo'nun gösterdiği giriş adresi |
   | `SMTP_PASS` | SMTP anahtarı (gizli) |
   | `SMTP_FROM` | `Biscord <bildirim@alanadin.com>` |

> `BREVO_API_KEY` tanımlıysa Biscord önce onu kullanır; SMTP ayarları yalnızca API anahtarı yoksa devreye girer.

---

## 8. Sorun giderme

| Belirti | Sebep ve çözüm |
|---|---|
| Yönetim panelinde **"E-posta ayarlanmamış"** | `BREVO_API_KEY` eklenmemiş ya da uygulama yeniden başlatılmamış. Değişkeni kontrol et → Restart. |
| Test: **"Brevo API anahtarı geçersiz (401)"** | Anahtar yanlış/eksik kopyalanmış veya silinmiş. Brevo'da yeni anahtar oluştur ve tekrar gir. |
| **"unauthorized IP address"** / 401 | Brevo'da IP kısıtlaması açık. SMTP & API → API Keys → **Authorised IPs** kısıtlamasını kapat. |
| **"sender not valid"** / 400 | `MAIL_FROM` adresi Brevo'da doğrulanmamış. 2. adımı tamamla ve adresi birebir aynı yaz. |
| E-postalar **spam'e** düşüyor | 3. adımı (alan adı doğrulama: DKIM, DMARC) yap. Gmail adresi yerine kendi alan adından gönder. |
| Hiç e-posta gelmiyor, hata da yok | Brevo → Transactional → **Logs** bölümüne bak. "Blocked" görüyorsan alıcı daha önce şikâyet etmiş ya da adres geçersiz olabilir. |
| Hesap **askıya alındı / under review** | Yeni hesaplar incelenebilir. Brevo'nun e-postasını yanıtla ve web sitesini belirt; onaylanınca gönderim açılır. |
| Günlük sınır doldu | Ücretsiz planın günlük kotası bitmiş. Ertesi gün sıfırlanır; daha fazlası için ücretli plan gerekir. |

### Güvenlik kontrol listesi

- [ ] `BREVO_API_KEY` GoDaddy'de **gizli** olarak işaretli
- [ ] Anahtar GitHub'da, ekran görüntülerinde veya sohbetlerde **yok**
- [ ] Brevo hesabında **iki adımlı doğrulama** açık
- [ ] Anahtar sızdıysa: Brevo → SMTP & API → API Keys → eski anahtarı **sil**, yenisini oluştur
