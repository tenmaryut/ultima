# Connect your AI (no API keys needed)

🇮🇩 Bahasa Indonesia: [docs/id/AI_SETUP.md](id/AI_SETUP.md)

Ultima doesn't sell AI and never asks for a paid, per-token API key. It uses AI in two ways:

1. **Your existing subscription** — Ultima starts the official command-line tool (CLI) you installed and
   signed in to yourself (Claude Code, Codex, Antigravity CLI, GitHub Copilot CLI, …), exactly as you would
   in a terminal, and reads its answer. Requests count against **your own plan's usage limits**.
2. **Free local models** — Ollama, LM Studio, llama.cpp or Jan run open models on your own computer.
   Nothing leaves your machine and it works offline.

```
You type a request ─▶ Ultima (adds the document context) ─▶ stdin ─▶ claude / codex / gemini / … ─▶ answer
                                                             └──▶ Ollama / LM Studio on 127.0.0.1 ──┘
```

What Ultima does **not** do: it never reads, stores or sends your passwords or login tokens; it never
calls a vendor's API directly; and (unless you turn it off) it removes API-key environment variables such
as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` before starting a tool, so the tool uses your
subscription login instead of billing an API key.

## Which one should I use?

| Connection | You need | Extra cost | Sees images | Notes |
| --- | --- | --- | --- | --- |
| **Claude Code** (Anthropic) | Claude Pro or Max | none beyond your plan | yes | Excellent at design and editing instructions. Read the [terms note](#a-note-on-terms) first. |
| **Codex CLI** (OpenAI) | ChatGPT Plus, Pro, Business, Edu or Enterprise | none beyond your plan | yes | |
| **Antigravity CLI** (Google) | Google AI Pro or Ultra | none beyond your plan | yes | Google's terminal agent. It replaced Gemini CLI for personal Google accounts on June 18, 2026, and can also make images on your plan. |
| **Gemini CLI** (Google) | Gemini Code Assist Standard or Enterprise (organizations) | none beyond the license | yes | Personal Google accounts — free, AI Pro, Ultra — no longer work here: use Antigravity CLI. |
| **GitHub Copilot CLI** | A Copilot plan | uses the AI credits included in your plan | yes (vision models) | Extra usage only if you set a budget on GitHub. |
| **Qwen Code** | Alibaba Cloud Coding Plan or a model you configured in Qwen Code | plan fee | yes | The free Qwen OAuth tier ended in April 2026. |
| **Cursor CLI** | A Cursor plan | none beyond your plan | no | Beta. |
| **opencode** | Any account you connected in opencode (ChatGPT, Copilot, …) or its free models | depends | no | |
| **Kimi Code** | Kimi Code membership | none beyond your plan | no | |
| **Ollama** | nothing | free | with vision models | Runs on your computer, offline. |
| **LM Studio / llama.cpp / Jan** | nothing | free | with vision models | Any OpenAI-compatible server on your machine or LAN. |

You can connect several and pick one per request in the AI panel. **Settings → AI connections → Default AI**
sets the one used by default.

## Step by step

Every subscription tool works the same way: **install → sign in once in a terminal → enable it in Ultima**.

### Claude Code

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash
# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
# or: brew install --cask claude-code  |  winget install Anthropic.ClaudeCode  |  npm install -g @anthropic-ai/claude-code

claude auth login      # choose your Claude Pro/Max account in the browser
claude auth status     # should show you are logged in with claude.ai
```

### Codex CLI (ChatGPT)

```bash
# macOS / Linux
curl -fsSL https://chatgpt.com/codex/install.sh | sh
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
# or: npm install -g @openai/codex  |  brew install --cask codex

codex login            # choose "Sign in with ChatGPT"
codex login status     # → "Logged in using ChatGPT"
```

### Antigravity CLI (Google AI Pro / Ultra)

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
# or: brew install --cask antigravity-cli

agy        # sign in with the Google account of your Google AI Pro or Ultra plan, then type /quit
```

Ultima runs `agy -p` (print mode) in an empty folder with `--sandbox`, and sends your request with the prompt.
`agy -p "/usage"` in a terminal shows how much of your plan's quota is left and when it resets. When the quota is
used up, Antigravity only spends *AI credits* if you turned on **Use AI Credits** in `agy` (`/credits`).

### Gemini CLI (Google, organizations)

Google [moved personal accounts to Antigravity CLI](https://github.com/google-gemini/gemini-cli/discussions/27274):
since June 18, 2026 Gemini CLI no longer serves free, Google AI Pro or Google AI Ultra accounts. It still works
with a Gemini Code Assist Standard or Enterprise license from your organization:

```bash
npm install -g @google/gemini-cli     # needs Node.js 20+  (or: brew install gemini-cli)
gemini                                # pick "Sign in with Google", then type /quit
```

### GitHub Copilot CLI

```bash
# macOS / Linux
curl -fsSL https://gh.io/copilot-install | bash
# Windows
winget install GitHub.Copilot
# or: npm install -g @github/copilot  |  brew install copilot-cli

