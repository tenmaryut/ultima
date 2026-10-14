# Unduh & pasang Ultima

🇬🇧 English: [docs/INSTALL.md](../INSTALL.md)

Ultima gratis. Semua installer dibuat otomatis dari kode sumber publik oleh
[GitHub Actions](../../.github/workflows/release.yml) dan diterbitkan di
[halaman Releases](https://github.com/tenmaryut/ultima/releases/latest).

| Sistem | File | Keterangan |
| --- | --- | --- |
| Windows 10/11 (kebanyakan PC) | `Ultima-Setup-x64.exe` | Installer |
| Windows ARM (Snapdragon) | `Ultima-Setup-arm64.exe` | Installer |
| Windows tanpa instalasi | `Ultima-Portable-x64.exe` | Bisa dijalankan dari folder atau flashdisk mana pun |
| macOS 12+ dengan Apple Silicon (M1–M4) | `Ultima-mac-arm64.dmg` | |
| macOS 12+ dengan Intel | `Ultima-mac-x64.dmg` | |
| Linux, distribusi apa pun | `Ultima-linux-x86_64.AppImage` / `Ultima-linux-arm64.AppImage` | |
| Ubuntu, Debian, Mint, Pop!_OS | `Ultima-linux-amd64.deb` / `Ultima-linux-arm64.deb` | |
| Fedora, openSUSE, RHEL | `Ultima-linux-x86_64.rpm` | |
| Linux, manual | `Ultima-linux-x64.tar.gz` / `Ultima-linux-arm64.tar.gz` | |

Tautan langsung ke file terbaru: `https://github.com/tenmaryut/ultima/releases/latest/download/<nama file>`.

**Kebutuhan:** komputer 64-bit, RAM 4 GB (disarankan 8 GB+ untuk video), ruang disk sekitar 500 MB,
dan driver grafis yang mendukung WebGL 2 (semua komputer kira-kira 8 tahun terakhir).

---

## Windows

1. Unduh **`Ultima-Setup-x64.exe`** (atau `Ultima-Setup-arm64.exe` untuk laptop ARM).
2. Klik dua kali. Jika **Windows SmartScreen** menampilkan *“Windows protected your PC”*, klik
   **More info → Run anyway**. Pesan ini muncul karena installer belum ditandatangani (sertifikat
   code-signing berbayar, sedangkan proyek ini gratis).
3. Pilih folder instalasi dan selesaikan. Ultima muncul di Start menu dan di desktop.

**Versi portable:** unduh `Ultima-Portable-x64.exe` lalu jalankan — tidak ada yang dipasang.

**Menghapus:** Settings → Apps → Installed apps → Ultima → Uninstall.

## macOS

1. Pilih file yang tepat: menu Apple  → **About This Mac**. *Chip: Apple M…* → `Ultima-mac-arm64.dmg`;
   *Processor: Intel* → `Ultima-mac-x64.dmg`.
2. Buka file `.dmg` lalu seret **Ultima** ke **Applications**.
3. **Pertama kali dibuka:** di Applications, **klik kanan (atau Control-klik) Ultima → Open → Open**.
   macOS menanyakan ini sekali karena aplikasi belum dinotarisasi Apple (butuh akun developer berbayar).
   - macOS 15 Sequoia ke atas: jika tidak ada tombol *Open*, buka **System Settings → Privacy & Security**,
     gulir ke *“Ultima was blocked…”* lalu klik **Open Anyway**.
   - Jika macOS menyebut *“Ultima is damaged and can't be opened”*, buka **Terminal** dan jalankan:
     ```bash
     xattr -dr com.apple.quarantine /Applications/Ultima.app
     ```
4. Saat merekam audio atau video, macOS meminta izin mikrofon/kamera — klik **Allow**.

**Menghapus:** seret Ultima dari Applications ke Trash. Pengaturan tersimpan di
`~/Library/Application Support/Ultima` (hapus folder itu untuk mereset semuanya).

## Linux

### AppImage (distribusi apa pun)
```bash
chmod +x Ultima-linux-x86_64.AppImage
./Ultima-linux-x86_64.AppImage
```
- Ubuntu 22.04+ butuh FUSE 2 untuk AppImage: `sudo apt install libfuse2t64` (24.04) atau `sudo apt install libfuse2` (22.04).
- Jika langsung tertutup dengan error sandbox di Ubuntu 24.04+, jalankan sekali dengan
  `./Ultima-linux-x86_64.AppImage --no-sandbox`, atau pasang versi `.deb`.
- Integrasi ke menu aplikasi (opsional): pakai [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) atau AppImageLauncher.

### Debian / Ubuntu / Mint (.deb)
```bash
sudo apt install ./Ultima-linux-amd64.deb
```
Menghapus: `sudo apt remove ultima`

### Fedora / openSUSE / RHEL (.rpm)
```bash
sudo dnf install ./Ultima-linux-x86_64.rpm      # Fedora / RHEL
sudo zypper install ./Ultima-linux-x86_64.rpm   # openSUSE
```

### tar.gz
```bash
tar -xzf Ultima-linux-x64.tar.gz
./Ultima-linux-x64/ultima
```

## Versi browser (tanpa instalasi)

Versi browser tersedia di **https://tenmaryut.github.io/ultima/app/** setelah GitHub Pages diaktifkan
untuk repositori ini. Semua editor berjalan di Chrome, Edge, atau browser berbasis Chromium lainnya.
Batasan: alat AI berlangganan (Claude Code, Codex, Antigravity CLI, Copilot…) memerlukan aplikasi desktop,
karena halaman web tidak bisa menjalankan program di komputer Anda. AI lokal gratis lewat Ollama tetap
bisa dipakai jika Ollama dijalankan dengan `OLLAMA_ORIGINS=https://tenmaryut.github.io`.

## Build dari kode sumber

Anda butuh [Node.js 22](https://nodejs.org) dan [Git](https://git-scm.com).

```bash
git clone https://github.com/tenmaryut/ultima.git
cd ultima
npm install          # sekaligus mengunduh Electron
npm run dev          # menjalankan aplikasi dengan hot reload
```

Membuat installer untuk sistem Anda sendiri:

```bash
npm run dist         # → folder release/
# atau satu platform tertentu:
npm run dist:win     # di Windows
npm run dist:mac     # di macOS
npm run dist:linux   # di Linux (rpm butuh: sudo apt install rpm)
```

Versi browser: `npm run build:web` → `dist-web/` (sajikan dengan web server statis apa pun).

## Memperbarui

Unduh installer terbaru dan pasang di atas versi lama — pengaturan, koneksi AI, dan daftar file terbaru
tetap tersimpan. Klik **Watch → Custom → Releases** di GitHub agar mendapat notifikasi versi baru.

## Mengatasi masalah

| Masalah | Solusi |
| --- | --- |
| Jendela kosong atau berkedip | Jalankan dengan akselerasi GPU dimatikan: Windows `Ultima.exe --disable-gpu`, macOS `open -a Ultima --args --disable-gpu`, Linux `ultima --disable-gpu`. Perbarui driver grafis. |
| Alat AI “Tidak ditemukan” padahal sudah terpasang | Mulai ulang Ultima setelah memasang alat. Jika masih belum ditemukan, buka **Pengaturan → Koneksi AI → Cara memasang → Atur lokasi program** dan pilih programnya (cari dengan `which claude` di macOS/Linux atau `where claude` di Windows). |
| Alat AI menampilkan “Not logged in” | Buka terminal dan login sekali (lihat [AI_SETUP.md](AI_SETUP.md)), lalu tekan **Periksa lagi**. |
| Ekspor video menyebut H.264 tidak tersedia | Ekspor WebM, atau pasang [FFmpeg](https://ffmpeg.org/download.html) dan pakai “Konversi ke MP4 dengan FFmpeg”. |
| Di mana pengaturan saya? | Windows `%APPDATA%\Ultima`, macOS `~/Library/Application Support/Ultima`, Linux `~/.config/Ultima`. |

Masih bermasalah? [Buka issue](https://github.com/tenmaryut/ultima/issues/new/choose) dan sertakan versi OS serta langkah yang Anda lakukan.
