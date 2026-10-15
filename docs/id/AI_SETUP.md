# Menghubungkan AI (tanpa API key)

🇬🇧 English: [docs/AI_SETUP.md](../AI_SETUP.md)

Ultima tidak menjual AI dan tidak pernah meminta API key berbayar per token. Ultima memakai AI dengan dua cara:

1. **Langganan yang sudah Anda miliki** — Ultima menjalankan alat baris perintah (CLI) resmi yang Anda
   pasang dan login-kan sendiri (Claude Code, Codex, Antigravity CLI, GitHub Copilot CLI, …), persis seperti
   Anda menjalankannya di terminal, lalu membaca jawabannya. Permintaan dihitung dalam **batas pemakaian
   paket Anda sendiri**.
2. **Model lokal gratis** — Ollama, LM Studio, llama.cpp, atau Jan menjalankan model terbuka di komputer
   Anda sendiri. Tidak ada data yang keluar dan bisa dipakai offline.

```
Anda mengetik permintaan ─▶ Ultima (menambah konteks dokumen) ─▶ stdin ─▶ claude / codex / gemini / … ─▶ jawaban
                                                                └──▶ Ollama / LM Studio di 127.0.0.1 ──┘
```

Yang **tidak** dilakukan Ultima: tidak pernah membaca, menyimpan, atau mengirim kata sandi maupun token login
Anda; tidak pernah memanggil API vendor secara langsung; dan (kecuali Anda matikan) menghapus variabel
lingkungan API key seperti `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, dan `GEMINI_API_KEY` sebelum menjalankan
alat, sehingga alat memakai login langganan Anda, bukan menagih API key.

## Pilih yang mana?

| Koneksi | Yang dibutuhkan | Biaya tambahan | Memahami gambar | Catatan |
| --- | --- | --- | --- | --- |
| **Claude Code** (Anthropic) | Claude Pro atau Max | tidak ada di luar paket | ya | Sangat bagus untuk instruksi desain dan edit. Baca [catatan ketentuan](#catatan-tentang-ketentuan) dulu. |
| **Codex CLI** (OpenAI) | ChatGPT Plus, Pro, Business, Edu, atau Enterprise | tidak ada di luar paket | ya | |
| **Antigravity CLI** (Google) | Google AI Pro atau Ultra | tidak ada di luar paket Anda | ya | Agen terminal Google. Menggantikan Gemini CLI untuk akun Google pribadi sejak 18 Juni 2026, dan bisa membuat gambar dengan paket Anda. |
| **Gemini CLI** (Google) | Gemini Code Assist Standard atau Enterprise (organisasi) | tidak ada di luar lisensinya | ya | Akun Google pribadi — gratis, AI Pro, Ultra — tidak lagi bisa dipakai di sini: gunakan Antigravity CLI. |
| **GitHub Copilot CLI** | Paket Copilot | memakai kredit AI yang termasuk dalam paket | ya (model vision) | Pemakaian ekstra hanya jika Anda mengatur budget di GitHub. |
| **Qwen Code** | Alibaba Cloud Coding Plan atau model yang Anda atur di Qwen Code | biaya paket | ya | Kuota gratis Qwen OAuth berakhir April 2026. |
| **Cursor CLI** | Paket Cursor | tidak ada di luar paket | tidak | Beta. |
| **opencode** | Akun apa pun yang Anda hubungkan di opencode (ChatGPT, Copilot, …) atau model gratisnya | tergantung | tidak | |
| **Kimi Code** | Keanggotaan Kimi Code | tidak ada di luar paket | tidak | |
| **Ollama** | tidak ada | gratis | dengan model vision | Berjalan di komputer Anda, offline. |
| **LM Studio / llama.cpp / Jan** | tidak ada | gratis | dengan model vision | Server kompatibel OpenAI di komputer atau jaringan lokal Anda. |

Anda bisa menghubungkan beberapa sekaligus dan memilih per permintaan di panel AI.
**Pengaturan → Koneksi AI → AI utama** menentukan yang dipakai secara bawaan.

## Langkah demi langkah

Semua alat berlangganan caranya sama: **pasang → login sekali di terminal → aktifkan di Ultima**.

### Claude Code

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash
# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
# atau: brew install --cask claude-code  |  winget install Anthropic.ClaudeCode  |  npm install -g @anthropic-ai/claude-code

claude auth login      # pilih akun Claude Pro/Max Anda di browser
claude auth status     # harus menunjukkan Anda login dengan claude.ai
```

