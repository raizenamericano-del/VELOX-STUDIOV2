# Changelog

## 2.0.0 — Studio Edition (2026-10-14)

### Desain baru
- Menulis ulang struktur halaman, seluruh stylesheet, hero, navigasi, form, platform, bento fitur, tutorial, dokumentasi API, FAQ, footer, drawer, dan 404.
- Identitas charcoal/lime, tema terang, favicon baru, font lokal berlisensi, ilustrasi CSS/SVG, dan animasi responsif terhadap reduced motion.
- Copy utama berbahasa Indonesia dengan label editorial; menghapus klaim kecepatan/watermark yang tidak terjamin.

### Perilaku frontend
- Validasi URL HTTP(S), proteksi input kredensial/alamat lokal, deteksi hostname yang lebih tepat.
- Normalisasi URL tanpa skema, tombol hapus input, paste tanpa autosubmit.
- Kontrol request aktif, abort browser, timeout dua menit, dan indikator busy.
- Pencarian platform; kartu kini memilih konteks input, bukan mengirim sample URL.
- Filter format hasil dan penanganan thumbnail/metadata yang lebih aman.
- Unduhan hanya melalui endpoint same-origin `/api/dl`; menonaktifkan tombol unduh saat sibuk.
- Riwayat robust terhadap data storage rusak; undo hapus semua; pembaruan antar-tab; aksesibilitas modal.
- Theme persistence sebelum first paint, API keyboard tabs, copy snippet.

### Server dan tooling
- Engine/resolver asli tetap dipertahankan, termasuk tiklydown dari arsip pengguna.
- `.env` dibaca native saat server mulai, Node minimum 20.19.
- Manifest diselaraskan dengan identitas baru.
- Iframe preview hanya lewat opt-in `ALLOW_EMBED_PREVIEW=true`; default tetap SAMEORIGIN.
- Penambahan 12 tes DOM (total 69 unit/DOM) dan smoke test Playwright + axe-core.
- Assertion lama TikTok diperbaiki agar mengikuti resolver yang memang sudah ada di project sumber.
- Panduan instalasi, catatan batasan, laporan pengujian, dan screenshot lokal disertakan.

### Tetap menjadi batasan
- Provider pihak ketiga tidak dijamin selalu online.
- Pembatalan browser tidak menjamin seluruh pekerjaan server ikut berhenti.
- Download frontend menggunakan Blob dalam memori.
- Tidak ada klaim dukungan semua format/platform secara universal, bypass private content, atau offline downloader.
