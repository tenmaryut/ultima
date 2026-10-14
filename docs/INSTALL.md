# Download & install Ultima

🇮🇩 Bahasa Indonesia: [docs/id/INSTALL.md](id/INSTALL.md)

Ultima is free. Every installer is built automatically from the public source code by
[GitHub Actions](../.github/workflows/release.yml) and published on the
[Releases page](https://github.com/tenmaryut/ultima/releases/latest).

| System | File | Notes |
| --- | --- | --- |
| Windows 10/11 (most PCs) | `Ultima-Setup-x64.exe` | Installer |
| Windows on ARM (Snapdragon) | `Ultima-Setup-arm64.exe` | Installer |
| Windows, no install | `Ultima-Portable-x64.exe` | Runs from any folder or USB stick |
| macOS 12+ with Apple Silicon (M1–M4) | `Ultima-mac-arm64.dmg` | |
| macOS 12+ with Intel | `Ultima-mac-x64.dmg` | |
| Linux, any distribution | `Ultima-linux-x86_64.AppImage` / `Ultima-linux-arm64.AppImage` | |
| Ubuntu, Debian, Mint, Pop!_OS | `Ultima-linux-amd64.deb` / `Ultima-linux-arm64.deb` | |
| Fedora, openSUSE, RHEL | `Ultima-linux-x86_64.rpm` | |
| Linux, manual | `Ultima-linux-x64.tar.gz` / `Ultima-linux-arm64.tar.gz` | |

Direct link to the newest file: `https://github.com/tenmaryut/ultima/releases/latest/download/<file name>`.

**Requirements:** a 64-bit computer, 4 GB RAM (8 GB+ recommended for video), about 500 MB of disk space,
and a graphics driver with WebGL 2 (any computer from the last ~8 years).

---

## Windows

1. Download **`Ultima-Setup-x64.exe`** (or `Ultima-Setup-arm64.exe` for ARM laptops).
2. Double-click it. If **Windows SmartScreen** shows *“Windows protected your PC”*, click
   **More info → Run anyway**. This appears because the installer is not code-signed yet
   (code-signing certificates cost money; the project is free).
3. Choose the install folder and finish. Ultima appears in the Start menu and on the desktop.

**Portable version:** download `Ultima-Portable-x64.exe` and run it — nothing is installed.

**Uninstall:** Settings → Apps → Installed apps → Ultima → Uninstall.

## macOS

1. Pick the right file: Apple menu  → **About This Mac**. *Chip: Apple M…* → `Ultima-mac-arm64.dmg`;
   *Processor: Intel* → `Ultima-mac-x64.dmg`.
2. Open the `.dmg` and drag **Ultima** into **Applications**.
3. **First launch:** in Applications, **right-click (or Control-click) Ultima → Open → Open**.
   macOS asks this once because the app is not notarized by Apple (that needs a paid developer account).
   - macOS 15 Sequoia and newer: if there is no *Open* button, go to **System Settings → Privacy & Security**,
     scroll down to *“Ultima was blocked…”* and click **Open Anyway**.
   - If macOS says *“Ultima is damaged and can't be opened”*, open **Terminal** and run:
     ```bash
     xattr -dr com.apple.quarantine /Applications/Ultima.app
     ```
4. When you record audio or video, macOS asks for microphone/camera permission — click **Allow**.

**Uninstall:** drag Ultima from Applications to the Trash. Settings live in
`~/Library/Application Support/Ultima` (delete that folder to reset everything).

## Linux

### AppImage (any distribution)
```bash
chmod +x Ultima-linux-x86_64.AppImage
./Ultima-linux-x86_64.AppImage
```
- Ubuntu 22.04+ needs FUSE 2 for AppImages: `sudo apt install libfuse2t64` (24.04) or `sudo apt install libfuse2` (22.04).
- If it exits immediately with a sandbox error on Ubuntu 24.04+, run it once with
  `./Ultima-linux-x86_64.AppImage --no-sandbox`, or install the `.deb` instead.
- Optional desktop integration: use [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher.

### Debian / Ubuntu / Mint (.deb)
```bash
sudo apt install ./Ultima-linux-amd64.deb
```
Uninstall: `sudo apt remove ultima`

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

## Browser version (no install)

A browser build is published at **https://tenmaryut.github.io/ultima/app/** when GitHub Pages is
enabled for the repository. All editors work in Chrome, Edge or other Chromium browsers.
Limits: the subscription AI tools (Claude Code, Codex, Antigravity CLI, Copilot…) need the desktop app,
because a web page can't start programs on your computer. Free local AI via Ollama works if you start
Ollama with `OLLAMA_ORIGINS=https://tenmaryut.github.io`.

## Build from source

You need [Node.js 22](https://nodejs.org) and [Git](https://git-scm.com).

```bash
git clone https://github.com/tenmaryut/ultima.git
cd ultima
npm install          # also downloads Electron
npm run dev          # start the app with hot reload
```

Make installers for your own system:

```bash
npm run dist         # → release/
# or one platform explicitly:
npm run dist:win     # on Windows
npm run dist:mac     # on macOS
npm run dist:linux   # on Linux (rpm needs: sudo apt install rpm)
```

Browser build: `npm run build:web` → `dist-web/` (serve it with any static web server).

## Updating

Download the newest installer and install it over the old version — your settings, AI connections and
recent files are kept. Watch the repository (**Watch → Custom → Releases**) on GitHub to get notified.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Blank or flickering window | Start with GPU acceleration off: Windows `Ultima.exe --disable-gpu`, macOS `open -a Ultima --args --disable-gpu`, Linux `ultima --disable-gpu`. Update your graphics driver. |
| AI tool shows “Not found” although it's installed | Restart Ultima after installing the tool. If it still isn't found, use **Settings → AI connections → How to install → Set program path** and pick the program (find it with `which claude` on macOS/Linux or `where claude` on Windows). |
| “Not logged in” from an AI tool | Open a terminal and sign in once (see [AI_SETUP.md](AI_SETUP.md)), then press **Check again**. |
| Video export says H.264 isn't available | Export WebM, or install [FFmpeg](https://ffmpeg.org/download.html) and use “Convert to MP4 with FFmpeg”. |
| Where are my settings? | Windows `%APPDATA%\Ultima`, macOS `~/Library/Application Support/Ultima`, Linux `~/.config/Ultima`. |

Still stuck? [Open an issue](https://github.com/tenmaryut/ultima/issues/new/choose) with your OS version and what you clicked.
