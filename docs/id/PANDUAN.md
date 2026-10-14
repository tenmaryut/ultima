# Panduan pengguna Ultima

🇬🇧 English: [docs/USER_GUIDE.md](../USER_GUIDE.md)

Ultima adalah satu aplikasi dengan sepuluh alat. Panduan ini menjelaskan bagian yang sama di semua alat,
lalu tiap alat satu per satu. Baru mulai? Pasang dulu ([INSTALL.md](INSTALL.md)), lalu jika mau hubungkan AI
([AI_SETUP.md](AI_SETUP.md)).

- [Tampilan jendela](#tampilan-jendela)
- [Membuka, menyimpan, dan mengekspor](#membuka-menyimpan-dan-mengekspor)
- [Pintasan keyboard](#pintasan-keyboard)
- [Asisten AI](#asisten-ai)
- [Pengaturan](#pengaturan)
- Alat: [Editor Foto](#editor-foto) · [Olah Foto](#olah-foto) · [Desain Vektor](#desain-vektor) ·
  [Tata Letak & Publikasi](#tata-letak--publikasi) · [Editor Video](#editor-video) · [Motion Grafis](#motion-grafis) ·
  [Editor Audio](#editor-audio) · [Studio PDF](#studio-pdf) · [Studio Warna](#studio-warna) · [Studio AI](#studio-ai)
- [Tips & mengatasi masalah](#tips--mengatasi-masalah)

Label tombol dan menu di panduan ini memakai teks antarmuka berbahasa Indonesia (*Pengaturan → Umum → Bahasa*).

## Tampilan jendela

```
┌────┬──────────────────────────────────────────────────────────────┬──────────┐
│ U  │  Nama alat — dokumen   File Edit Gambar …   [opsi alat]     ✨ │          │
│    ├────┬────────────────────────────────────────────┬──────────┤  Asisten │
│ 🖼  │ A  │                                            │ Panel    │  AI      │
│ ⦿  │ l  │              Kanvas / pratinjau            │ (layer,  │          │
│ ✒  │ a  │                                            │ properti)│          │
│ …  │ t  │                                            │          │          │
│    │    ├────────────────────────────────────────────┴──────────┤          │
│ ⚙  │    │  Timeline (Video, Motion, Audio)                        │          │
└────┴────┴─────────────────────────────────────────────────────────┴──────────┘
```

- **Rail (paling kiri):** berpindah alat. Setiap alat tetap membuka dokumennya saat Anda memakai alat lain,
  jadi Anda bisa misalnya memotong video, lompat ke Editor Foto untuk memperbaiki thumbnail, lalu kembali.
- **Header:** menu alat (File, Edit, …), opsi untuk alat yang sedang dipakai, dan tombol ✨ untuk asisten AI.
- **Palet kiri:** alat menggambar/seleksi. Arahkan kursor ke tombol untuk melihat nama dan huruf pintasannya.
- **Panel kanan:** layer, properti, riwayat, dan panel lain. Klik judul panel untuk melipatnya.
- **Status bar:** zoom, ukuran, posisi kursor, dan detail lain.
- **Beranda** (logo di atas rail, atau **Ctrl/⌘ + Shift + H**): membuka file, file terbaru, dan semua alat.

**Zoom dan geser.** Di alat berbasis kanvas (Foto, Olah Foto, Vektor, Tata Letak, Motion, PDF): **Ctrl/⌘ + roda
mouse** atau cubit (pinch) untuk zoom, roda mouse untuk menggulir, tahan **Spasi** lalu seret (atau seret dengan
tombol tengah mouse) untuk menggeser, **Ctrl/⌘ + 0** pas ke layar, dan **Ctrl/⌘ + 1** untuk 100%. Di alat berbasis
timeline (Video, Audio) **Spasi** memutar dan menjeda; **Ctrl/⌘ + roda mouse** memperbesar timeline dan
**Ctrl/⌘ + 0** memaskannya. Perbedaan kecil dijelaskan di bagian masing-masing alat.

## Membuka, menyimpan, dan mengekspor

- **Buka:** *Beranda → Buka file…*, **Ctrl/⌘ + O** di dalam alat, atau seret file ke jendela. Ultima memilih alat
  yang tepat dari jenis file: gambar dan `.psd` → Editor Foto, RAW kamera dan TIFF → Olah Foto,
  `.svg` → Desain Vektor, video → Editor Video, audio → Editor Audio, `.pdf` → Studio PDF,
  palet `.ase`/`.gpl` → Studio Warna, `.ultima` → alat yang menyimpannya.
- **Simpan (Ctrl/⌘ + S)** menyimpan **proyek Ultima** (`.ultima`) yang masih bisa diedit, lengkap dengan layer,
  timeline, dan pengaturan. Penyimpanan pertama menanyakan lokasi; berikutnya menimpa file yang sama (di versi
  browser Anda memilih lokasi setiap kali). **Simpan Sebagai** = **Ctrl/⌘ + Shift + S**. Dua pengecualian:
  Simpan di Studio PDF menulis file PDF-nya langsung, dan Studio AI menyimpan obrolan secara otomatis.
- Tanda **•** setelah nama dokumen berarti ada perubahan yang belum disimpan. Jika Anda menutup Ultima saat masih
  ada perubahan yang belum disimpan di alat mana pun, Ultima akan bertanya dulu.
- **Ekspor (Ctrl/⌘ + E)** membuat file biasa untuk dibagikan: PNG/JPG/WebP/PSD, SVG/PDF, MP4/WebM/GIF,
  WAV/MP3, dan lain-lain. Pilihan ekspor tergantung alatnya.
- **Kirim ke alat lain:** gambar dari Studio AI terbuka di Editor Foto, gambar SVG di Desain Vektor, teks obrolan
  menjadi bingkai teks di Tata Letak, layer teks di Motion, atau judul di Editor Video, dan palet dari Studio Warna
  menjadi swatch di Vektor, warna tema di Tata Letak, atau warna baru untuk layer Motion.

## Pintasan keyboard

Di macOS gunakan **⌘** sebagai pengganti **Ctrl**.

| Aksi | Pintasan |
| --- | --- |
| Buka / Simpan / Simpan sebagai / Ekspor | Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+E |
| Dokumen baru | Ctrl+N |
| Urungkan / Ulangi | Ctrl+Z / Ctrl+Shift+Z (Windows/Linux juga Ctrl+Y) |
| Hapus yang dipilih | Delete atau Backspace |
| Duplikat | Ctrl+D |
| Pilih semua / Batalkan pilihan | Ctrl+A / Ctrl+Shift+A |
| Perbesar / perkecil / pas / 100% | Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+1 (alat timeline: lihat bagiannya) |
| Geser kanvas | Spasi + seret, atau seret tombol tengah mouse |
| Tampilkan/sembunyikan asisten AI | Ctrl+J |
| Beranda / Pengaturan | Ctrl+Shift+H / Ctrl+, |

Setiap alat punya pintasan satu huruf (terlihat di tooltip dan tercantum di bawah), mis. **V** pindah, **B** kuas,
**T** teks. Pintasan ini tidak aktif saat Anda sedang mengetik di kolom teks.

## Asisten AI

Setiap editor punya panel asisten (✨ atau **Ctrl/⌘ + J**). Panel ini butuh satu koneksi AI — lihat
[AI_SETUP.md](AI_SETUP.md); model lokal gratis juga bisa.

1. Ketik keinginan Anda dengan bahasa sendiri, bahasa apa pun: *“buat foto lebih hangat dan beri vignette halus”*,
   *“tambahkan judul PROMO AKHIR TAHUN di atas, tebal, warna putih”*, *“hapus jeda hening lebih dari satu detik”*.
2. Asisten membalas dengan pesan singkat dan daftar **langkah edit**. Buka *N langkah edit* untuk melihat detailnya.
3. Tekan **Terapkan**. Semua langkah dari satu jawaban menjadi **satu langkah undo**, jadi Ctrl+Z membatalkan seluruh perubahan itu.

Perlu diketahui:

- Pilih AI yang menjawab lewat pemilih di bagian atas panel.
- Tombol 📷 mengirim cuplikan kecil kanvas agar AI bisa melihat hasil kerja Anda (hanya ke AI yang mendukung gambar).
  Matikan untuk dokumen pribadi.
- **Pengaturan → Perilaku AI → Terapkan hasil edit AI otomatis** melewati langkah peninjauan.
- Asisten hanya bisa melakukan langkah edit yang tersedia di alat tersebut (tercantum di bagian tiap alat); jika
  tidak bisa, asisten akan mengatakannya. Sebagian besar alat juga punya menu **AI** dengan bantuan yang lebih besar
  (desain dari brief, subtitle otomatis, ringkasan PDF…).
- Jawaban dari alat berlangganan butuh beberapa detik karena alatnya dijalankan untuk setiap permintaan.
- Studio AI tidak punya panel asisten — obrolannya sendiri adalah AI-nya.

## Pengaturan

- **Umum:** bahasa (English / Bahasa Indonesia), tema (gelap, terang, ikuti sistem), dan gradasi warna (Ultima,
  Samudra, Senja, Hutan, Aurora, Mawar, Grafit). Gradasi mewarnai logo, garis tipis di bagian atas jendela, banner
  Beranda, dan tombol di Beranda serta Pengaturan. Tiap tool tetap memakai warnanya sendiri, kecuali Anda
  menyalakan *Pakai warna gradasi juga di semua tool*.
- **Koneksi AI:** cara memasang, status, saklar aktif/nonaktif, model, tombol Uji, dan lokasi program untuk setiap
  alat AI; AI utama; perintah kustom.
- **Perilaku AI:** terapkan otomatis, cuplikan kanvas, *jangan pernah menagih API key*, batas waktu per permintaan.
- **Pembuatan gambar:** generator untuk Studio AI → Gambar dan Foto → Buat Gambar — Stable Diffusion WebUI, ComfyUI,
  server gambar lokal bergaya OpenAI seperti LocalAI, Antigravity dengan paket Google AI Anda, Codex dengan paket
  ChatGPT Anda, atau *Gambar SVG oleh AI Anda* (AI apa pun yang terhubung, misalnya Claude) — beserta alamat, model
  atau AI-nya, dan tombol *Periksa*. Lihat [AI_SETUP.md](AI_SETUP.md#pembuatan-gambar).
- **Suara (teks ke suara):** mesin (suara sistem, Piper, atau perintah kustom), kecepatan, suara Piper (*Pilih
  suara…*), dan perintah kustom (aplikasi desktop). Lihat [AI_SETUP.md](AI_SETUP.md#teks-ke-suara).
- **Alat kreatif lokal:** apakah Whisper, rembg, dan FFmpeg ditemukan (dengan *Atur lokasi* untuk Whisper dan rembg;
  FFmpeg harus ada di `PATH`).
- **Tentang:** versi, lisensi, dan tautan.

## Editor Foto

*Seperti Photoshop: layer, seleksi, retouch, dan filter untuk foto dan grafis.*

**Mulai.** Buka gambar (PNG, JPG, WebP, GIF, BMP, AVIF, ICO, SVG, atau PSD) atau tekan **Baru…** lalu pilih preset
(HD, 4K, A4 300 dpi, postingan Instagram, Story, thumbnail YouTube) atau ukuran sendiri dengan latar putih,
transparan, atau berwarna. Setiap dokumen yang terbuka mendapat tab sendiri.

**Alat** (huruf pintasan dalam kurung; Shift + huruf berganti di antara alat yang sejenis):
Pindah (V) · Marquee (M) · Laso (L) · Tongkat Ajaib (W) · Pangkas (C) · Pipet (I) · Kuas Penyembuh Noda (J) ·
Stempel Klon (S) · Kuas (B) / Pensil (Shift+B) · Penghapus (E) · Ember Cat (G) / Gradien (Shift+G) ·
Dodge / Burn / Spons (O) · Blur / Pertajam (R) · Teks (T) · Bentuk (U) · Tangan (H) · Zoom (Z).
Saat melukis: **[** / **]** ukuran kuas, **Shift+[** / **Shift+]** kekerasan, **1**…**0** opasitas 10–100%,
**X** menukar warna, **D** mengembalikan warna bawaan.

**Layer dan masker.** Panel *Layer* berisi mode campuran (17 mode), opasitas, tampil/sembunyi, kunci, seret untuk
mengurutkan, dan klik ganda untuk mengganti nama. Ctrl-klik thumbnail untuk menyeleksi piksel layer. Pilih
*Tambah Masker Layer*, lalu klik thumbnail masker dan lukis di atasnya: hitam menyembunyikan, putih menampilkan
(Shift-klik masker untuk mematikannya). *Properti → Efek layer*: bayangan jatuh, garis tepi, cahaya luar. Layer bisa
berupa piksel, teks, atau bentuk (belum ada grup atau layer penyesuaian).

**Seleksi.** Marquee (persegi/elips; Normal, Rasio tetap, Ukuran tetap), Laso (bebas atau poligonal — klik
titik-titik, klik ganda atau Enter untuk menutup), Tongkat Ajaib (Toleransi, Bersebelahan, Sampel semua layer).
Tahan Shift untuk menambah, Alt untuk mengurangi, Shift+Alt untuk irisan. Menu *Pilih*: Semua, Batalkan Pilihan
(Ctrl+Shift+A), Kebalikan (Ctrl+Shift+I), Haluskan Tepi, Perluas, Persempit.

**Penyesuaian dan filter.** *Gambar → Penyesuaian*: Kecerahan/Kontras, Levels (Ctrl+L), Kurva (Ctrl+M), Eksposur,
Vibrance, Rona/Saturasi (Ctrl+U), Keseimbangan Warna (Ctrl+B), Hitam & Putih, Filter Foto, Inversi, Posterisasi,
Ambang, Hilangkan Saturasi, serta Nada / Kontras / Warna Otomatis. *Filter*: Gaussian Blur, Motion Blur, Pertajam,
Unsharp Mask, Tambah Noise, Kurangi Noise, Emboss, Temukan Tepi, Cat Minyak, Pikselasi, Vinyet, Butiran Film,
High Pass. Setiap dialog punya *Pratinjau* langsung. Penyesuaian dan filter mengubah piksel layer aktif (di dalam
seleksi, jika ada), jadi duplikat layer dulu (Ctrl+D) bila ingin menyimpan aslinya.

**Pangkas dan transformasi.** Alat Pangkas: rasio siap pakai (1:1, 4:5, 16:9…) dan *Luruskan*; Enter menerapkan,
Esc mengembalikan. *Edit → Transformasi Bebas* (Ctrl+T): seret pegangan untuk mengubah ukuran, seret di luar kotak
untuk memutar (Shift: rasio bebas / langkah 15°, Alt: dari tengah), Enter menerapkan. Menu *Gambar*: Ukuran Gambar,
Ukuran Kanvas, Rotasi Gambar, Pangkas ke Seleksi.

**Retouch.** Kuas Penyembuh Noda: sapukan di atas noda dan jerawat. Stempel Klon: Alt-klik untuk memilih sumber,
lalu lukis. Dodge/Burn/Spons mencerahkan, menggelapkan, atau mengubah saturasi di area yang Anda sapu.

**Teks dan bentuk.** Alat Teks: klik lalu ketik; selesai dengan Esc, Ctrl+Enter, atau klik di luar; klik ganda teks
untuk mengeditnya lagi. Font, ukuran, ketebalan, warna, perataan, dan spasi ada di panel *Properti*. Alat Bentuk
menggambar bentuk yang tetap bisa diedit.

**AI.** Asisten bisa mengatur kecerahan, kontras, eksposur, suhu warna, saturasi, dan lainnya, menerapkan filter,
menambah teks, memangkas, mengubah ukuran, memutar, membalik, mengisi warna, menambah layer, memperbaiki otomatis,
dan menghapus latar belakang. Menu **AI** berisi:
- **Hapus Latar Belakang** — memakai alat gratis rembg (aplikasi desktop; lihat [AI_SETUP.md](AI_SETUP.md)). Tanpa
  rembg, Ultima menawarkan *Hapus Latar Polos* yang bekerja tanpa AI untuk latar berwarna rata.
- **Isi Generatif…** — seleksi sebuah area, lalu jelaskan apa yang harus muncul di sana (kosongkan untuk menghapus
  isinya). Butuh Stable Diffusion WebUI lokal.
- **Buat Gambar…** — membuat gambar dari deskripsi dengan generator yang dipilih di Pengaturan → Pembuatan gambar
  (Stable Diffusion, ComfyUI, server gambar lokal, Antigravity dengan paket Google AI Anda, Codex dengan paket ChatGPT
  Anda, atau gambar SVG oleh AI Anda). Hasilnya ditambahkan sebagai layer baru, atau terbuka sebagai dokumen baru.
- **Deskripsi / Teks Alt…** — menulis deskripsi gambar (butuh AI yang memahami gambar).
- **Perbaiki Otomatis** — nada dan vibrance otomatis (tanpa AI).

**File.** *Simpan Proyek* (Ctrl+S) menjaga layer, masker, teks, dan efek tetap bisa diedit. *Ekspor…* (Ctrl+E): PNG,
JPG, atau WebP (kualitas dan skala) atau PSD (layer, masker, mode campuran, dan visibilitas dipertahankan; teks dan
bentuk dirasterisasi). File PSD terbuka lengkap dengan layernya (grup diratakan, layer penyesuaian dibuang).

**Perlu diketahui.** Delete tanpa seleksi menghapus layer aktif (Ctrl+Z mengembalikannya). Ukuran gambar maksimal
16.000 px per sisi. Foto HEIC belum didukung — ekspor dulu sebagai JPEG.

## Olah Foto

*Seperti Lightroom: edit non-destruktif, preset, dan ekspor massal untuk satu sesi pemotretan.*

**Mulai.** Seret foto ke jendela atau tekan **Impor Foto…** (Ctrl+O): JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, dan file
RAW kamera. Hasil edit disimpan sebagai pengaturan; file asli tidak pernah diubah. Ada dua tampilan: **Pustaka** (G)
dan **Olah** (D). File JPEG dan PNG yang dibuka dari Beranda masuk ke Editor Foto — untuk mengolahnya, pakai Impor
di sini.

**Pustaka.** Beri rating dengan **0**–**5**, label warna dengan **6**–**9**, **P** pilih, **X** tolak, **U** hapus
bendera. Bilah filter mencari dan menyaring menurut rating, bendera, label, atau status edit; daftar *Katalog* di kiri
berisi Semua foto, Dipilih, Ditolak, Belum dirating, 3 bintang ke atas, dan Diedit. *Olah Cepat* di kanan menerapkan
preset, langkah eksposur, Nada Otomatis, dan White Balance Otomatis ke semua foto terpilih. Enter membuka foto di Olah.

**Panel Olah.** Histogram · **Dasar** (Warna atau Hitam & Putih, white balance dengan pipet **W**, Eksposur, Kontras,
Highlight, Bayangan, Putih, Hitam, Tekstur, Kejernihan, Hapus Kabut, Vibrance, Saturasi) · **Kurva Nada** ·
**HSL / Warna** (delapan rentang warna) · **Gradasi Warna** (bayangan, nada tengah, highlight) · **Detail**
(penajaman, pengurangan noise) · **Efek** (vinyet, butiran) · **Transformasi & Potong** (**R**: rasio, meluruskan,
garis bantu). Klik ganda nama slider untuk mengembalikannya, atau ketik nilainya; ↺ mengembalikan satu bagian.

**Membandingkan.** **\\** beralih *Sebelum / Sesudah*, **Y** *Bandingkan Terbelah* dengan pembatas yang bisa digeser,
**J** *Tampilkan Clipping* (highlight terpotong merah, bayangan terpotong biru). **Z** atau klik berganti antara pas
layar dan 100%. **←**/**→** pindah ke foto sebelumnya/berikutnya.

**Preset.** 17 tampilan bawaan (Cerah Hidup, Potret Lembut, Film Hangat, Sinematik Teal & Oranye, H&P Klasik,
Sepia…): arahkan kursor untuk pratinjau, klik untuk menerapkan, **+** menyimpan pengaturan Anda sebagai preset sendiri.

**Banyak foto sekaligus.** Pilih foto di Pustaka, lalu *Salin Pengaturan…* (Ctrl+Shift+C) dan *Tempel Pengaturan*
(Ctrl+Shift+V), atau *Selaraskan Pengaturan…* lalu centang grup yang ingin disalin. *Buat Salinan Virtual* (Ctrl+D)
membuat versi lain dari foto yang sama dengan editnya sendiri.

**AI.** Asisten bisa mengatur atau menggeser slider, mengubah kurva nada, menerapkan preset, Nada Otomatis / White
Balance Otomatis, memotong, meluruskan, memutar, mengembalikan pengaturan, dan memberi rating — tambahkan *“untuk semua
foto terpilih”* agar diterapkan ke pilihan Anda. Menu *AI*: **Edit Otomatis AI untuk yang Dipilih…**, **Jelaskan Sebuah
Tampilan…** (mengubah *“nuansa film yang muram dengan hitam pudar”* menjadi pengaturan, yang bisa disimpan sebagai
preset), dan **Sarankan Rating…** (butuh AI yang memahami gambar; Anda meninjau sarannya sebelum diterapkan).

**Ekspor** (Ctrl+E): JPEG, PNG, atau WebP; kualitas; ukuran penuh atau diperkecil menurut sisi panjang, sisi pendek,
atau megapiksel; templat nama file ({name}, {n}, {date}, {rating}, {width}, {height}); *Pertahankan data EXIF kamera*
(JPEG). Beberapa foto disimpan bersama dalam satu ZIP.

**Katalog.** *Simpan Katalog* (Ctrl+S) menyimpan rating dan edit Anda dalam file `.ultima`. Jika total foto 300 MB atau
kurang, foto bisa disematkan di dalamnya; jika tidak, biarkan file asli di tempatnya — file yang dipindahkan tampil
sebagai *Hilang* sampai Anda memakai *Cari File yang Hilang…*.

**Perlu diketahui.** Untuk file RAW, Ultima memakai pratinjau JPEG ukuran penuh yang disimpan kamera di dalam file
(pemrosesan RAW sesungguhnya belum tersedia). HEIC/HEIF belum didukung — ekspor dulu sebagai JPEG (iPhone: Pengaturan →
Kamera → Format → Paling Kompatibel). Olah Foto butuh WebGL 2 (didukung driver grafis beberapa tahun terakhir).
Penyesuaian berlaku untuk seluruh foto; untuk retouch area tertentu pakai Editor Foto.

## Desain Vektor

*Seperti Illustrator: logo, ikon, dan ilustrasi dari bentuk dan path.*

**Mulai.** Terbuka dengan artboard 1080 × 1080. *Baru…* (Ctrl+N) menawarkan A4, Letter, 1080 × 1080, 1920 × 1080,
Logo 512 × 512, Ikon 24 × 24, kartu nama, atau ukuran sendiri, dengan latar putih, transparan, atau berwarna.

**Alat:** Seleksi (V) · Seleksi Langsung (A) · Pena (P) · Pensil (N) · Persegi panjang (M) · Elips (L) · Poligon ·
Bintang · Garis (\\) · Teks (T) · Pipet (I) · Tangan (H) · Zoom (Z). **X** berganti antara isian dan stroke,
**Shift+X** menukar keduanya, **D** mengembalikan bawaan, **/** mengosongkannya (None). Tombol panah menggeser 1 px
(Shift: 10 px).

**Menggambar.**
- Bentuk: tahan Shift untuk persegi atau lingkaran, Alt untuk menggambar dari tengah; satu klik membuat bentuk
  100 × 100.
- Pena: klik untuk sudut, seret untuk lengkung, klik titik pertama untuk menutup path; Enter atau Esc untuk selesai;
  Shift mengunci ke kelipatan 45°. Saat path terpilih, klik segmen untuk menambah titik atau klik titik untuk
  menghapusnya.
- Seleksi Langsung: seret titik dan pegangan, pakai tombol Sudut / Halus, klik ganda segmen untuk menambah titik.
  Bentuk berubah menjadi path saat titiknya diedit.
- Klik ganda grup untuk bekerja di dalamnya (Esc untuk keluar); klik ganda teks untuk mengeditnya.

**Warna dan tampilan** (panel *Properti*): isian dan stroke berupa warna solid atau gradien linear/radial (klik bilah
gradien untuk menambah titik warna), lebar stroke, garis putus-putus, ujung, sambungan, dan posisi stroke, opasitas,
16 mode campuran, bayangan, dan blur. Tab *Swatch* menyimpan warna-warna dokumen.

**Menyusun.** Menu *Objek*: Grup (Ctrl+G), Susun (Ctrl+[ dan Ctrl+]), Ratakan dan Distribusikan (terhadap pilihan atau
artboard), balik dan putar, Kunci (Ctrl+2), Sembunyikan (Ctrl+3), Ubah menjadi path, Garis luar stroke, Taruh teks di
path. *Pathfinder*: Satukan, Kurangi depan, Irisan, Kecualikan. Tab *Layer* mengurutkan, mengelompokkan,
menyembunyikan, dan mengunci objek; tab *Artboard* menambah, menduplikat, mengganti nama, dan menghapus artboard.
Menu *Tampilan*: grid, tempel ke grid, panduan pintar, mode garis luar.

**AI.** Asisten bisa menambah dan mengubah bentuk, path, dan teks, mewarnai ulang, meratakan, mengelompokkan,
menyisipkan karya SVG, dan mengubah ukuran artboard. Menu *AI*: **Buat karya seni…** (jelaskan lalu pilih gaya),
**Ide logo…** (empat konsep logo untuk sebuah nama merek), **Warnai ulang karya…** (saran palet), dan **Namai layer**.

**File.** *Simpan* (Ctrl+S) sebagai `.ultima`. *Tempatkan SVG atau gambar…*, seret dan lepas, atau tempel kode SVG.
*Ekspor…* (Ctrl+E): SVG, PNG, JPG (1×/2×/4×, latar transparan), atau PDF (satu halaman per artboard) — artboard saat
ini, semua artboard (ZIP untuk PNG/JPG/SVG), atau hanya pilihan (SVG).

**Perlu diketahui.** Teks belum bisa diubah menjadi outline, dan teks berupa teks titik (Enter untuk baris baru; belum
ada kotak teks yang membungkus otomatis). Ekspor SVG menyimpan teks sebagai teks hidup, jadi font-nya harus terpasang
di tempat SVG itu dipakai. Fitur SVG yang tidak bisa diedit Ultima (mask, filter, pola) diimpor sebagai *Konten SVG*
yang tetap. Aplikasi desktop mengekspor PDF vektor; versi browser mengekspor halaman PDF sebagai gambar.

## Tata Letak & Publikasi

*Seperti InDesign dan Adobe Express: poster, flyer, postingan media sosial, dokumen, dan PDF siap cetak.*

**Mulai.** *Apa yang ingin Anda buat?* menawarkan format kosong (A4, Letter, postingan dan story Instagram, presentasi
16:9, thumbnail YouTube, kartu nama, poster) dan 15 templat: Poster acara, Flyer diskon, Postingan Instagram, Story
Instagram, Thumbnail YouTube, Kartu nama, Resume / CV, Buletin, Undangan, Sertifikat, Menu restoran, Slide presentasi,
Flyer open house, Sampul Facebook, dan Banner LinkedIn. Ctrl+N membuka pemilih templat lagi; *Dokumen kosong baru…*
mengatur ukuran, satuan, jumlah halaman, kolom, margin, bleed, dan halaman berhadapan.

**Alat:** Pilih (V) · Bingkai teks (T) · Bingkai gambar (F) · Persegi panjang (R) · Elips (E) · Garis (L) · Tabel ·
Tangan (H, atau tahan Spasi). Enter mengedit bingkai teks terpilih; tombol panah menggeser.

**Teks.** Klik ganda bingkai teks (atau tekan Enter) untuk mengetik. Gaya paragraf ada di tab *Gaya* (Title, Subtitle,
Heading 1 dan 2, Body, Caption, Quote, Label — nama gaya bawaan tampil dalam bahasa Inggris): klik untuk menerapkan;
jika bingkai berbeda dari gayanya, *Diubah* menawarkan *Atur ulang* dan *Perbarui gaya*. Tab *Desain* mengatur font,
ketebalan, ukuran, tebal/miring/garis bawah/huruf kapital, perataan, jarak baris, tracking, dan jarak setelah paragraf,
serta kolom, inset, perataan vertikal, isi, dan garis tepi bingkai. Format berlaku untuk seluruh bingkai (belum bisa
mencampur beberapa format dalam satu bingkai).

**Teks yang tidak muat.** Tanda **+** di bingkai dan *“1 bingkai teks meluap”* di status bar menandakan ada teks yang
tersembunyi. Perbesar bingkainya, atau tekan **Tautkan** (atau *Objek → Lanjutkan teks di bingkai lain…*) lalu klik
bingkai yang harus melanjutkan teksnya; **Tambah bingkai** membuat bingkai baru (di halaman berikutnya bila perlu).
Untuk nomor halaman ketik `{page}` atau `{pages}`.

**Halaman.** Strip halaman di bawah untuk menambah, menduplikat, menghapus, dan mengurutkan halaman (PgUp/PgDn untuk
berpindah). **Halaman master** (*Halaman → Edit halaman master*) berisi elemen yang muncul di setiap halaman, misalnya
footer dengan `{page}`. Menu *Tampilan* berganti antara *Satu halaman* dan *Gulir bersambung* serta menampilkan
panduan, margin, penggaris (seret dari penggaris untuk membuat garis panduan), dan area bleed.

**Gambar dan bentuk.** Gambar bingkai gambar (F) untuk memilih foto, atau seret/tempel gambar ke halaman. Pilihan muat:
Isi bingkai (potong), Muat di dalam bingkai, Regangkan, Ukuran asli; atur zoom dan posisi gambar, atau tekan *Atur* lalu
seret gambar di dalam bingkainya. Bentuk bisa diubah menjadi segitiga, belah ketupat, atau bintang dan diberi isian
gradien. Tabel punya baris judul, warna baris selang-seling, dan garis.

**Warna tema.** Tab *Gaya* punya enam warna tema (Teks, Latar belakang, Utama, Sekunder, Netral, Sorotan) dan palet
siap pakai (Samudra, Senja, Hutan, Kopi…). Warna yang dipilih dari tema ikut berubah saat tema diubah.

**AI.** **Desain AI** di header (*AI → Desain dari brief…*): jelaskan kebutuhan Anda (*“poster malam jazz tanggal 12
Mei, gelap dan elegan”*) lalu pilih halaman baru, halaman saat ini, atau dokumen baru. **Tulis ulang teks terpilih…**
(persingkat, lebih formal, lebih menarik, terjemahkan EN ↔ ID, perbaiki tata bahasa, perpanjang) dan **Buat teks
iklan…** (judul, subjudul, isi, dan ajakan bertindak). Asisten bisa menambah dan mengubah bingkai, teks, bentuk,
halaman, latar, warna tema, dan gaya paragraf. AI membuat tempat untuk gambar; AI tidak membuat foto.

**Ekspor** (Ctrl+E): PDF (semua halaman, halaman saat ini, atau rentang seperti `1-3, 5`; bleed dan tanda potong), PNG
atau JPG (72–600 dpi, atau skala untuk dokumen berbasis piksel; beberapa halaman menjadi ZIP), atau Cetak. Aplikasi
desktop membuat PDF vektor dengan teks yang bisa diseleksi; versi browser membuat halaman PDF dari gambar.

**Perlu diketahui.** Font tidak disimpan di dalam proyek; jika font tidak ada di komputer lain, dipakai font yang mirip.
Bingkai yang dikunci atau disembunyikan dipilih lewat tab *Layer*. Gambar disimpan di dalam file `.ultima` (gambar yang
sangat besar diperkecil menjadi 6000 px).

## Editor Video

*Seperti Premiere Pro: memotong, memberi judul dan subtitle, lalu mengekspor video.*

**Mulai.** *Impor media…* atau seret file: video (MP4, WebM, MOV, MKV, M4V, OGV, AVI, 3GP), audio, gambar, dan subtitle
SRT/VTT. Klik ganda file di tab *Media* untuk menyisipkannya di playhead, atau seret ke timeline. *Proyek baru* (Ctrl+N)
dan *Pengaturan proyek…*: 1080p, 720p, 4K, Vertikal 9:16, Persegi 1:1, atau ukuran sendiri, 24–60 fps, warna latar.
Jika Anda belum memilih ukuran, video pertama yang ditambahkan menentukannya.

**Timeline.**
- *Alat seleksi* (V) dan *Alat pisau* (C). **S** (atau Ctrl+K) membelah di playhead, **Shift+Delete** menghapus dan
  merapatkan, **N** menyalakan/mematikan snapping, **M** menambah penanda, **I**/**O** mengatur titik masuk dan keluar.
- Seret klip untuk memindahkannya (klip menimpa apa pun di tempat tujuannya), seret tepinya untuk memangkas. Shift- atau
  Ctrl-klik menambah ke pilihan; seret di area kosong untuk memilih dengan kotak. *Tautkan klip* / *Lepas tautan klip*
  menjaga video dan suaranya tetap bersama.
- *+ Trek* menambah trek video, audio, dan subtitle; kepala trek bisa menyembunyikan, membisukan, solo, dan mengunci trek.
- Pemutaran: **Spasi** putar/jeda, **J**/**K**/**L** mundur/berhenti/maju (tekan lagi untuk 2×, 4×, 8×), **←**/**→**
  satu frame (Shift: satu detik), **↑**/**↓** potongan sebelumnya/berikutnya, Home/End.
- Zoom: Ctrl+roda mouse atau Ctrl+= / Ctrl+- di timeline, **Ctrl+0** memaskan seluruh timeline. Pratinjau punya menu
  Pas/25/50/100%; **Ctrl+1** beralih ke 100%.

**Inspektor** (pilih klip): mulai dan durasi; *Transformasi* (posisi, skala, rotasi, opasitas, crop — atau seret klip di
pratinjau); *Kecepatan* 0,25–4× dengan *Pertahankan nada audio*; volume dan fade audio; *Fade opasitas*; *Transisi masuk*
(Cross dissolve, Celup ke hitam/putih, Sapu ke kiri/kanan, Geser, Zoom); *Warna & buram* (kecerahan, kontras, saturasi,
suhu, rona, blur); *Chroma key (layar hijau)* untuk layar hijau atau biru.

**Judul dan subtitle.** Tab *Judul*: Judul dasar, Lower third, Besar tebal, Teks bawah, Mesin tik, Label pop, dan Kartu
penutup — klik atau seret ke timeline, lalu ubah teks, font, warna, garis tepi, latar, dan animasinya (Fade, Geser ke
atas, Pop, Mesin tik). Tab *Subtitle*: tambah subtitle manual, impor atau ekspor SRT/VTT, atur *Gaya subtitle*, atau buat
otomatis dengan **Subtitle otomatis…**.

**AI.** Menu *Alat AI*:
- **Subtitle otomatis…** — mentranskripsi ucapan dengan Whisper di komputer Anda sendiri (aplikasi desktop), dalam
  banyak bahasa.
- **Hapus jeda hening…** — menemukan jeda (ambang, panjang minimum, sisa jarak), menandainya merah, lalu menghapusnya di
  semua trek yang tidak dikunci (ini analisis audio, tidak butuh AI).
- **Tulis judul & deskripsi…** — judul YouTube, deskripsi, chapter (bisa ditambahkan sebagai penanda), dan tag.
- **Rough cut dari transkrip…** — menyarankan potongan berdasarkan subtitle.
- **Sulih suara dari teks…** — ketik naskah, pilih suara, dengarkan, lalu *Tambah ke timeline*: suaranya ditempatkan
  di playhead pada trek audio yang kosong, jadi tidak memotong suara yang sudah ada (aplikasi desktop; lihat [Teks ke suara](AI_SETUP.md#teks-ke-suara)).

Asisten bisa menambah judul dan subtitle, membelah, memangkas, memindahkan, dan menghapus klip, mengubah properti klip,
menambah transisi dan penanda, serta mengubah format proyek.

**Ekspor** (Ctrl+E): MP4 (H.264 + AAC) atau WebM (VP9 + Opus) untuk seluruh timeline atau area kerja, dengan resolusi,
frame rate, kualitas atau bitrate, audio, dan *Tanamkan subtitle ke gambar*; *MP4/MOV lewat FFmpeg* (aplikasi desktop
dengan FFmpeg); GIF (hingga 60 detik); audio WAV; atau frame saat ini sebagai PNG. Encoder yang tersedia tergantung
komputer Anda; WebM selalu bisa. Indeks file MP4 diletakkan di awal (fast start).

**TikTok · Reels · Shorts** (*File → Ekspor untuk TikTok · Reels · Shorts…*): TikTok, Instagram, dan YouTube selalu
meng-encode ulang setiap unggahan — tidak ada aplikasi atau file yang bisa mematikannya. Ekspor ini memberi mereka sumber
paling bersih agar kompresi mereka membuang sesedikit mungkin: 1080 px di sisi pendek (1080×1920 untuk proyek 9:16),
30 atau 60 fps konstan, H.264 High 16 atau 24 Mbps, AAC 320 kbps, dan warna BT.709. Jika sistem tidak punya encoder AAC
(Linux), aplikasi desktop menulis MP4 akhirnya dengan FFmpeg. Pilih 60 fps untuk rekaman 60 fps (atur proyek ke 60 fps
juga); klip yang direkam 30 fps tetap 30. Saat mengunggah: nyalakan *Allow high-quality uploads* di *Opsi lainnya*
TikTok, unggah lewat Wi-Fi dengan Penghemat Data mati, selesaikan teks dan efek di Ultima (editan di dalam aplikasi
TikTok dirender ulang di sana), dan unggah file apa adanya, jangan dikirim lewat aplikasi chat dulu. File besar yang
ditolak aplikasi ponsel bisa diunggah dari komputer lewat tiktok.com.

**Proyek.** *Simpan proyek* (Ctrl+S) menyimpan hasil edit, bukan file medianya — biarkan media Anda di tempatnya. Jika
file dipindahkan, *Tautkan ulang media yang hilang…* mencarinya berdasarkan nama.

**Perlu diketahui.** File yang tidak bisa dipratinjau sistem Anda tampil *Tanpa pratinjau*; klik kanan → *Konversi dengan
FFmpeg* (aplikasi desktop). Subtitle ditanam ke gambar atau diekspor sebagai file SRT/VTT (tidak ada trek subtitle di
dalam MP4). Untuk animasi keyframe pakai Motion Grafis.

## Motion Grafis

*Seperti After Effects: menganimasikan teks, bentuk, gambar, dan video dengan keyframe.*

**Mulai.** Komposisi 1920 × 1080, 30 fps, 5 detik. *Komposisi baru…* (Ctrl+N) dan *Pengaturan komposisi…*: HD 1080p, 4K,
persegi, story vertikal, GIF 480, atau ukuran sendiri; frame rate; durasi; warna latar atau transparan.

**Alat:** Seleksi (V) · Titik jangkar (Y) · Tangan (H) · Teks (T) · Persegi panjang (R) · Elips (E) · Poligon · Bintang ·
Garis (L) · Pena (P: klik untuk sudut, seret untuk lengkung, Enter untuk selesai) · Impor gambar, video, atau SVG… · Null
baru (untuk mengelompokkan dan menjadi induk layer). *Layer → Baru* juga bisa menambah solid.

**Keyframe.** Pilih layer, klik **stopwatch** di samping sebuah properti (di timeline atau panel *Properti*), pindahkan
playhead lalu ubah nilainya — Ultima menambah keyframe. Yang bisa dianimasikan: titik jangkar, posisi, skala, rotasi,
opasitas, ukuran, warna isi dan garis, lebar garis, radius sudut, trim path, tracking, munculkan teks, dan blur. **U**
hanya menampilkan properti beranimasi, **J**/**K** lompat ke keyframe sebelumnya/berikutnya, **F9** menerapkan Easy ease.
Klik kanan keyframe untuk memilih easing (Linear, Ease In, Ease Out, Ease In-Out, Tahan, Back, Elastis, Pantul), atau
klik ganda untuk mengedit kurvanya.

**Pemutaran dan waktu.** Ketuk **Spasi** untuk putar/jeda (tahan Spasi dan seret untuk menggeser kanvas), **←**/**→**
satu frame (Shift: 10 frame), Home/End. Seret bilah layer untuk memindahkannya di waktu dan ujungnya untuk memangkas
(atau **Alt+[** / **Alt+]** di playhead). **I**/**O** lompat ke awal/akhir layer, **B**/**N** mengatur area kerja. Kolom
waktu menerima detik, frame (`45f`), atau `mm:ss:ff`.

**Preset** (tab *Preset* atau klik kanan): Muncul Pudar / Hilang Pudar, Geser Masuk dari empat arah, Muncul Membesar,
Masuk Memantul, Masuk Berputar, Mesin Tik dan Kata demi Kata (teks), Wiggle, Denyut, Melayang, Guncang, dan Gambar Garis
(bentuk). Preset dimulai di playhead.

**Teks, bentuk, dan efek.** Teks: font, ukuran, ketebalan, isi, garis, tracking, dan *Munculkan Teks* per karakter, kata,
atau baris. Bentuk: ukuran, radius sudut, jumlah titik, garis, Trim Path. Efek: blur, bayangan, pendar; 17 mode campuran;
layer bisa dijadikan anak dari layer lain atau dari null.

**AI.** **Animasikan dengan AI** (*Animasi → Animasikan dari deskripsi…*): jelaskan adegannya (*“logo muncul membesar,
lalu tagline muncul huruf demi huruf”*) dan AI membuat layer serta keyframe-nya — satu kali Undo menghapus semuanya.
**Sarankan easing & timing** merapikan gerakan sebuah layer. Asisten bisa mengubah komposisi, menambah layer, mengatur
properti dan keyframe, menerapkan preset, dan mengubah easing.

**Ekspor** (Ctrl+E): MP4, WebM, GIF animasi (dithering, loop), urutan PNG (ZIP), atau frame saat ini; seluruh komposisi
atau area kerja; ukuran, frame rate, dan kualitas. Transparansi dipertahankan di WebM, PNG, dan GIF.

**Perlu diketahui.** Motion grafis tidak bersuara — tambahkan musik di Editor Video. Gambar dan video disimpan di dalam
proyek (video hingga 400 MB). Beberapa tombol berbeda dari Editor Video: J/K lompat antar keyframe dan L adalah alat
Garis.

## Editor Audio

*Seperti Audition: membersihkan, mengedit, dan me-mix suara serta musik.*

**Mulai.** *Buka file…* (WAV, MP3, OGG, FLAC, M4A, AAC, Opus, WebM, atau suara dari file video), *Rekam…*, atau *Buat
nada…*. **Buat → Suara dari teks…** membacakan teks dengan suara dari Pengaturan → Suara lalu menyisipkannya di
kursor (atau menggantikan seleksi; di Multitrack menjadi trek baru di playhead). *File audio baru…* (Ctrl+N) menanyakan sample rate dan mono/stereo. Dua tampilan: **Waveform** (mengedit satu
file) dan **Multitrack** (menyusun klip di beberapa trek).

**Mengedit (Waveform).** Seret untuk menyeleksi, klik untuk menaruh kursor, Shift+klik untuk memperluas. **Spasi**
putar/jeda (Shift+Spasi mengabaikan seleksi), **L** putar berulang, **Esc** berhenti. Potong, salin, tempel, *Tempel
campur* (Ctrl+Shift+V), hapus, *Pangkas ke seleksi*, *Heningkan seleksi*, *Sisipkan hening…*. Penanda: **M** menambah,
**[** / **]** lompat antar penanda, klik ganda penggaris untuk menambah atau mengganti nama. Zoom: Ctrl+roda mouse
(waktu), Alt+roda mouse (tinggi gelombang), **Ctrl+0** seluruh file, **Ctrl+1** perbesar ke seleksi; roda mouse
menggulir.

**Efek** (menu atau panel *Efek*; masing-masing punya *Pratinjau* dan bisa diterapkan ke seleksi atau seluruh file):
Perkuat (Amplify), Normalisasi (puncak atau kenyaringan LUFS), Fade In/Out, EQ Parametrik (preset seperti *Kejernihan
suara* dan *Hapus dengung*), filter high-pass dan low-pass, Kompresor, Hard Limiter, Noise Gate, Balik arah, Ubah
Kecepatan, Geser Nada, Reverb, Gema / Delay, alat kanal, dan Hapus DC Offset.

**Membersihkan rekaman.**
1. **Bersihkan Suara Otomatis…** menjalankan filter high-pass, pengurangan noise, kompresi, dan normalisasi sekaligus.
2. Untuk noise yang membandel: seleksi setengah detik noise murni, *Ambil sidik noise* (Shift+P), lalu *Pengurangan
   Noise…*.
3. **Hapus bagian hening…** memendekkan jeda panjang (ambang, panjang minimum, sisa jarak).

Panel *Statistik* menampilkan puncak, RMS, dan kenyaringan (LUFS); *Tampilan → Tampilan frekuensi spektral*
memperlihatkan noise dan dengung.

**Merekam.** *Rekam…* memilih mikrofon dan apakah rekaman disisipkan di kursor atau dibuat sebagai file baru. Izinkan
akses mikrofon saat sistem memintanya.

**Multitrack.** Tambah trek, impor file atau waveform yang sedang dibuka, seret klip untuk memindahkan dan tepinya untuk
memangkas, **S** membelah di playhead. Setiap trek punya volume, pan, bisu, dan solo; klip bisa diberi fade in dan fade
out. *Ekspor mix…* atau *Mixdown ke file baru*.

**Transkrip dan AI.** *AI → Transkripsi* (Whisper di komputer Anda sendiri, aplikasi desktop) mengisi panel *Transkrip*:
klik segmen untuk memutarnya, hapus kata lalu tekan *Terapkan potongan* untuk membuang audionya, dan ekspor transkrip
sebagai TXT, SRT, atau VTT. *Ringkas transkrip* dan *Tulis catatan acara* memakai AI yang terhubung. Asisten bisa
menyeleksi rentang, menerapkan efek, memangkas, menghapus, memberi fade, menormalkan (*“buat jadi −16 LUFS untuk
podcast”*), menambah penanda, dan menjalankan Bersihkan Suara Otomatis.

**Ekspor** (Ctrl+E): WAV (16-bit, 24-bit, atau 32-bit float), MP3, FLAC, OGG/Opus, WebM/Opus, atau M4A/AAC dengan sample
rate, kanal, dan bitrate; seluruh file, seleksi, atau mix multitrack. MP3 dan FLAC butuh aplikasi desktop dengan FFmpeg.
Penanda bisa diekspor sebagai teks, CSV, atau chapter YouTube.

**Proyek.** *Simpan proyek* (Ctrl+S) menyimpan audio, penanda, transkrip, dan sesi multitrack dalam file `.ultima`. File
audio asli Anda tidak pernah ditimpa — pakai Ekspor untuk membuat WAV atau MP3.

## Studio PDF

*Seperti Acrobat: membaca, mengatur, memberi anotasi, menandatangani, mengisi, dan menyensor PDF.*

**Mulai.** *Buka PDF…* (juga gambar dan proyek `.ultima`), *Gabungkan file…*, *Gambar ke PDF…*, atau *PDF kosong baru*.
Saat membuka beberapa file, Anda bisa menggabungkannya, menambahkannya di akhir, menyisipkannya setelah halaman saat ini,
atau membukanya sebagai dokumen baru. PDF yang dilindungi kata sandi akan meminta kata sandinya.

**Membaca.** Thumbnail halaman dan penanda (bookmark) di kiri; *Cari…* (Ctrl+F) dengan pilihan huruf besar/kecil dan kata
utuh; zoom dengan Ctrl+roda mouse, *Pas lebar* (Ctrl+0), *Ukuran sebenarnya* (Ctrl+1); geser dengan Spasi+seret atau
alat Tangan; PgUp/PgDn.

**Anotasi** (dalam mode *Lihat & Edit*): Pilih (V) · Tangan (H) · Tambah teks (T) · Gambar bebas (D) · Sorot (Y) ·
Garis bawah (U) · Coret (K) · Persegi (R) · Elips (O) · Garis (L) · Panah (A) · Gambar (I) · Stempel (S: DISETUJUI, DRAF,
RAHASIA, LUNAS, SALINAN, atau teks sendiri) · Tanda tangan (G) · Tanggal · Catatan (N) · Penutup putih (W) · Sensor (X).
Seleksi teks untuk menyorot, menggarisbawahi, atau mencoretnya, atau untuk *Tandai untuk disensor*. Tab *Edit* di kanan
mengubah warna, font, ukuran, garis tepi, dan opasitas.

**Tanda tangan.** Tanda tangan (G): gambar, ketik (empat gaya tulisan tangan), atau unggah foto tanda tangan Anda; Ultima
bisa mengingat hingga 8. Tanda tangan ditempatkan sebagai gambar (tanda tangan digital bersertifikat belum didukung).

**Formulir.** Isi kolom teks, kotak centang, tombol radio, dan daftar langsung di halaman atau di tab *Formulir*; pilih
*Ratakan formulir saat menyimpan* agar jawaban menyatu dengan halaman.

**Halaman.** Mode *Atur* menampilkan semua halaman: seret untuk mengurutkan, putar, duplikat, hapus, sisipkan halaman
kosong, PDF lain, atau gambar, dan ekstrak halaman. *Pisahkan dokumen…* memecah setiap N halaman atau menurut rentang
(`1-3, 4-6, 7-`). *Gabungkan file…* menambahkan PDF di bagian akhir.

**Sensor.** Tandai area dengan alat Sensor (X), teks terpilih dengan *Tandai untuk disensor*, atau setiap kemunculan sebuah
kata. *Terapkan sensor…* benar-benar menghapus isinya: halaman yang terkena menjadi gambar dengan kotak hitam. Penutup
putih hanya menutupi — teks di bawahnya tetap ada di dalam file.

**AI.** Tab dan menu *AI*: **Ringkas dokumen** (dengan tautan ke halaman), **Tanya PDF ini** (obrolan yang menyebut halaman
sumbernya), **Terjemahkan halaman…**, **Ekstrak data penting…** (disimpan sebagai JSON atau CSV), dan **Isi formulir
dengan AI…** (Anda memeriksa nilainya sebelum diisikan). Asisten bisa pindah halaman, memutar, menghapus, dan mengekstrak
halaman, menambah kotak teks, menyorot frasa, mengisi kolom formulir, dan mengatur properti dokumen.

**Menyimpan.** *Simpan PDF* (Ctrl+S) menulis PDF biasa lengkap dengan anotasi, tanda tangan, perubahan halaman, dan isian
formulir. *Simpan proyek (.ultima)…* menjaga anotasi tetap bisa diedit nanti. Anda juga bisa mengekspor halaman sebagai
gambar (PNG/JPG, 72–600 DPI), mengekstrak semua teks, atau mencetak.

**Perlu diketahui.** PDF hasil scan tanpa lapisan teks tidak bisa dicari atau dibaca AI (belum ada pengenalan teks/OCR).
PDF yang dilindungi kata sandi disimpan tanpa kata sandinya. Teks asli di dalam PDF tidak bisa diedit langsung — tutupi
dengan Penutup putih lalu tambahkan teks baru. Watermark, penomoran halaman, kompresi, dan enkripsi belum tersedia.

## Studio Warna

*Seperti Adobe Color: palet, harmoni, gradien, dan pemeriksaan aksesibilitas.*

Header berganti di antara lima tampilan:

- **Roda:** pilih harmoni (Analog, Monokromatik, Triad, Komplementer, Komplementer terpisah, Persegi, Gabungan, Gradasi
  gelap-terang, atau Kustom) lalu seret penanda di roda (roda artistik RYB atau RGB); atur *Jarak*-nya. Kunci swatch
  (**L**) agar tidak berubah, **B** menjadikan swatch terpilih sebagai warna dasar, **←**/**→** memilih swatch. Setiap
  swatch menampilkan nilai HEX/RGB/HSB/HSL/CMYK/LAB yang bisa disalin.
- **Ekstrak:** buka foto dan Ultima memilih 2–10 warna dengan suasana tertentu (Seimbang, Berwarna-warni, Cerah, Lembut,
  Pekat, Gelap). Seret lingkaran di foto, atau klik foto untuk memilih ulang warna terpilih.
- **Gradien:** linear, radial, atau kerucut, titik warna dari palet, campuran sRGB atau OKLab; salin CSS atau ekspor
  PNG/SVG.
- **Aksesibilitas:** pemeriksa kontras (WCAG AA/AAA, APCA opsional) dengan perbaikan sekali klik, kisi kontras untuk
  seluruh palet, *Perbaiki pasangan teks otomatis*, dan simulasi buta warna (protanopia, deuteranopia, tritanopia,
  akromatopsia).
- **Pustaka:** palet yang Anda simpan; cari menurut nama, tag, atau kode hex; *Impor…* menambahkan file palet ke pustaka.

**Alat palet AI** (panel kanan): **Palet dari deskripsi** (*“spa yang tenang, hijau sage dan pasir”*), **Beri nama warna
saya**, dan **Buat aksesibel**. Asisten bisa mengganti atau mengubah warna, mengatur harmoni dan warna dasar, mengedit
gradien, serta memberi nama, tag, mengunci, dan mengurutkan palet.

**Pakai palet di alat lain.** *Gunakan di…* → Vektor (swatch), Layout (warna tema), atau Motion (mewarnai ulang layer).

**File.** *Simpan* menyimpan file `.ultima`. *Ekspor…*: variabel CSS, SCSS, JSON, Tailwind, Adobe Swatch Exchange
(`.ase`), palet GIMP/Inkscape (`.gpl`), atau gambar contoh warna PNG. Ultima membuka file `.ase`, `.gpl`, JSON, dan
CSS/teks (hingga 12 warna).

## Studio AI

*Mengobrol dengan AI yang sudah Anda bayar — atau model lokal gratis — lalu mengirim hasilnya ke alat lain.*

**Obrolan.** Pilih persona (Asisten kreatif, Copywriter kreatif, Pengelola media sosial, Penulis naskah video, Penerjemah
EN↔ID, Teman brainstorming, Ilustrator SVG, Perancang prompt gambar, Pelatih edit foto, atau buatan sendiri), AI, dan
modelnya di toolbar. Lampirkan gambar atau file teks lewat ikon penjepit kertas, dengan menempel, atau dengan menyeretnya.
Setiap jawaban punya Salin, Buat ulang, *Edit & kirim ulang*, dan **Kirim ke…** (Desain Vektor, Studio Warna, Layout,
Motion, Video). Gambar SVG di dalam jawaban mendapat pratinjau dengan *Buka di Vektor* dan *Simpan SVG*; kode warna menjadi chip
yang bisa dibuka di Studio Warna. Obrolan tersimpan otomatis; Anda bisa menyematkan, mengganti nama, mencari, dan
mengekspornya (Markdown atau `.ultima`).

**Pustaka prompt.** 24 prompt siap pakai untuk caption, metadata YouTube, teks iklan, naskah, slogan, terjemahan, koreksi
tulisan, palet, prompt gambar, ikon SVG, dan lainnya — isi kolomnya, lalu *Masukkan ke pesan* atau *Kirim sekarang*.

**Bandingkan.** Kirim prompt yang sama ke dua AI dan baca jawabannya berdampingan; *Lanjutkan di obrolan* dengan jawaban
yang lebih baik.

**Gambar** (aplikasi desktop). Membuat gambar dari teks dengan generator yang Anda pilih di bagian atas: Stable Diffusion
WebUI atau ComfyUI (prompt, prompt negatif, ukuran, langkah, guidance, seed, jumlah), server gambar lokal bergaya OpenAI
seperti LocalAI (model, prompt, ukuran), **Antigravity** dengan paket Google AI Pro atau Ultra Anda atau **Codex** dengan
paket ChatGPT Anda (prompt dan bentuk; sekitar satu menit per gambar), atau **Gambar SVG oleh AI Anda** — AI apa pun yang
terhubung, misalnya Claude, menggambar sebagai kode SVG (pilih di *AI yang menggambar*; bisa juga di versi browser
dengan AI lokal). *Sempurnakan prompt* membuat AI obrolan Anda menulis ulang idenya. Simpan hasilnya, *Buka di Foto*,
atau — untuk gambar SVG — *Buka di Vektor* untuk terus mengedit bentuknya.

**Suara** (aplikasi desktop). Ketik atau tempel naskah, pilih mesin dan suara (Pengaturan → Suara) serta kecepatan, lalu
*Buat suara*. Setiap klip bisa diputar, disimpan (WAV), dibuka di Audio, atau ditambahkan ke timeline Video di playhead
sebagai sulih suara. Di versi browser, *Bacakan* memakai suara bawaan browser (tidak bisa disimpan).

**Perlu diketahui.** Alat AI tidak mengingat pesan sebelumnya dengan sendirinya, jadi Ultima mengirim bagian terakhir
obrolan di setiap permintaan (pengaturan *Memori* di kanan; model lokal kecil paling baik dengan 8–16 ribu karakter). AI
yang tidak bisa membaca gambar menerima catatan sebagai pengganti gambar. Di versi browser hanya Ollama dan LM Studio yang
bisa dipakai.

## Tips & mengatasi masalah

- **File besar:** video 4K yang panjang dan gambar yang sangat besar butuh banyak memori. Alat yang pernah dibuka
  tetap berjalan di latar belakang; memulai ulang Ultima membebaskan semuanya.
- **Font:** Ultima menampilkan font yang terpasang di komputer Anda (mungkin diminta izin akses font sekali).
- **Di mana pengaturan saya?** Windows `%APPDATA%\Ultima`, macOS `~/Library/Application Support/Ultima`,
  Linux `~/.config/Ultima`.
- Bantuan lain: [INSTALL.md → Mengatasi masalah](INSTALL.md#mengatasi-masalah),
  [AI_SETUP.md → Mengatasi masalah](AI_SETUP.md#mengatasi-masalah), atau
  [buka issue](https://github.com/tenmaryut/ultima/issues/new/choose).