### Codex CLI (ChatGPT)

```bash
# macOS / Linux
curl -fsSL https://chatgpt.com/codex/install.sh | sh
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
# atau: npm install -g @openai/codex  |  brew install --cask codex

codex login            # pilih "Sign in with ChatGPT"
codex login status     # → "Logged in using ChatGPT"
```

### Antigravity CLI (Google AI Pro / Ultra)

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
# atau: brew install --cask antigravity-cli

agy        # login dengan akun Google paket Google AI Pro atau Ultra Anda, lalu ketik /quit
```

Ultima menjalankan `agy -p` (mode print) di folder kosong dengan `--sandbox`, dan mengirim permintaan Anda bersama
prompt-nya. `agy -p "/usage"` di terminal menunjukkan sisa kuota paket Anda dan kapan direset. Saat kuota habis,
Antigravity hanya memakai *AI credits* jika Anda menyalakan **Use AI Credits** di `agy` (`/credits`).

### Gemini CLI (Google, organisasi)

Google [memindahkan akun pribadi ke Antigravity CLI](https://github.com/google-gemini/gemini-cli/discussions/27274):
sejak 18 Juni 2026 Gemini CLI tidak lagi melayani akun gratis, Google AI Pro, maupun Google AI Ultra. Gemini CLI tetap
bisa dipakai dengan lisensi Gemini Code Assist Standard atau Enterprise dari organisasi Anda:

```bash
npm install -g @google/gemini-cli     # butuh Node.js 20+  (atau: brew install gemini-cli)
gemini                                # pilih "Sign in with Google", lalu ketik /quit
```

### GitHub Copilot CLI

```bash
# macOS / Linux
curl -fsSL https://gh.io/copilot-install | bash
# Windows
winget install GitHub.Copilot
# atau: npm install -g @github/copilot  |  brew install copilot-cli

copilot login
```

### Qwen Code, Cursor CLI, opencode, Kimi Code

| Alat | Pasang | Login |
| --- | --- | --- |
| Qwen Code | `npm install -g @qwen-code/qwen-code@latest` | `qwen`, lalu `/auth` |
| Cursor CLI | `curl https://cursor.com/install -fsS \| bash` (Windows: `irm 'https://cursor.com/install?win32=true' \| iex`) | `cursor-agent login` |
| opencode | `curl -fsSL https://opencode.ai/install \| bash` atau `npm install -g opencode-ai` | `opencode auth login` |
| Kimi Code | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash` atau `npm install -g @moonshot-ai/kimi-code` | `kimi`, lalu `/login` |

### Mengaktifkan di Ultima

1. Buka **Pengaturan** (ikon roda gigi di bawah rail kiri) → **Koneksi AI**.
2. Tekan **Periksa lagi**. Alat yang terpasang menampilkan **Terpasang** beserta versinya.
3. **Aktifkan** alatnya. Ultima menampilkan penjelasan singkat dan tautan ke ketentuan vendor —
   centang *Saya mengerti* lalu tekan **Aktifkan**.
4. Jika mau, pilih **model** (atau ketik namanya), lalu tekan **Uji**. Anda akan menerima sapaan satu baris.

> Alat tidak ditemukan padahal sudah terpasang? Mulai ulang Ultima (Ultima membaca `PATH` shell saat mulai).
> Masih belum: **Cara memasang dan login → Atur lokasi program**, lalu isi lokasi lengkapnya
> (`which claude` di macOS/Linux, `where claude` di Windows).

## AI lokal gratis

### Ollama (disarankan)

1. Pasang: macOS `brew install ollama` atau aplikasi dari [ollama.com](https://ollama.com/download);
   Windows `winget install Ollama.Ollama`; Linux `curl -fsSL https://ollama.com/install.sh | sh`.
