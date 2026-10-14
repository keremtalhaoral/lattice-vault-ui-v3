# Lattice Vault UI v3

Lattice Vault kasası için **yerel, salt-okunur** web arayüzü. Python stdlib HTTP sunucusu + vanilla ES modülleri; framework, build adımı, CDN yok. Yazı tipleri (Source Serif 4, IBM Plex Mono) `static/fonts/` içinde, OFL lisanslarıyla.

## Ekranlar

- **Bellekler** — tam metin arama (FTS5, Türkçe normalizasyon: `ı/i`, `ş/s`, büyük/küçük harf duyarsız), tür / ajan / durum / tarih filtreleri, düz liste. Satır seçince ayrıntı: içerik, kaynak/ajan, event ID, mutlak tarih (UTC+3), düzeltme/supersede geçmişi, kanıt/köken, hash zinciri doğrulaması (veriden gerçekten hesaplanır), ilişkiler (yalnızca veride var olan bağlar).
- **Kuyruk (n)** — ajan önerileri, salt-okunur. Her öğe için `vault approve <id>` / `vault reject <id>` komutunu kopyalama. Arayüzden onay **yok**; korumalı onay “Planlandı — henüz uygulanmadı” olarak işaretli.
- **Geçmiş** — yalnızca-ekleme olay günlüğü, sayfalı.
- **Ayarlar** — bilgi amaçlı: yerel çalışma, gizlenmiş DB yolu, yedek/dışa aktarma CLI ipuçları, güvenlik sınırları.

Durum dili: `Önerildi`, `Onaylandı (CLI)` (nötr — onaylar imzasız), `Kaydedildi (kullanıcı)`, `Düzeltildi`, `Reddedildi`, `Geri alındı`, `İmha edildi`. “Doğrulandı” onaylar için kullanılmaz.

## Kurulum / çalıştırma

Klasörler kardeş olmalı: `lattice-vault-release/` (veya `lattice-vault/`) ve `lattice-vault-ui-v3/`. Farklı konum: `VAULT_SRC=/yol/lattice-vault`.

```sh
cd lattice-vault-ui-v3
python3 tools/make_demo.py demo            # sentetik demo kasası (kurgusal "Ada"), demo/ git'e girmez
python3 server.py --db demo/vault.db       # http://127.0.0.1:8766/
# gerçek kasa:  python3 server.py --db ~/.../vault.db   (veya VAULT_DB=...)
python3 -m unittest -v test_api            # API testleri (kendi geçici demo DB'sini üretir)
```

## Güvenlik ve gizlilik

- Yalnızca `127.0.0.1`'e bağlanır; `Host` başlığı `127.0.0.1`/`localhost` değilse 421 (DNS rebinding koruması).
- DB her istekte SQLite `file:…?mode=ro` ile açılır (core `event_detail.open_ro`); `vault.connect()` hiç çağrılmaz. POST/PUT/PATCH/DELETE → 405. Onay uç noktası yoktur.
- Şifreli alanlar çözülmez (`[encrypted]`), imha edilenler `[redacted]`, gizli anahtar benzeri metinler `[filtered:…]` — core `vault show` ile aynı kod (`event_detail.safe_payload`).
- CSP: `default-src 'self'` (harici kaynak yok), `nosniff`, `frame-ancestors 'none'`, `no-referrer`. Tüm çıktı DOM `textContent` ile yazılır (HTML string yok).
- Bilinen sınırlar: arayüzde oturum/erişim denetimi yok (yerel her süreç porta erişebilir); okumalar denetim kaydına yazılmaz; onaylar imzasız; hash zinciri yazma yetkisi olan birine karşı çapalı değil.

## Erişilebilirlik

`lang="tr"`, “İçeriğe atla” bağlantısı, `:focus-visible` 2px vurgu çerçevesi, etiketli kontroller, durum her zaman metinle (yalnız renk değil), listede ok tuşları / Home / End / `j` `k` ile gezinme, mobilde 44px dokunma hedefleri, 390px genişlikte yatay taşma yok, `prefers-reduced-motion` desteği. Yalnızca açık tema (v1).

---

**English (short).** Local, read-only web UI for a Lattice Vault SQLite DB. Python stdlib server bound to 127.0.0.1, DB opened `mode=ro` per request, no write/approve endpoints, CSP self-only, self-hosted fonts. Reuses core `event_detail` / `vault.search`. Run: `python3 tools/make_demo.py demo && python3 server.py --db demo/vault.db`, open http://127.0.0.1:8766/. Tests: `python3 -m unittest -v test_api`. License: Apache-2.0 (same as Lattice Vault core); fonts under OFL-1.1.
