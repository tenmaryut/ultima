<div align="center">

<img src="build/icon.png" alt="Ultima" width="96" height="96">

# Ultima

**Semua alat kreatif. Satu aplikasi gratis.**
Suite kreatif all-in-one yang gratis dan open source untuk Windows, macOS, dan Linux — foto, olah foto, vektor,
tata letak, video, motion grafis, audio, dan PDF — dengan AI dari langganan yang sudah Anda miliki, atau model
lokal gratis. Tanpa API key, tanpa tagihan per token.

[Unduh](#unduh) · [Panduan pengguna](docs/id/PANDUAN.md) · [Hubungkan AI](docs/id/AI_SETUP.md) ·
[Bantuan instalasi](docs/id/INSTALL.md) · 🇬🇧 [English](README.md)

[![CI](https://github.com/tenmaryut/ultima/actions/workflows/ci.yml/badge.svg)](https://github.com/tenmaryut/ultima/actions/workflows/ci.yml)
[![Lisensi: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<img src="website/screenshot.webp" alt="Ultima dengan modul Tata Letak &amp; Publikasi membuka poster acara" width="900">

</div>

## Isi aplikasi

| Alat | Mencakup pekerjaan sehari-hari | Sorotan |
| --- | --- | --- |
| **Editor Foto** | Photoshop | Layer dengan blend mode dan mask, seleksi (marquee, lasso, magic wand), kuas, clone & healing, teks, penyesuaian (levels, curves, hue/saturation…), filter, impor/ekspor PSD |
| **Olah Foto** | Lightroom | Library dengan rating dan flag, slider olah non-destruktif (WebGL), tone curve, HSL, color grading, preset, ekspor massal |
| **Desain Vektor** | Illustrator | Pen dan pencil tool, bentuk, gradien, teks, operasi boolean, align/distribute, layer, ekspor SVG/PDF/PNG |
| **Tata Letak & Publikasi** | InDesign, Adobe Express | Dokumen multi-halaman, master page, paragraph style, template siap pakai (poster, flyer, konten medsos, CV…), PDF siap cetak |
| **Editor Video** | Premiere Pro | Timeline multi-track, trim/split/ripple, keyframe, kurva kecepatan, efek, tampilan warna/LUT/kurva, mask, layer penyesuaian, efek suara dan ducking, SFX dan stiker bawaan, judul, transisi, subtitle (SRT/VTT, otomatis dengan Whisper), ekspor MP4/WebM — dan AI yang melihat setiap klip dan tahu beat-nya |
| **Motion Grafis** | After Effects | Keyframe untuk transformasi, warna, trim path, dan lainnya, kurva easing, preset animasi, animasi kemunculan teks, ekspor MP4/WebM/GIF/PNG sequence |
| **Editor Audio** | Audition | Gelombang & spektrogram, efek (EQ, kompresor, reverb…), reduksi noise dengan noise print, rekam, mixdown multitrack |
| **Studio PDF** | Acrobat | Baca, cari, gabung, pisah, urutkan, anotasi, tanda tangan, sensor (redact), isi formulir |
| **Studio Warna** | Adobe Color | Roda harmoni, palet dari foto, pemeriksa kontras, simulasi buta warna, ekspor ASE/GPL/CSS |
| **Studio AI** | — | Chat dengan AI Anda, template prompt untuk kreator, bandingkan dua AI, pembuatan gambar, teks ke suara |

Ultima tidak berusaha meniru setiap fitur setiap aplikasi Adobe — itu pekerjaan puluhan tahun. Ultima mencakup
apa yang dipakai kebanyakan orang setiap hari, dalam satu aplikasi gratis, dan terbuka untuk dikembangkan siapa saja.

## AI tanpa tagihan API

Setiap alat punya asisten AI yang bisa diajak bicara dengan bahasa sendiri (*“buat lebih hangat dan tambahkan
judul”*). Ultima tidak menjual AI dan tidak pernah meminta API key. Sebagai gantinya Ultima memakai:

- **langganan AI yang sudah Anda miliki** — Ultima menjalankan alat baris perintah resmi yang Anda pasang dan
  login-kan sendiri (Claude Code, Codex, Antigravity CLI, Gemini CLI, GitHub Copilot CLI, Qwen Code, Cursor CLI, opencode,
  Kimi Code, atau perintah kustom), persis seperti di terminal; permintaan dihitung dalam paket Anda sendiri;
- **model lokal gratis** — Ollama, LM Studio, llama.cpp, atau Jan, sepenuhnya offline.

Ultima tidak pernah membaca atau menyimpan kredensial Anda dan menghapus variabel API key sebelum menjalankan alat,
sehingga tidak ada tagihan per token. Setiap alat tunduk pada ketentuan vendornya — lihat
[docs/id/AI_SETUP.md](docs/id/AI_SETUP.md), termasuk [catatan penting tentang Claude Code](docs/id/AI_SETUP.md#catatan-tentang-ketentuan).

Gambar dibuat oleh generator gratis di komputer Anda sendiri (Stable Diffusion WebUI, ComfyUI, atau LocalAI), oleh
alat gambar bawaan Antigravity CLI (Google AI Pro / Ultra) atau Codex (paket ChatGPT), atau sebagai gambar SVG oleh AI
apa pun yang terhubung, misalnya Claude. Teks ke suara (sulih suara di Studio AI, Video, dan Audio)
memakai suara bawaan sistem atau Piper, offline dan gratis. Alat bantu opsional lainnya: Whisper (subtitle otomatis
dan transkrip), rembg (hapus latar belakang), dan FFmpeg (format tambahan).

## Unduh

| Sistem | File |
| --- | --- |
| Windows 10/11 | [Ultima-Setup-x64.exe](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-Setup-x64.exe) · [ARM64](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-Setup-arm64.exe) · [Portable](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-Portable-x64.exe) |
| macOS 12+ | [Apple Silicon](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-mac-arm64.dmg) · [Intel](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-mac-x64.dmg) |
| Linux | [AppImage](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-linux-x86_64.AppImage) · [.deb](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-linux-amd64.deb) · [.rpm](https://github.com/tenmaryut/ultima/releases/latest/download/Ultima-linux-x86_64.rpm) · [semua file](https://github.com/tenmaryut/ultima/releases/latest) |
| Browser | [tenmaryut.github.io/ultima/app](https://tenmaryut.github.io/ultima/app/) (editor saja; AI lewat Ollama lokal) |

Installer belum ditandatangani (code-signed), sehingga Windows dan macOS menampilkan peringatan saat pertama dibuka —
[panduan instalasi](docs/id/INSTALL.md) menunjukkan dua klik yang diperlukan. File rilis dibuat oleh GitHub Actions dari
repositori ini setiap kali tag versi di-push.

## Build dari kode sumber

```bash
git clone https://github.com/tenmaryut/ultima.git
cd ultima
npm install        # Node.js 22+
npm run dev        # jalankan aplikasi desktop dengan hot reload
npm run dist       # buat installer untuk OS Anda ke folder release/
npm run build:web  # versi browser ke dist-web/
```

Pemeriksaan: `npm run typecheck` dan `npm test`. Lihat [docs/id/PENGEMBANGAN.md](docs/id/PENGEMBANGAN.md) untuk
arsitektur dan [CONTRIBUTING.md](CONTRIBUTING.md) untuk ikut berkontribusi.

## Dokumentasi

| | Bahasa Indonesia | English |
| --- | --- | --- |
| Unduh & pasang | [docs/id/INSTALL.md](docs/id/INSTALL.md) | [docs/INSTALL.md](docs/INSTALL.md) |
| Panduan pengguna | [docs/id/PANDUAN.md](docs/id/PANDUAN.md) | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |
| Hubungkan AI | [docs/id/AI_SETUP.md](docs/id/AI_SETUP.md) | [docs/AI_SETUP.md](docs/AI_SETUP.md) |
| Panduan pengembang | [docs/id/PENGEMBANGAN.md](docs/id/PENGEMBANGAN.md) | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

## Status

Versi 0.1 — rilis publik pertama. Masih mungkin ada kekurangan; silakan [laporkan](https://github.com/tenmaryut/ultima/issues).
Batasan yang diketahui: file RAW kamera dibuka lewat pratinjau JPEG yang tersimpan di dalamnya (belum ada pemrosesan
RAW penuh), foto HEIC dan PDF hasil scan tanpa lapisan teks (belum ada OCR) belum didukung, pemisahan warna CMYK untuk
cetak belum tersedia, dan ekspor H.264 tergantung kemampuan sistem Anda (WebM selalu bisa; FFmpeg menambahkan MP4/MOV).
Batasan tiap alat tercantum di [panduan pengguna](docs/id/PANDUAN.md).

## Lisensi & merek dagang

[MIT](LICENSE) — gratis untuk penggunaan pribadi maupun komersial. Ultima adalah proyek independen dan tidak
berafiliasi dengan atau didukung oleh Adobe, Anthropic, OpenAI, Google, GitHub, Microsoft, atau perusahaan lain yang
disebutkan. Nama produk adalah merek dagang pemiliknya dan hanya dipakai untuk menjelaskan kompatibilitas.
