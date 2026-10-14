# Ultima — Developer Guide

This guide explains how the app is put together and the conventions every module follows.
Read it before changing code. (Bahasa Indonesia: lihat `docs/id/PENGEMBANGAN.md` untuk ringkasan.)

## Stack

| Part | Tech |
| --- | --- |
| Desktop shell | Electron (main + sandboxed preload), `electron-vite` build, `electron-builder` packaging |
| UI | React 19 + TypeScript (strict), plain CSS with design tokens (`src/renderer/src/styles/global.css`) |
| State | `zustand` (app/AI settings), React state + `useHistoryState` for documents |
| Icons | `lucide-react` (note: brand icons such as `Github` don't exist; `Trash2`, `AlertTriangle` are aliases that work) |
| Media | Canvas 2D / WebGL, Web Audio, WebCodecs via `mediabunny`, `pdf-lib` + `pdfjs-dist`, `ag-psd`, `gifenc`, `jszip`, `dompurify` |
| Tests | `vitest` (unit, node environment) |

```
src/
  main/            Electron main process (window, menu, files, AI bridge, local tools)
    ai/            adapters for subscription CLIs, process runner, IPC service
  preload/         contextBridge → window.ultima (typed in src/shared/ipc.ts)
  shared/          types + code shared by main and renderer (AI types, provider catalog, local HTTP clients)
  renderer/
    index.html
    src/
      core/        platform, i18n, store, commands, history, hooks, viewport, ai client, utils
      components/  ui kit (controls, ColorPicker, Menu, feedback), layout (ModuleLayout), ai (AIAssistantPanel)
      modules/     one folder per module: home, photo, develop, vector, layout, video, motion, audio, pdf, color, ai-studio, settings
      i18n/id.ts   Indonesian strings for the shell
```

## Commands

```bash
npm install           # also downloads Electron
npm run dev           # desktop app with hot reload
npm run build:web     # browser build into dist-web/ (no subscription CLIs, local servers only)
npm run typecheck     # tsc for main/preload and renderer
npm test              # vitest unit tests
npm run dist          # installers for the current OS into release/
```

## Module contract

A module is a folder `src/renderer/src/modules/<id>/` whose `index.tsx` default-exports a
component receiving `ModuleProps` (`{ active: boolean }`). It is registered in
`src/renderer/src/core/modules.ts` (name, icon, color, file extensions it opens).

* Modules stay **mounted** after the first visit (hidden with `hidden` when inactive) so work is
  never lost when switching. Pause animation loops, timers and global listeners when `active` is false.
* Build the screen with `ModuleLayout` (`components/layout/ModuleLayout.tsx`): header with menus,
  contextual toolbar and actions, left tool palette, center canvas, right panels, optional bottom
  panel (timeline) and status bar, plus the `ai` slot for the module's `AIAssistantPanel`.
* Keep each module self-contained in its own folder. Split big modules into several files
  (`state.ts`, `render.ts`, `tools/*.ts`, `panels/*.tsx`, `ai.ts`, `i18n.ts`…).
* Pure logic (math, parsers, encoders, document operations) goes in `.ts` files without React so
  it can be unit tested (`*.test.ts` next to it, run by `npm test` in a node environment — don't
  touch `document`/`window` in tested code).

### Opening files

* Home routes files by extension (`MODULES[].extensions`) and Ultima project files (JSON with
  `{"app":"ultima","module":"<id>"}`) to the right module through `useAppStore().sendToModule()`.
* Receive them with `useHandoffs('<id>', (items) => …)` from `core/hooks.ts`. A handoff can carry
  `files`, `svg`, `text`, `image` (data/object URL), `palette` or `json`.
* Use `pickFiles({ accept, multiple })` from `core/platform.ts` for the module's own Open command,
  and `useFileDrop(ref, onFiles, active)` for drag & drop (show `<DropOverlay/>`).
* Call `rememberRecent(file, '<id>')` (`core/open.ts`) after opening a user file.

### Saving / exporting

* `saveFile(data, { suggestedName, filters })` — native save dialog on desktop, download in the browser.
  Keep the returned `path` and pass it as `path` on the next Save to overwrite without asking.
* `createFileWriter()` for very large outputs (video) — supports positional writes.
* Project files: JSON `{ "app": "ultima", "module": "<id>", "version": 1, ... }` with extension
  `.ultima` (zip with `jszip` if you need binary assets; keep the JSON header file first if zipped
  — or store binary assets as data URLs in the JSON).

### Commands & shortcuts

* `useModuleCommands('<id>', { new, open, save, 'save-as', export, undo, redo, delete, duplicate,
  'select-all', deselect, 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100' })` — wired to the app menu
  and to Ctrl/Cmd shortcuts. Only the active module receives them.
* `useModuleKeydown(active, handler)` for single-key tool shortcuts (V, B, E…). It ignores typing in inputs.
* Undo/redo: `useHistoryState(initial)` for immutable document state (`set(next)`,
  `set(next, { record: false })` during drags + `commit()` on pointer up, `undo`, `redo`, `labels`).

### Canvas viewport

`useViewport(containerRef, docWidth, docHeight, { fitKey, active })` (`core/viewport.ts`) gives
zoom/pan with Ctrl+wheel/pinch zoom, wheel pan, middle-mouse and Space+drag panning, `fit()`,
`actualSize()`, `screenToDoc()`, and a CSS `transform` to apply to a doc-sized element.

### UI kit (`components/ui`)

`Button`, `IconButton`, `ToolButton`, `Field`, `TextInput`, `TextArea`, `Select`, `NumberField`,
`Slider` (with `onCommit` for history), `Toggle`, `Segmented`, `Tabs`, `Panel` (collapsible right-panel
section), `ColorPicker` (HSV + alpha + eyedropper), `MenuBar`, `DropdownButton`, `useContextMenu`,
`Modal`, `confirmDialog`, `promptDialog`, `alertDialog`, `toast.*`, `Spinner`, `ProgressBar`,
`Badge`, `Kbd`, `EmptyState`, `DropOverlay`. CSS classes: see `styles/global.css`
(`.panel`, `.list-item`, `.card`, `.checker`, `.canvas-viewport`, `.mod-status`…). Use the CSS
variables (`var(--bg-2)`, `var(--text-1)`, `var(--accent)`…) — never hard-code UI colors so the
light theme works.

### Translations

All user-visible text goes through `const t = useT()` (or `t()` outside React). The English text
is the key. Each module adds its Indonesian strings in `modules/<id>/i18n.ts`:

```ts
import { registerTranslations } from '../../core/i18n';
registerTranslations('id', { Brightness: 'Kecerahan', 'Export PNG': 'Ekspor PNG' });
```

and imports it once at the top of its `index.tsx` (`import './i18n';`).

### AI in a module

Every editor module embeds `AIAssistantPanel` (`components/ai/AIAssistantPanel.tsx`) in the
`ai` slot of `ModuleLayout`:

```tsx
<AIAssistantPanel
  moduleId="photo"
  moduleName="Photo Editor"
  instructions={PHOTO_AI_INSTRUCTIONS}       // what it can do + exact JSON shape of every action
  getContext={async () => ({ summary: describeDocument(doc), image: await canvasToAIImage(flattened) })}
  onActions={(actions) => applyAIActions(actions)}  // validate every field! return a short summary
  suggestions={[t('Auto-enhance'), t('Make it look vintage')]}
  canSnapshot
/>
```

The model replies `{"message": "...", "actions": [{ "type": "...", ... }]}`. Treat actions as
untrusted input: validate types and clamp numbers before applying them, ignore unknown types, and
apply all actions of one reply as a **single undo step**. Never `eval` anything and never insert
AI text as HTML — sanitize SVG with `sanitizeSvg()` (`core/ai/sanitize.ts`).

For free-form generation (captions, scripts, SVG, palettes) call `runAI()` / `runAIJson()` from
`core/ai/client.ts` directly. They resolve the user's selected AI connection and work with every
provider. Optional local tools are available on desktop through `window.ultima.tools`
(`imageGenerate` = Stable Diffusion WebUI, `transcribe` = Whisper, `removeBackground` = rembg) —
check `desktop` from `core/platform.ts` and degrade gracefully in the browser.

## How AI connections work (no paid API)

`src/main/ai/adapters.ts` starts each vendor's own CLI in non-interactive mode, in an empty temporary
folder, with the prompt on **stdin** (never on the command line, never through a shell):

| Provider | Invocation (simplified) |
| --- | --- |
| Claude Code | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --tools "" --system-prompt …` |
| Codex CLI | `codex exec --skip-git-repo-check --sandbox read-only --output-last-message <file> [--image f] -` |
| Antigravity CLI | `agy -p=<prompt> --output-format json --sandbox --disable-slash-commands [--model m]` (stops at once on a sign-in prompt) |
| Gemini CLI / Qwen Code | `gemini --output-format json [-m model]` (images referenced as `@file`) |
| Copilot CLI | `copilot -p <prompt> --silent` |
| Ollama / LM Studio | local HTTP (`/api/chat`, `/v1/chat/completions`), loopback/LAN addresses only |

API-key environment variables are removed before starting a CLI (unless the user turns that off), so
usage always goes through the user's own subscription login. If a tool rejects the flags (old
version), the adapter retries once with a conservative flag set.

## Security rules

* Renderer: `contextIsolation`, `sandbox`, no Node; strict CSP in production; no remote content.
* Only the main process runs programs. Program paths the renderer wants to change go through a
  native confirmation dialog.
* Files are written only to paths the user picked in a save dialog during the session.
* Local HTTP AI/image servers are restricted to loopback and private network addresses.