2. Unduh model:

   | Model | Ukuran | Cocok untuk |
   | --- | --- | --- |
   | `ollama pull gemma3:4b` | ± 3 GB | cepat, memahami gambar, RAM 8 GB |
   | `ollama pull gemma3:12b` | ± 8 GB | kualitas lebih baik, memahami gambar, RAM 16 GB |
   | `ollama pull qwen2.5vl:7b` | ± 6 GB | model vision yang kuat |
   | `ollama pull llama3.2:3b` | ± 2 GB | teks saja, sangat cepat |

3. Di Ultima: **Pengaturan → Koneksi AI → Ollama** menampilkan *Berjalan* dan daftar model Anda. Pilih salah satu.

### LM Studio, llama.cpp, Jan

Jalankan server lokalnya, lalu isi URL di **Pengaturan → LM Studio / server lokal**:

| Server | URL |
| --- | --- |
| LM Studio (tab Developer → Start server) | `http://127.0.0.1:1234/v1` |
| llama.cpp `llama-server -m model.gguf` | `http://127.0.0.1:9931/v1` (build sebelum Okt 2026: `:8080`) |
| Jan (Settings → Local API Server) | `http://127.0.0.1:1337/v1` |

Demi keamanan, Ultima hanya terhubung ke server di komputer atau jaringan lokal Anda (`127.0.0.1`,
`192.168.x.x`, `10.x.x.x`, `*.local`, Tailscale…), sehingga tidak bisa tidak sengaja diarahkan ke API cloud berbayar.

## Alat kreatif lokal (opsional)

Program gratis ini membuka fitur AI tambahan. Ultima menemukannya otomatis di `PATH`
(**Pengaturan → Alat kreatif lokal** menampilkan statusnya).

