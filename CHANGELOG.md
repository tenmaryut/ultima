# Changelog

All notable changes to Ultima are listed here. Versions follow [semantic versioning](https://semver.org).

## [0.4.0] — 2026-10-18

Everything a pro game montage needs, in the Video Editor and for its AI: optical-flow slow motion, motion tracking,
3D, text behind the player, effects on the beat, stems — and royalty-free music with the drop on your best kill.

### Video Editor

- **Optical-flow slow motion** (Inspector → Speed → *Smooth slow motion*): new in-between frames made from the motion
  in the picture, Twixtor-style, on export; *Blend frames* stays as the fast option.
- **Motion tracking** (Inspector → *Motion tracking*): draw a box around what moves — an enemy, a car, a face — and
  Ultima follows it through the clip, also past short moments where it is covered. Pin a crosshair, a circle, a text
  or selected titles and stickers to it.
- **3D**: tilt, turn, depth and perspective for clips, titles, stickers and adjustment layers, all animatable; titles
  with 3D depth (extruded letters) and a side color; parallax moves.
- **Cut out the subject** (desktop app with rembg): masks of the player or person in every frame. Show only the
  subject or everything but it, or put the subject in front of your titles — text behind the player.
- **Beat effects** (*AI → Beat effects…*): shake, zoom punch, flash, RGB split, glow pulse, zoom blur or all-in-one
  impact on every beat, bar, strongest hit or loud moment of the music or the game sound, as editable keyframes.
- **Separate the sound (stems)**: remove the vocals, keep only the vocals or the drums, or remove the drums. The part
  you keep is a new audio clip in sync and the original is muted. Built in (no download), or with Demucs when it is
  installed — much cleaner.
- **Music generator** (*Library* tab): royalty-free songs made on your computer in seven styles — phonk, trap, EDM,
  dubstep, drum & bass, lo-fi and cinematic — with intro, build-up, drop, break and outro, and the drop exactly at
  the second you choose. The same settings always make the same song; a variation makes another.
- **Make a sound effect**: any library sound at any length, pitch and brightness, or another take of it — placed at
  the playhead or ending on it (a riser that lands on the drop). Six new library sounds: snare roll, reverse cymbal,
  crash cymbal, downlifter, braam and laser.
- **Export folder**: exports go straight into *Videos/Ultima* (or a folder you choose in the export dialog or
  *Settings → Exports*) without a dialog, never overwriting a file, with *Show in folder*. Turn on *Ask where to save
  every export* to choose each time.

### Video Editor AI

- New actions for all of the above: beat effects, motion tracking (it can put a grid on the frames it looks at to
  place the box precisely), optical-flow slow motion, 3D and parallax, cut-outs, stems, music generation and custom
  sound effects that end on a moment.
- Music it generates is known to the beat right away: the result lists its beats, bars, drops and parts, and beat
  effects can follow it in the same reply.
- It can export by itself (the whole timeline or the work area) into the export folder and is told where the file
  went.

### Settings

- *Exports*: the export folder and *Ask where to save every export*.
- *Local creative tools*: Demucs for stem separation; rembg now also cuts out subjects in Video.

## [0.3.0] — 2026-10-17

Link the folder where your clips are saved and the Video Editor — and its AI — work with it directly.

### Video Editor

- **Linked folders** (*Media → Link a folder…*): the videos, audio and pictures in a folder you link (for example
  your game recordings), subfolders included, are listed in the media bin by themselves, newest first, with posters
  and lengths; new recordings show up when Ultima gets the focus. Drag or double-click them onto the timeline —
  nothing is copied. Folders stay linked after a restart, and projects whose files are in a linked folder find them
  by themselves instead of asking to relink. Ultima only reads these folders.
- **The AI sees your folder clips**: it gets the files of your linked folders and can use them like media in the bin
  (they are added to the project by themselves).
- **A sharper look for the AI**: *look* now works on any clip in the bin or a linked folder, not only the timeline —
  an overview of the whole clip with its loud moments, a strip of up to 16 frames over a short range to see the motion,
  and a zoom into part of the picture at full resolution (kill feed, kill banner, crosshair) — with much bigger
  pictures, and up to four look rounds per request. For game clips it confirms kills and headshots on the kill feed
  before cutting instead of guessing from the sound.

## [0.2.3] — 2026-10-17

### Changed

- The AI time limit (*Settings → AI behaviour → Time limit per request*) is set in minutes, goes up to 24 hours and
  is 2 hours by default: agent AIs such as Claude Code, Codex or Antigravity can work on a big edit for an hour or
  more. A limit still at the old 5-minute default moves to 2 hours; one you chose stays. *Stop* still ends a request
  at any time.
- Timeout messages give the limit in minutes or hours, and Antigravity reaching the limit Ultima passed to it is
  reported the same way — its partial answer is not used as if it were complete.

## [0.2.2] — 2026-10-15

### Fixed

- Antigravity requests no longer end in *"did not answer within the time limit"* after Antigravity has already
  answered: some versions of the CLI keep running for minutes after their answer, so Ultima now takes the answer
  as soon as it is complete and closes the CLI. Antigravity also gets a time limit just under Ultima's, so it ends
  a run itself and says why. Image generation with Antigravity finishes sooner for the same reason.
- When an AI tool does run out of time, the message names the limit, where to raise it (*Settings → AI behaviour →
  Time limit per request*) and the tool's last message — also in Indonesian.

## [0.2.1] — 2026-10-15

### Fixed

- Antigravity on Windows no longer stops with *"a tool required the "command" permission that headless mode cannot
  prompt for"*. Ultima used to put every Windows request in a file and ask Antigravity to read it; Antigravity
  sometimes reached for a terminal command to do that, which its headless mode blocks. Requests now go to `agy.exe`
  directly (a file is only used when a request is too long for the command line), Antigravity is told that terminal
  commands are blocked, and on macOS and Linux requests up to 100 KB are passed directly as well.
- When Antigravity still stops because it tried a tool that needs approval, Ultima explains it in plain words (also
  in Indonesian) instead of showing advice that would let the AI run commands on your computer.

## [0.2.0] — 2026-10-15

The Video Editor and its AI assistant can now do what a montage needs: see every clip, hear the beat, animate,
ramp the speed, grade, add effects and sound effects, and tell you what happened to every step.

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
