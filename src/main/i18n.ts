/**
 * Translations for the few dialogs the main process shows itself (the renderer has its own
 * i18n). The renderer reports the UI language; English text is the key.
 */
let language: 'en' | 'id' = 'en';

export function setMainLanguage(value: unknown): void {
  if (value === 'en' || value === 'id') language = value;
}

const ID: Record<string, string> = {
  'You have unsaved changes.': 'Ada perubahan yang belum disimpan.',
  'If you close Ultima now, those changes will be lost.': 'Jika Ultima ditutup sekarang, perubahan itu akan hilang.',
  'Close without saving': 'Tutup tanpa menyimpan',
  Cancel: 'Batal',
  'Choose the export folder': 'Pilih folder ekspor',
  // Linking a folder in the Video Editor
  'Link the whole folder {name}?': 'Hubungkan seluruh folder {name}?',
  'Ultima will look through all of it for videos, music and pictures (it only reads them). Choosing the folder where your clips are, for example {example}, is faster.':
    'Ultima akan menelusuri seluruh isinya untuk mencari video, musik, dan gambar (hanya membacanya). Memilih folder tempat klip Anda tersimpan, misalnya {example}, lebih cepat.',
  'Link this folder': 'Hubungkan folder ini',
  'Choose another folder': 'Pilih folder lain',
  "Ultima can't link this folder": 'Ultima tidak bisa menghubungkan folder ini',
  '{path} holds system or app files. Choose the folder where your clips are saved, for example {example}.':
    '{path} berisi file sistem atau aplikasi. Pilih folder tempat klip Anda tersimpan, misalnya {example}.',
  Allow: 'Izinkan',
  'Allow Ultima to run this program?': 'Izinkan Ultima menjalankan program ini?',
  'Allow Ultima to run this command?': 'Izinkan Ultima menjalankan perintah ini?',
  'Ultima will send your AI requests to this program on standard input.':
    'Ultima akan mengirim permintaan AI Anda ke program ini lewat standard input.',
  // Image generation
  'Could not reach {server}. Is it running? Check the address in Settings.':
    'Tidak dapat menghubungi {server}. Apakah sudah berjalan? Periksa alamatnya di Pengaturan.',
  '{server} did not answer in time.': '{server} tidak menjawab tepat waktu.',
  'the local image server': 'server gambar lokal',
  'ComfyUI has no checkpoint model yet. Put a Stable Diffusion model (.safetensors) into ComfyUI/models/checkpoints and restart ComfyUI.':
    'ComfyUI belum punya model checkpoint. Taruh model Stable Diffusion (.safetensors) di ComfyUI/models/checkpoints lalu mulai ulang ComfyUI.',
  'ComfyUI rejected the request.': 'ComfyUI menolak permintaan.',
  'ComfyUI could not create the image.': 'ComfyUI gagal membuat gambar.',
  'ComfyUI finished without an image.': 'ComfyUI selesai tanpa menghasilkan gambar.',
  'ComfyUI did not finish within 20 minutes.': 'ComfyUI tidak selesai dalam 20 menit.',
  'Choose an image model for the local server first (Settings → Image generation).':
    'Pilih dulu model gambar untuk server lokal (Pengaturan → Pembuatan gambar).',
  'The server returned no image. Check that the selected model can create images.':
    'Server tidak mengembalikan gambar. Pastikan model yang dipilih bisa membuat gambar.',
  'Codex CLI is not installed. Install it with: npm install -g @openai/codex — then run "codex" once to sign in with your ChatGPT account.':
    'Codex CLI belum terpasang. Pasang dengan: npm install -g @openai/codex — lalu jalankan "codex" sekali untuk login dengan akun ChatGPT Anda.',
  'Write a prompt first.': 'Tulis prompt terlebih dahulu.',
  'Codex did not run.': 'Codex tidak berjalan.',
  'Could not start Codex.': 'Tidak dapat menjalankan Codex.',
  'Codex did not finish the image within 8 minutes.': 'Codex tidak menyelesaikan gambar dalam 8 menit.',
  'Codex is not signed in. Run "codex" in a terminal once and sign in with your ChatGPT account.':
    'Codex belum login. Jalankan "codex" sekali di terminal dan login dengan akun ChatGPT Anda.',
  'Your ChatGPT plan has reached its image limit for now. Try again after it resets.':
    'Paket ChatGPT Anda sudah mencapai batas gambar untuk saat ini. Coba lagi setelah batasnya direset.',
  'Codex finished without creating an image. Image generation needs a ChatGPT plan that includes it and an up-to-date Codex CLI (npm install -g @openai/codex).':
    'Codex selesai tanpa membuat gambar. Pembuatan gambar butuh paket ChatGPT yang menyertakannya dan Codex CLI versi terbaru (npm install -g @openai/codex).',
  // Speech
  'There is no text to read.': 'Tidak ada teks untuk dibacakan.',
  'The text is too long (max {count} characters). Split it into parts.':
    'Teksnya terlalu panjang (maks. {count} karakter). Bagi menjadi beberapa bagian.',
  'No speech program was found on this computer. On Linux install espeak-ng (for example: sudo apt install espeak-ng).':
    'Tidak ada program suara di komputer ini. Di Linux pasang espeak-ng (misalnya: sudo apt install espeak-ng).',
  'Piper is not installed. Install it with: pip install piper-tts': 'Piper belum terpasang. Pasang dengan: pip install piper-tts',
  'Choose a Piper voice model (.onnx) in Settings → Speech first.':
    'Pilih dulu model suara Piper (.onnx) di Pengaturan → Suara.',
  'Set up a custom speech command in Settings → Speech first.':
    'Atur dulu perintah suara kustom di Pengaturan → Suara.',
  'The audio file is too large.': 'Berkas audionya terlalu besar.',
  'Speech generation took too long and was stopped.': 'Pembuatan suara terlalu lama dan dihentikan.',
  'Speech generation failed.': 'Pembuatan suara gagal.',
  'Ultima will run this program to turn text into speech.': 'Ultima akan menjalankan program ini untuk mengubah teks menjadi suara.',
  'Choose a Piper voice (.onnx)': 'Pilih suara Piper (.onnx)',
  // Antigravity CLI
  'Antigravity CLI is not signed in. Open a terminal, run agy once and sign in with your Google account.':
    'Antigravity CLI belum login. Buka terminal, jalankan agy sekali, lalu login dengan akun Google Anda.',
  'Antigravity CLI is not installed. Install it (Settings → AI connections), then run agy once to sign in with your Google account.':
    'Antigravity CLI belum terpasang. Pasang (Pengaturan → Koneksi AI), lalu jalankan agy sekali untuk login dengan akun Google Anda.',
  'Antigravity CLI did not run.': 'Antigravity CLI tidak berjalan.',
  'Could not start Antigravity CLI.': 'Tidak dapat menjalankan Antigravity CLI.',
  'Antigravity did not finish the image within 8 minutes.': 'Antigravity tidak menyelesaikan gambar dalam 8 menit.',
  'Your Google AI plan has reached its limit for now. Try again after it resets (in a terminal, agy -p "/usage" shows when).':
    'Paket Google AI Anda sudah mencapai batas untuk saat ini. Coba lagi setelah direset (di terminal, agy -p "/usage" menunjukkan kapan).',
  'Antigravity finished without creating an image. Image generation needs a Google AI Pro or Ultra plan and an up-to-date Antigravity CLI (run: agy update).':
    'Antigravity selesai tanpa membuat gambar. Pembuatan gambar butuh paket Google AI Pro atau Ultra dan Antigravity CLI versi terbaru (jalankan: agy update).',
  '{name} did not answer within the time limit ({limit}). You can raise the limit in Settings → AI behaviour → Time limit per request.':
    '{name} tidak menjawab dalam batas waktu ({limit}). Anda bisa menaikkan batasnya di Pengaturan → Perilaku AI → Batas waktu per permintaan.',
  '{n} s': '{n} dtk',
  '{n} min': '{n} mnt',
  '{n} h': '{n} jam',
  'Its last message:': 'Pesan terakhirnya:',
  'Antigravity stopped without an answer: it tried to use a tool that needs approval (such as a terminal command on your computer), which Ultima does not allow. Please send the request again.':
    'Antigravity berhenti tanpa jawaban: ia mencoba memakai alat yang perlu izin (misalnya perintah terminal di komputer Anda), dan Ultima tidak mengizinkannya. Silakan kirim permintaan lagi.',
  'Antigravity stopped without an answer: it tried to use a tool that needs approval (such as a terminal command on your computer), which Ultima does not allow. Ultima already asked again once. Please send the request again, or pick another model.':
    'Antigravity berhenti tanpa jawaban: ia mencoba memakai alat yang perlu izin (misalnya perintah terminal di komputer Anda), dan Ultima tidak mengizinkannya. Ultima sudah meminta ulang sekali. Silakan kirim permintaan lagi, atau pilih model lain.',
};

/** Text for a main-process dialog in the current UI language. */
export function mt(text: string): string {
  return language === 'id' && Object.hasOwn(ID, text) ? ID[text] : text;
}