| Alat | Fitur | Cara pasang |
| --- | --- | --- |
| Stable Diffusion WebUI, ComfyUI, atau LocalAI | Pembuatan gambar (Foto, Studio AI) dan generative fill | Lihat [Pembuatan gambar](#pembuatan-gambar) |
| Piper atau suara bawaan sistem | Teks ke suara (Studio AI, Video, Audio) | Lihat [Teks ke suara](#teks-ke-suara) |
| Whisper | Subtitle otomatis (Video) dan transkrip (Audio) | `pip install -U openai-whisper` (butuh FFmpeg) — atau [whisper.cpp](https://github.com/ggml-org/whisper.cpp) `whisper-cli` dengan `WHISPER_CPP_MODEL=/lokasi/ggml-base.bin` — atau `pip install whisper-ctranslate2` |
| rembg | Hapus latar belakang sekali klik (Foto) | `pip install "rembg[cpu,cli]"` (Ultima memakai model `isnet-general-use`) |
| FFmpeg | Ekspor MP3/FLAC, konversi MP4/MOV/GIF | `brew install ffmpeg` · `winget install ffmpeg` · `sudo apt install ffmpeg` |

## Pembuatan gambar

**Pengaturan → Pembuatan gambar** menentukan generator untuk **Studio AI → Gambar** dan **Foto → AI → Buat
Gambar…**. *Generative fill* (melukis ke dalam seleksi) selalu memakai Stable Diffusion WebUI.

Tiga di antaranya memakai langganan yang mungkin sudah Anda punya, tanpa API key: **Antigravity** (Google AI Pro /
Ultra), **Codex** (paket ChatGPT), dan **Gambar SVG oleh AI Anda** (AI apa pun yang terhubung, misalnya Claude).

| Generator | Biaya | Yang dibutuhkan |
| --- | --- | --- |
| **Stable Diffusion WebUI** ([AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) atau [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)) | gratis, offline | GPU dengan VRAM 6 GB+. Jalankan dengan `--api` (alamat bawaan `http://127.0.0.1:7860`). |
| **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** | gratis, offline | Checkpoint Stable Diffusion (`.safetensors`) di `ComfyUI/models/checkpoints`. Alamat bawaan `http://127.0.0.1:8188`. Ultima menjalankan graf text-to-image standar (checkpoint → sampler → decode), jadi checkpoint SD 1.5 / SDXL paling cocok. |
| **Server gambar lokal (gaya OpenAI)** | gratis, offline | Server apa pun di komputer atau jaringan lokal Anda dengan endpoint `/v1/images/generations` bergaya OpenAI, misalnya [LocalAI](https://localai.io) (`local-ai run flux.1-dev-ggml`, alamat `http://127.0.0.1:8080/v1`). Pilih modelnya di Pengaturan. |
| **Antigravity (paket Google AI)** | memakai kuota Google AI Pro / Ultra Anda | Antigravity CLI yang sudah login dengan paket Google AI Anda (lihat [Antigravity CLI](#antigravity-cli-google-ai-pro--ultra)) dan diaktifkan di **Pengaturan → Koneksi AI**. Gambarnya dibuat oleh model Nano Banana dari Google. |
| **Codex (paket ChatGPT)** | memakai batas paket ChatGPT Anda | Codex CLI yang sudah login dengan paket ChatGPT yang menyertakan pembuatan gambar (lihat [Codex CLI](#codex-cli-chatgpt)), dan Codex diaktifkan di **Pengaturan → Koneksi AI**. |
| **Gambar SVG oleh AI Anda** | memakai batas normal AI Anda | AI apa pun yang terhubung — Claude Code, Antigravity, Copilot, model lokal… (pilih di *AI yang menggambar*). AI menulis gambarnya sebagai kode SVG, lalu Ultima menampilkannya. Paling cocok untuk ilustrasi, ikon, logo, dan gambar flat, bukan foto; hasilnya bisa dibuka di Vektor untuk diedit. Bisa juga di versi browser dengan AI lokal. |

**Cara kerja gambar Codex.** Ultima menjalankan `codex exec` dengan alat gambar bawaan Codex dinyalakan
(`--enable image_generation`), perintah shell dan pencarian web dimatikan, di sandbox read-only, dan meminta tepat
satu gambar. Codex menyimpan gambarnya di `~/.codex/generated_images` (atau `$CODEX_HOME`), lalu Ultima
mengambilnya dari sana. Setiap gambar butuh sekitar satu menit dan mengurangi batas pemakaian paket Anda — menurut
OpenAI, gambar menghabiskan batas lebih cepat daripada teks. Sama seperti chat, variabel API key dihapus lebih dulu,
jadi gambar ditagihkan ke paket Anda, bukan ke API key.

**Cara kerja gambar Antigravity.** Ultima menjalankan `agy -p` di folder kosong dengan `--sandbox` dan meminta tepat
satu gambar dengan nama unik. Alat gambar bawaan Antigravity (subagen `image-generator` yang memakai Nano Banana)
menyimpannya bersama percakapan di `~/.gemini`, lalu Ultima menemukannya di sana. Setiap gambar butuh sekitar satu
menit dan mengurangi kuota paket Google AI Anda. Jika Antigravity belum login, Ultima langsung berhenti dan meminta
Anda menjalankan `agy` sekali di terminal.

**Bagaimana dengan Claude?** Paket Claude tidak menyertakan pembuat gambar, tetapi Claude sangat bagus menggambar
vektor. Pilih *Gambar SVG oleh AI Anda* dan Claude Code sebagai *AI yang menggambar*.

**Bagaimana dengan Gemini lewat API key?** Gemini CLI tidak punya alat gambar atau suara bawaan; ekstensi gambarnya
([nanobanana](https://github.com/gemini-cli-extensions/nanobanana)) dan model suara Gemini membutuhkan **API key**
Gemini yang ditagih per pemakaian, hal yang dihindari Ultima. Untuk gambar Gemini dengan paket Anda, pakai Antigravity.

## Teks ke suara

Ubah teks menjadi sulih suara: **Studio AI → Suara**, **Video → AI → Sulih suara dari teks…** (ditempatkan di
playhead pada trek audio yang kosong), dan **Audio → Buat → Suara dari teks…** (disisipkan di kursor, atau sebagai trek baru di
Multitrack). Semuanya berjalan di komputer Anda dan gratis. Pilih mesin, suara, dan kecepatan di
**Pengaturan → Suara** (aplikasi desktop).

| Mesin | Cara pasang | Catatan |
| --- | --- | --- |
| **Suara sistem** | macOS dan Windows: sudah ada. Linux: `sudo apt install espeak-ng` (atau `dnf`/`pacman`) | macOS memakai `say`, Windows suara SAPI lewat PowerShell, Linux `espeak-ng`. Tambahkan suara lewat pengaturan sistem (misalnya suara bahasa Indonesia). |
| **[Piper](https://github.com/OHF-Voice/piper1-gpl)** | `pip install piper-tts`, lalu unduh suara dari [piper-voices](https://huggingface.co/rhasspy/piper-voices) (berkas `.onnx` dan `.onnx.json`) | Suara neural yang terdengar alami, offline — bahasa Indonesia: `id_ID-news_tts-medium`. Di Pengaturan pilih berkas `.onnx`-nya; suara lain di folder yang sama ikut muncul di daftar suara. Periksa lisensi tiap suara (`MODEL_CARD`-nya) sebelum dipakai secara komersial. |
| **Perintah kustom** | program teks-ke-suara apa pun | Isi program dan argumennya. Placeholder: `{text_file}` (teksnya dalam UTF-8), `{output}` (tempat program harus menulis audio), `{voice}` dan `{rate}`; teksnya juga dikirim lewat standard input. Contoh: `espeak-ng` dengan `-v {voice} -f {text_file} -w {output}`. Ultima meminta konfirmasi sebelum menyimpan program yang akan dijalankan. |

Versi browser hanya bisa membacakan teks dengan suara bawaan browser (tidak bisa menyimpan audio).

Tidak ada alat berlangganan (Claude Code, Codex, Antigravity, Gemini CLI, Copilot) yang bisa mengubah teks menjadi
suara dengan paket Anda — skill suara OpenAI untuk Codex dan model suara Gemini membutuhkan API key — jadi Ultima
memakai suara gratis di komputer Anda sendiri.

## Memakai AI di Ultima

- **Panel Asisten AI** ada di setiap editor: tekan **Ctrl/⌘ + J** atau tombol ✨. Jelaskan yang Anda inginkan
  (*“buat lebih hangat dan tambahkan judul di atas”*). Asisten menjawab dengan langkah-langkah edit; tinjau lalu
  tekan **Terapkan** (atau aktifkan *Terapkan hasil edit AI otomatis* di Pengaturan). Satu jawaban = satu langkah undo.
- Tombol kamera mengirim **cuplikan kanvas** bersama permintaan (hanya ke AI yang memahami gambar). Matikan untuk pekerjaan pribadi.
- **Studio AI** adalah chat lengkap dengan template prompt, lampiran file, perbandingan dua AI berdampingan,
  pembuatan gambar, dan teks ke suara. Hasilnya bisa dikirim ke Foto, Vektor, Layout, Motion, Video, Audio, atau Warna.
- Fitur per modul: hapus latar & generative fill (Foto), edit otomatis AI (Olah Foto), ide artwork & logo (Vektor),
  desain dari brief (Layout), subtitle, hapus jeda hening, deskripsi & sulih suara dari teks (Video), animasi dari
  deskripsi (Motion), transkrip, catatan episode & suara dari teks (Audio), ringkasan & “Tanya PDF ini” (PDF), palet
  dari deskripsi (Warna).

## Privasi

Yang dikirim: permintaan Anda, ringkasan teks dokumen yang terbuka (misalnya nama dan ukuran layer, atau teks
halaman PDF saat ini) dan, jika diaktifkan, cuplikan gambar yang diperkecil. Data itu **hanya** dikirim ke AI yang
Anda pilih, melalui alat resmi vendor tersebut, sesuai kebijakan privasi vendor itu. Dengan Ollama atau server lokal
lain, tidak ada yang keluar dari komputer Anda. Ultima tidak punya server, akun, analitik, atau telemetri.

## Catatan tentang ketentuan

Setiap alat tunduk pada ketentuan vendornya, dan batas pemakaian normal paket Anda tetap berlaku. Ultima menampilkan
pemberitahuan berisi tautan ke ketentuan tersebut sebelum Anda mengaktifkan alat berlangganan.

**Claude Code:** catatan hukum Claude Code dari Anthropic menyebutkan bahwa pengembang pihak ketiga sebaiknya memakai
autentikasi API key untuk produk mereka dan tidak boleh meneruskan permintaan melalui kredensial paket Free, Pro, atau
Max atas nama penggunanya. Ultima hanya menjalankan program `claude` asli yang Anda pasang dan login-kan sendiri, di
komputer Anda sendiri, dan tidak pernah menyentuh kredensial Anda — tetapi Anthropic belum menegaskan secara eksplisit
bahwa penggunaan ini diizinkan. Silakan baca [ketentuannya](https://code.claude.com/docs/en/legal-and-compliance) dan
putuskan sendiri; jika ragu, gunakan alat lain atau model lokal gratis.

OpenAI, Google, dan GitHub mendokumentasikan pemakaian non-interaktif CLI mereka (`codex exec`, `agy -p`, `gemini -p`,
`copilot -p`) untuk skrip dan otomatisasi.

## Perintah kustom

CLI AI lain juga bisa dipakai: **Pengaturan → Koneksi AI → Perintah kustom**. Isi program dan argumennya; Ultima
mengirim prompt lewat standard input dan membaca jawaban dari standard output. Ultima meminta konfirmasi (dialog sistem)
sebelum menyimpan program yang akan dijalankan.

## Mengatasi masalah

| Pesan | Yang perlu dilakukan |
| --- | --- |
| *… is not installed or not on PATH* | Pasang alatnya, mulai ulang Ultima, atau atur lokasi program di Pengaturan. |
| *Not logged in / Please run /login / Auth method* | Login sekali di terminal (lihat di atas), lalu tekan **Periksa lagi**. |
| *usage limit / quota / rate limit* | Batas paket Anda tercapai. Tunggu waktu reset yang ditampilkan, atau ganti AI lewat pemilih di panel. |
| *rejected the command-line options* | Perbarui alat ke versi terbaru. |
| Jawaban mengabaikan gambar saya | AI atau model yang dipilih tidak bisa melihat gambar (untuk Ollama, unduh model vision seperti `gemma3`). |
| *Antigravity CLI belum login* | Jalankan `agy` sekali di terminal dan login dengan akun Google Anda, lalu tekan **Periksa lagi**. |
| *Antigravity berhenti tanpa jawaban: ia mencoba memakai alat yang perlu izin* (sebelum 0.2.1: *a tool required the "command" permission that headless mode cannot prompt for*) | Kirim permintaan lagi. Sejak Ultima 0.2.1 permintaan diberikan langsung ke Antigravity, jadi ini jarang terjadi. Jangan menambah aturan izin atau `--dangerously-skip-permissions` untuk Ultima: itu membuat AI bisa menjalankan perintah di komputer Anda. |
| *… tidak menjawab dalam batas waktu* | Naikkan **Pengaturan → Perilaku AI → Batas waktu per permintaan** untuk permintaan besar (misalnya Video Editor dengan banyak klip). Pesannya menampilkan kata-kata terakhir alat itu, misalnya mencoba ulang karena model sedang sibuk. Untuk Antigravity jalankan juga `agy update`: beberapa versi tetap berjalan setelah menjawab, yang sudah ditangani Ultima sejak 0.2.2. |
| *Paket Google AI Anda sudah mencapai batas* | Tunggu sampai kuota direset — `agy -p "/usage"` menunjukkan kapan — atau pilih generator lain. |
| *Antigravity selesai tanpa membuat gambar* | Perbarui (`agy update`) dan pastikan paket Google AI Anda menyertakan pembuatan gambar. |
| *AI tidak menjawab dengan gambar SVG* | Coba lagi, jelaskan gambar yang lebih sederhana, atau pilih AI yang lebih kuat di *AI yang menggambar*. |
| *Codex selesai tanpa membuat gambar* | Perbarui Codex (`npm install -g @openai/codex`) dan pastikan paket ChatGPT Anda menyertakan pembuatan gambar. |
| *ComfyUI belum punya model checkpoint* | Taruh checkpoint `.safetensors` di `ComfyUI/models/checkpoints` lalu mulai ulang ComfyUI. |
| *Program suara tidak ditemukan* | Linux: `sudo apt install espeak-ng`. Atau pasang Piper dan pilih suara di **Pengaturan → Suara**. |
| Jawaban lambat | CLI agen butuh beberapa detik untuk mulai. Pilih model yang lebih cepat (Sonnet/Haiku, Flash) atau model lokal kecil. Naikkan **Batas waktu per permintaan** untuk pekerjaan besar. |