copilot login
```

### Qwen Code, Cursor CLI, opencode, Kimi Code

| Tool | Install | Sign in |
| --- | --- | --- |
| Qwen Code | `npm install -g @qwen-code/qwen-code@latest` | `qwen`, then `/auth` |
| Cursor CLI | `curl https://cursor.com/install -fsS \| bash` (Windows: `irm 'https://cursor.com/install?win32=true' \| iex`) | `cursor-agent login` |
| opencode | `curl -fsSL https://opencode.ai/install \| bash` or `npm install -g opencode-ai` | `opencode auth login` |
| Kimi Code | `curl -fsSL https://code.kimi.com/kimi-code/install.sh \| bash` or `npm install -g @moonshot-ai/kimi-code` | `kimi`, then `/login` |

### Enable it in Ultima

1. Open **Settings** (gear at the bottom of the left rail) → **AI connections**.
2. Press **Check again**. Installed tools show **Installed** with their version.
3. Switch the tool **on**. Ultima shows a short notice about what happens and links to the vendor's terms —
   tick *I understand* and press **Enable**.
4. Optionally choose a **model** (or type one), then press **Test**. You should get a one-line hello.

> The tool is not found although it is installed? Restart Ultima (it reads your shell's `PATH` at start).
> Still missing: **How to install and sign in → Set program path** and enter the full path
> (`which claude` on macOS/Linux, `where claude` on Windows).

## Free local AI

### Ollama (recommended)

1. Install: macOS `brew install ollama` or the app from [ollama.com](https://ollama.com/download);
   Windows `winget install Ollama.Ollama`; Linux `curl -fsSL https://ollama.com/install.sh | sh`.
2. Download a model:

   | Model | Size | Good for |
   | --- | --- | --- |
   | `ollama pull gemma3:4b` | ~3 GB | fast, understands images, 8 GB RAM |
   | `ollama pull gemma3:12b` | ~8 GB | better quality, understands images, 16 GB RAM |
   | `ollama pull qwen2.5vl:7b` | ~6 GB | strong vision model |
   | `ollama pull llama3.2:3b` | ~2 GB | text only, very fast |

3. In Ultima: **Settings → AI connections → Ollama** shows *Running* and lists your models. Pick one.

### LM Studio, llama.cpp, Jan

Start the local server, then set the URL in **Settings → LM Studio / local server**:

| Server | URL |
| --- | --- |
| LM Studio (Developer tab → Start server) | `http://127.0.0.1:1234/v1` |
| llama.cpp `llama-server -m model.gguf` | `http://127.0.0.1:9931/v1` (builds before Oct 2026: `:8080`) |
| Jan (Settings → Local API Server) | `http://127.0.0.1:1337/v1` |

For safety, Ultima only connects to servers on your computer or local network (`127.0.0.1`, `192.168.x.x`,
`10.x.x.x`, `*.local`, Tailscale…), so it can't be pointed at a paid cloud API by accident.

## Optional local creative tools

These are free programs that unlock more AI features. Ultima finds them on your `PATH` automatically
(**Settings → Local creative tools** shows their status).

| Tool | Unlocks | Install |
| --- | --- | --- |
| Stable Diffusion WebUI, ComfyUI or LocalAI | Image generation (Photo, AI Studio) and generative fill | See [Image generation](#image-generation) |
| Piper or your system's voices | Text to speech (AI Studio, Video, Audio) | See [Text to speech](#text-to-speech) |
| Whisper | Automatic captions (Video) and transcripts (Audio) | `pip install -U openai-whisper` (needs FFmpeg) — or [whisper.cpp](https://github.com/ggml-org/whisper.cpp) `whisper-cli` with `WHISPER_CPP_MODEL=/path/to/ggml-base.bin` — or `pip install whisper-ctranslate2` |
| rembg | One-click background removal (Photo) | `pip install "rembg[cpu,cli]"` (Ultima uses the `isnet-general-use` model) |
| FFmpeg | MP3/FLAC export, MP4/MOV/GIF conversion | `brew install ffmpeg` · `winget install ffmpeg` · `sudo apt install ffmpeg` |

## Image generation

**Settings → Image generation** picks the generator used by **AI Studio → Images** and **Photo → AI →
Generate Image…**. *Generative Fill* (painting into a selection) always uses Stable Diffusion WebUI.

Three of them use a subscription you may already have, without an API key: **Antigravity** (Google AI Pro /
Ultra), **Codex** (ChatGPT plans) and **SVG drawing by your AI** (any connected AI, for example Claude).

| Generator | Cost | You need |
| --- | --- | --- |
| **Stable Diffusion WebUI** ([AUTOMATIC1111](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or [Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)) | free, offline | A GPU with 6 GB+ VRAM. Start it with `--api` (default address `http://127.0.0.1:7860`). |
| **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** | free, offline | A Stable Diffusion checkpoint (`.safetensors`) in `ComfyUI/models/checkpoints`. Default address `http://127.0.0.1:8188`. Ultima runs a standard text-to-image graph (checkpoint → sampler → decode), so SD 1.5 / SDXL checkpoints work best. |
| **Local image server (OpenAI-style)** | free, offline | Any server on your computer or LAN with an OpenAI-style `/v1/images/generations` endpoint, for example [LocalAI](https://localai.io) (`local-ai run flux.1-dev-ggml`, address `http://127.0.0.1:8080/v1`). Pick the model in Settings. |
| **Antigravity (Google AI plan)** | uses your Google AI Pro / Ultra quota | Antigravity CLI signed in with your Google AI plan (see [Antigravity CLI](#antigravity-cli-google-ai-pro--ultra)) and turned on in **Settings → AI connections**. Images come from Google's Nano Banana models. |
| **Codex (ChatGPT plan)** | uses your ChatGPT plan's limits | The Codex CLI signed in with a ChatGPT plan that includes image generation (see [Codex CLI](#codex-cli-chatgpt)), and Codex turned on in **Settings → AI connections**. |
| **SVG drawing by your AI** | uses your AI's normal limits | Any connected AI — Claude Code, Antigravity, Copilot, a local model… (pick it under *AI that draws*). The AI writes the picture as SVG code, which Ultima renders. Best for illustrations, icons, logos and flat art, not photos; the result opens in Vector for editing. Also works in the browser version with a local AI. |

**How Codex images work.** Ultima runs `codex exec` with Codex's built-in image tool turned on (`--enable
image_generation`), shell commands and web search turned off, in a read-only sandbox, and asks for exactly one
picture. Codex saves the image in `~/.codex/generated_images` (or `$CODEX_HOME`), where Ultima picks it up. Each
image takes about a minute and counts against your plan's usage limits — OpenAI notes that images use them up
faster than text. As with chat, API-key variables are removed first, so the picture is billed to your plan, not
to an API key.

**How Antigravity images work.** Ultima runs `agy -p` in an empty folder with `--sandbox` and asks for exactly one
image with a unique name. Antigravity's built-in image tool (an `image-generator` subagent using Nano Banana) saves
it with the conversation under `~/.gemini`, where Ultima finds it. Each image takes about a minute and counts
against your Google AI plan's quota. If Antigravity is not signed in, Ultima stops right away and tells you to run
`agy` once in a terminal.

**And Claude?** Claude plans don't include an image generator, but Claude draws very good vector art. Choose
*SVG drawing by your AI* and Claude Code as *AI that draws*.

**What about Gemini through an API key?** Gemini CLI has no built-in image or speech tool; its image extension
([nanobanana](https://github.com/gemini-cli-extensions/nanobanana)) and Gemini's speech models need a Gemini **API
key**, billed per use, which Ultima avoids. For Gemini images on your plan, use Antigravity.

## Text to speech

Turn text into a voice-over: **AI Studio → Speech**, **Video → AI → Voice-over from text…** (placed at the
playhead on a free audio track) and **Audio → Generate → Speech from text…** (inserted at the cursor, or as a new track in
Multitrack). Everything runs on your computer and is free. Choose the engine, voice and speed in
**Settings → Speech** (desktop app).

| Engine | Install | Notes |
| --- | --- | --- |
| **System voices** | macOS and Windows: built in. Linux: `sudo apt install espeak-ng` (or `dnf`/`pacman`) | macOS uses `say`, Windows the SAPI voices through PowerShell, Linux `espeak-ng`. Add voices in your system settings (for example an Indonesian voice). |
| **[Piper](https://github.com/OHF-Voice/piper1-gpl)** | `pip install piper-tts`, then download a voice from [piper-voices](https://huggingface.co/rhasspy/piper-voices) (both the `.onnx` and `.onnx.json` file) | Natural-sounding neural voices, offline — Indonesian: `id_ID-news_tts-medium`. In Settings choose the `.onnx` file; other voices in the same folder appear in the voice list. Check each voice's license (its `MODEL_CARD`) before commercial use. |
| **Custom command** | any text-to-speech program | Enter the program and its arguments. Placeholders: `{text_file}` (the text as UTF-8), `{output}` (where the program must write the audio), `{voice}` and `{rate}`; the text is also sent on standard input. Example: `espeak-ng` with `-v {voice} -f {text_file} -w {output}`. Ultima asks for confirmation before it stores a program to run. |

The browser version can only read text aloud with the browser's own voice (it can't save audio).

None of the subscription tools (Claude Code, Codex, Antigravity, Gemini CLI, Copilot) can turn text into speech on
your plan — OpenAI's speech skill for Codex and Gemini's speech models need an API key — so Ultima uses these free
voices on your own computer.

## Using AI in Ultima

- **AI Assistant panel** in every editor: press **Ctrl/⌘ + J** or the ✨ button. Describe what you want
  (*“make it warmer and add a title at the top”*). The assistant answers with edit steps; review them and
  press **Apply** (or turn on *Apply AI edits automatically* in Settings). One reply = one undo step.
- The camera button sends a **snapshot of your canvas** along with the request (only to AIs that understand
  images). Turn it off for private work.
- **AI Studio** is a full chat with prompt templates, file attachments, side-by-side comparison of two AIs,
  image generation and text to speech. Results can be sent to Photo, Vector, Layout, Motion, Video, Audio or Color.
- Module features: background removal & generative fill (Photo), AI auto-edit (Develop), artwork & logo
  ideas (Vector), design from a brief (Layout), captions, silence removal, descriptions & voice-over from text
  (Video), animate from a description (Motion), transcripts, show notes & speech from text (Audio), summaries &
  “Ask this PDF” (PDF), palettes from a description (Color).

## Privacy

What is sent: your request, a text summary of the open document (for example layer names and sizes, or the
text of the current PDF page) and, if enabled, a downscaled snapshot. It goes **only** to the AI you picked,
through that vendor's own tool, under that vendor's privacy policy. With Ollama or another local server,
nothing leaves your computer. Ultima has no servers, accounts, analytics or telemetry.

## A note on terms

Each tool runs under its vendor's terms, and your plan's normal usage limits apply. Ultima shows a notice
with a link to those terms before you enable a subscription tool.

**Claude Code:** Anthropic's Claude Code legal notes say that third-party developers should use API-key
authentication for their products and must not route requests through Free, Pro or Max plan credentials on
behalf of their users. Ultima only starts the unmodified `claude` program you installed and signed in to
yourself, on your own computer, and never touches your credentials — but Anthropic has not explicitly
confirmed that this use is allowed. Please read
[the terms](https://code.claude.com/docs/en/legal-and-compliance) and decide for yourself; if in doubt, use
another tool or a free local model.

OpenAI, Google and GitHub document non-interactive use of their CLIs (`codex exec`, `agy -p`, `gemini -p`,
`copilot -p`) for scripting and automation.

## Custom command

Any other AI CLI can be used: **Settings → AI connections → Custom command**. Enter the program and its
arguments; Ultima sends the prompt on standard input and reads the answer from standard output. Ultima asks
for confirmation (a system dialog) before it stores a program to run.

## Troubleshooting

| Message | What to do |
| --- | --- |
| *… is not installed or not on PATH* | Install the tool, restart Ultima, or set the program path in Settings. |
| *Not logged in / Please run /login / Auth method* | Sign in once in a terminal (see above), then press **Check again**. |
| *usage limit / quota / rate limit* | Your plan's limit was reached. Wait for the reset time shown, or switch to another AI in the panel's picker. |
| *rejected the command-line options* | Update the tool to its latest version. |
| The answer ignores my image | The selected AI or model can't see images (for Ollama pull a vision model such as `gemma3`). |
| *Antigravity CLI is not signed in* | Run `agy` once in a terminal and sign in with your Google account, then press **Check again**. |
| *Your Google AI plan has reached its limit* | Wait until the quota resets — `agy -p "/usage"` shows when — or pick another generator. |
| *Antigravity finished without creating an image* | Update it (`agy update`) and check that your Google AI plan includes image generation. |
| *The AI did not answer with an SVG drawing* | Try again, describe a simpler picture, or choose a stronger AI under *AI that draws*. |
| *Codex finished without creating an image* | Update Codex (`npm install -g @openai/codex`) and check that your ChatGPT plan includes image generation. |
| *ComfyUI has no checkpoint model yet* | Put a `.safetensors` checkpoint into `ComfyUI/models/checkpoints` and restart ComfyUI. |
| *No speech program was found* | Linux: `sudo apt install espeak-ng`. Or install Piper and choose a voice in **Settings → Speech**. |
| Slow answers | Agent CLIs take a few seconds to start. Pick a faster model (Sonnet/Haiku, Flash) or a small local model. Increase **Time limit per request** for big jobs. |
