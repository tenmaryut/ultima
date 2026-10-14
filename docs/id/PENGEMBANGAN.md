# Panduan Pengembang (ringkas)

Versi lengkap (bahasa Inggris): [docs/DEVELOPMENT.md](../DEVELOPMENT.md).

## Teknologi

- **Electron** (proses main + preload ber-sandbox), build dengan `electron-vite`, installer dengan `electron-builder`.
- **React 19 + TypeScript (strict)**, CSS biasa dengan design token di `src/renderer/src/styles/global.css`.
- **zustand** untuk state aplikasi, `useHistoryState` untuk undo/redo dokumen.
- Media: Canvas 2D/WebGL, Web Audio, WebCodecs lewat `mediabunny`, `pdf-lib` + `pdfjs-dist`, `ag-psd`, `gifenc`, `jszip`, `dompurify`.
- Tes: `vitest`.

## Perintah

```bash
npm install           # sekaligus mengunduh Electron
npm run dev           # aplikasi desktop dengan hot reload
npm run build:web     # versi browser ke dist-web/
npm run typecheck     # pemeriksaan tipe
npm test              # unit test
npm run dist          # installer untuk OS saat ini ke release/
```

## Struktur

```
src/main/        proses utama Electron: jendela, menu, file, jembatan AI, alat lokal
src/main/ai/     adapter CLI berlangganan (claude, codex, antigravity, gemini, copilot, …) + runner proses
src/preload/     contextBridge → window.ultima
src/shared/      tipe & kode bersama (katalog penyedia AI, klien HTTP lokal)
src/renderer/src/core/        platform, i18n, store, perintah, riwayat, viewport, klien AI
src/renderer/src/components/  UI kit, ModuleLayout, AIAssistantPanel
src/renderer/src/modules/     satu folder per alat (photo, develop, vector, layout, video, motion, audio, pdf, color, ai-studio)
```

## Aturan modul

- `modules/<id>/index.tsx` mengekspor komponen default dengan props `{ active }`; modul tetap ter-mount saat
  berpindah alat, jadi hentikan animasi/listener ketika `active` bernilai `false`.
- Pakai `ModuleLayout` (header, menu, toolbar, panel kiri/kanan/bawah, status bar, slot `ai`).
- Semua teks lewat `useT()`; terjemahan Indonesia di `modules/<id>/i18n.ts`.
- Perintah global (baru, buka, simpan, ekspor, undo, redo, zoom) lewat `useModuleCommands`.
- File proyek: JSON `{"app":"ultima","module":"<id>","version":1,...}` dengan ekstensi `.ultima`.
- AI: `AIAssistantPanel` dengan instruksi aksi JSON yang jelas; validasi setiap aksi dari AI sebelum diterapkan,
  satu jawaban = satu langkah undo. Jangan pernah `eval` atau menyisipkan jawaban AI sebagai HTML.

## Cara kerja AI (tanpa API berbayar)

`src/main/ai/adapters.ts` menjalankan CLI resmi tiap vendor dalam mode non-interaktif di folder sementara yang
kosong, dengan prompt lewat **stdin** (tidak lewat baris perintah, tidak lewat shell). Variabel API key dihapus
sebelum CLI dijalankan sehingga pemakaian selalu lewat login langganan pengguna. Server lokal (Ollama, LM Studio)
dibatasi ke alamat loopback/jaringan lokal.

## Keamanan

- Renderer: `contextIsolation`, `sandbox`, tanpa Node, CSP ketat di build produksi.
- Hanya proses main yang boleh menjalankan program; perubahan lokasi program harus dikonfirmasi lewat dialog sistem.
- File hanya ditulis ke lokasi yang dipilih pengguna di dialog simpan.
