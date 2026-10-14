# Changelog

All notable changes to Ultima are listed here. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Video Editor AI

- The AI is told what happened to every step after *Apply* (done, or skipped with the reason) and the panel shows
  the same list; edits can be applied automatically. Nothing the AI does fails silently anymore.
- The AI sees every clip: with an AI that accepts pictures it gets frames from all clips, not only the playhead,
  and it can ask to look at exact moments before cutting.
- Content analysis of your media: tempo (BPM), beats and bar starts, strongest hits, loud moments and bursts
  (gunshots, impacts), where the sound gets louder, and scene changes — for cutting on the beat and montages.
- Many new AI actions: clips from the Media bin, shift, close gaps, remove a time range, unlink, edits on a whole
  track or all clips at once, title restyling, marker and track editing, work area, seek, select, export dialog,
  undo/redo; markers placed after the end of the timeline are flagged.
- Keyframes for position, scale, rotation, opacity, color, blur and volume (◆ in the inspector, diamonds on the
  timeline), speed curves (Montage hit, slow-mo in the middle…), play backwards, freeze frame and smooth slow motion
  — in the editor and for the AI.
- Montage effects (camera shake, glow, RGB split, motion blur, zoom blur, vignette, sharpen, film grain, letterbox),
  16 color looks, `.cube` LUT import, tone curves, HSL per color range, blend modes, masks, transitions out, eight
  new transitions (flash, whip pans, spin, zoom blur, glitch, luma fade, blur dissolve) and adjustment layers —
  rendered on the GPU (WebGL2, with a CPU fallback), the same in the preview and the export, and available to the AI.
- Sound effects per clip (low cut, an animatable high cut for muffling, bass/mids/treble, reverb, ten presets),
  heard while editing and in the export, and auto ducking that lowers the music under voice or game sound with
  editable volume keyframes — also for the AI.
- A built-in library made by Ultima (free to use): 14 sound effects, 11 stickers and 5 overlays, in a new *Library*
  tab and for the AI; the AI can also ask you for files it needs and shows a button to pick them; fonts can be
  imported and are stored inside the project.

## [0.1.0] — 2026-10-11

First public version.

- One desktop app (Windows, macOS, Linux) and a browser build with ten tools: Photo Editor, Photo Develop,
  Vector Designer, Layout & Publishing, Video Editor, Motion Graphics, Audio Editor, PDF Studio, Color Studio
  and AI Studio.
- AI assistant in every editor that uses the AI subscriptions you already have through their official CLIs
  (Claude Code, Codex, Antigravity CLI, Gemini CLI, GitHub Copilot CLI, Qwen Code, Cursor CLI, opencode, Kimi
  Code, custom command) or free local models (Ollama, LM Studio, llama.cpp, Jan). No API keys. Antigravity CLI is
  Google's route for personal Google AI Pro / Ultra accounts since Gemini CLI stopped serving them.
- Image generation with a free local generator (Stable Diffusion WebUI, ComfyUI or an OpenAI-style server such
  as LocalAI), with the built-in image tools of Antigravity CLI (Google AI plan) or Codex (ChatGPT plan), or as an
  SVG drawing by any connected AI (for example Claude) that also opens in Vector — in AI Studio and Photo.
- Text to speech with your system's voices, Piper or a custom command: AI Studio → Speech, voice-over from text
  in Video, speech from text in Audio.
- Video export for TikTok, Reels and Shorts: 1080×1920 at a constant 30 or 60 fps, high-bitrate H.264 High, AAC
  and BT.709, with upload tips. Platforms still re-encode every upload; this gives them the cleanest source. Video
  exports can pick their frame rate, MP4 files start with their index (fast start), and FFmpeg conversions can be
  cancelled.
- Optional local tools: Whisper (captions), rembg (background removal), FFmpeg (extra formats).
- English and Indonesian interface, dark and light themes, and seven color gradients for the app's look.
- Asks before closing when any tool has unsaved changes.
- User guide for every tool, download/install guides for each operating system and an AI setup guide, in
  English and Indonesian.
