# Ultima user guide

🇮🇩 Bahasa Indonesia: [docs/id/PANDUAN.md](id/PANDUAN.md)

Ultima is one app with ten tools. This guide explains the parts they share, then each tool.
New here? Install it first ([INSTALL.md](INSTALL.md)), then optionally connect an AI ([AI_SETUP.md](AI_SETUP.md)).

- [The window](#the-window)
- [Opening, saving and exporting](#opening-saving-and-exporting)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [The AI assistant](#the-ai-assistant)
- [Settings](#settings)
- Tools: [Photo Editor](#photo-editor) · [Photo Develop](#photo-develop) · [Vector Designer](#vector-designer) ·
  [Layout & Publishing](#layout--publishing) · [Video Editor](#video-editor) · [Motion Graphics](#motion-graphics) ·
  [Audio Editor](#audio-editor) · [PDF Studio](#pdf-studio) · [Color Studio](#color-studio) · [AI Studio](#ai-studio)
- [Tips & troubleshooting](#tips--troubleshooting)

## The window

```
┌────┬──────────────────────────────────────────────────────────────┬──────────┐
│ U  │  Tool name — document   File Edit Image …   [tool options]  ✨ │          │
│    ├────┬────────────────────────────────────────────┬──────────┤  AI      │
│ 🖼  │ T  │                                            │ Panels   │  assist- │
│ ⦿  │ o  │              Canvas / preview              │ (layers, │  ant     │
│ ✒  │ o  │                                            │ props…)  │          │
│ …  │ l  │                                            │          │          │
│    │ s  ├────────────────────────────────────────────┴──────────┤          │
│ ⚙  │    │  Timeline (Video, Motion, Audio)                        │          │
└────┴────┴─────────────────────────────────────────────────────────┴──────────┘
```

- **Rail (far left):** switch tools. Each tool keeps its document open while you use another one, so you
  can, for example, cut a video, jump to the Photo Editor to fix a thumbnail and come back.
- **Header:** the tool's menus (File, Edit, …), options for the current tool, and the ✨ button for the AI assistant.
- **Left palette:** drawing/selection tools. Hover a button to see its name and shortcut letter.
- **Right panels:** layers, properties, history and other panels. Click a panel title to fold it.
- **Status bar:** zoom, sizes, cursor position and other details.
- **Home** (logo at the top of the rail, or **Ctrl/⌘ + Shift + H**): open files, recent files and all tools.

**Zoom and pan.** In the canvas tools (Photo, Develop, Vector, Layout, Motion, PDF): **Ctrl/⌘ + mouse wheel**
or pinch to zoom, the wheel to scroll, hold **Space** and drag (or drag with the middle mouse button) to pan,
**Ctrl/⌘ + 0** to fit and **Ctrl/⌘ + 1** for 100%. In the timeline tools (Video, Audio) **Space** plays and
pauses instead; **Ctrl/⌘ + wheel** zooms the timeline and **Ctrl/⌘ + 0** fits it. Small differences are listed
in each tool's section.

## Opening, saving and exporting

- **Open:** *Home → Open file…*, **Ctrl/⌘ + O** inside a tool, or drag files onto the window. Ultima picks
  the right tool from the file type: images and `.psd` → Photo Editor, camera RAW and TIFF → Photo Develop,
  `.svg` → Vector Designer, video → Video Editor, audio → Audio Editor, `.pdf` → PDF Studio,
  `.ase`/`.gpl` palettes → Color Studio, `.ultima` → the tool that saved it.
- **Save (Ctrl/⌘ + S)** stores an editable **Ultima project** (`.ultima`) with layers, timelines and
  settings. The first save asks where; later saves overwrite the same file (in the browser version you choose
  a place each time). **Save As** = **Ctrl/⌘ + Shift + S**. Two exceptions: PDF Studio's Save writes the PDF
  itself, and AI Studio saves chats automatically.
- A **•** after the document name means unsaved changes. If you close Ultima while any tool has unsaved
  changes, it asks before closing.
- **Export (Ctrl/⌘ + E)** produces a normal file for sharing: PNG/JPG/WebP/PSD, SVG/PDF, MP4/WebM/GIF,
  WAV/MP3, and so on. Export options depend on the tool.
- **Send to another tool:** an image from AI Studio opens in the Photo Editor, an SVG drawing in the Vector
  Designer, chat text becomes a text frame in Layout, a text layer in Motion or a title in the Video Editor, and
  a Color Studio palette becomes swatches in Vector, theme colors in Layout or new colors for Motion layers.

## Keyboard shortcuts

On macOS use **⌘** where this guide says **Ctrl**.

| Action | Shortcut |
| --- | --- |
| Open / Save / Save as / Export | Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+E |
| New document | Ctrl+N |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z (Windows/Linux also Ctrl+Y) |
| Delete selection | Delete or Backspace |
| Duplicate | Ctrl+D |
| Select all / Deselect | Ctrl+A / Ctrl+Shift+A |
| Zoom in / out / fit / 100% | Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+1 (timeline tools: see their sections) |
| Pan | Space + drag, or middle mouse drag |
| AI assistant on/off | Ctrl+J |
| Home / Settings | Ctrl+Shift+H / Ctrl+, |

Each tool adds single-key tool shortcuts (shown in the tooltips and listed below), e.g. **V** move, **B** brush,
**T** text. They don't fire while you type in a text field.

## The AI assistant

Every editor has an assistant panel (✨ or **Ctrl/⌘ + J**). It needs one AI connection — see
[AI_SETUP.md](AI_SETUP.md); free local models work too.

1. Type what you want in your own words, in any language: *“make the photo warmer and add a soft vignette”*,
   *“add a title SUMMER SALE at the top in bold white”*, *“remove the silences longer than one second”*.
2. The assistant replies with a short message and a list of **edit steps**. Expand *N edit steps* to see them.
3. Press **Apply**. All steps of one reply become **one undo step**, so Ctrl+Z reverts the whole change.

Good to know:

- Pick which AI answers with the selector at the top of the panel.
- The 📷 button sends a small snapshot of your canvas so the AI can see your work (only to AIs that support
  images). Switch it off for private documents.
- **Settings → AI behaviour → Apply AI edits automatically** skips the review step.
- The assistant can only do what the tool offers as edit steps (each tool's section lists them); if it can't do
  something it says so. Most tools also have an **AI** menu with bigger helpers (design from a brief, auto
  captions, summarize a PDF…).
- Answers from subscription tools take a few seconds because the tool starts for each request.
- AI Studio has no assistant panel — the chat itself is the AI.

## Settings

- **General:** language (English / Bahasa Indonesia), theme (dark, light, follow system) and color gradient
  (Ultima, Ocean, Sunset, Forest, Aurora, Rose, Graphite). The gradient colors the logo, the thin line along the
  top of the window, the Home banner and the buttons on Home and in Settings. Each tool keeps its own color unless
  you turn on *Use the gradient’s color in every tool too*.
- **AI connections:** install instructions, status, on/off switch, model, Test button and program path for
  every AI tool; default AI; custom command.
- **AI behaviour:** automatic apply, canvas snapshots, *never bill an API key*, time limit per request.
- **Image generation:** the generator for AI Studio → Images and Photo → Generate Image — Stable Diffusion WebUI,
  ComfyUI, a local OpenAI-style image server such as LocalAI, Antigravity with your Google AI plan, Codex with your
  ChatGPT plan, or *SVG drawing by your AI* (any connected AI, for example Claude) — its address, model or AI and a
  *Check* button. See [AI_SETUP.md](AI_SETUP.md#image-generation).
- **Speech (text to speech):** engine (system voices, Piper or a custom command), speed, Piper voice (*Choose
  voice…*) and the custom command (desktop app). See [AI_SETUP.md](AI_SETUP.md#text-to-speech).
- **Local creative tools:** whether Whisper, rembg and FFmpeg were found (with *Set path* for Whisper and rembg;
  FFmpeg must be on your `PATH`).
- **About:** version, license and links.

## Photo Editor

*Like Photoshop: layers, selections, retouching and filters for photos and graphics.*

**Start.** Open an image (PNG, JPG, WebP, GIF, BMP, AVIF, ICO, SVG or PSD) or press **New…** and pick a
preset (HD, 4K, A4 300 dpi, Instagram post, Story, YouTube thumbnail) or a custom size with a white,
transparent or colored background. Each open document gets a tab.

**Tools** (key in brackets; pressing Shift with the key switches between related tools):
Move (V) · Marquee (M) · Lasso (L) · Magic Wand (W) · Crop (C) · Eyedropper (I) · Spot Healing Brush (J) ·
Clone Stamp (S) · Brush (B) / Pencil (Shift+B) · Eraser (E) · Paint Bucket (G) / Gradient (Shift+G) ·
Dodge / Burn / Sponge (O) · Blur / Sharpen (R) · Text (T) · Shapes (U) · Hand (H) · Zoom (Z).
While painting: **[** / **]** brush size, **Shift+[** / **Shift+]** hardness, **1**…**0** opacity 10–100%,
**X** swaps the colors, **D** resets them.

**Layers and masks.** The Layers panel has blend mode (17 modes), opacity, show/hide, lock, drag to reorder
and double-click to rename. Ctrl-click a thumbnail to select the layer's pixels. *Add Layer Mask*, then click
the mask thumbnail and paint on it: black hides, white reveals (Shift-click the mask to switch it off).
Properties → *Layer effects*: drop shadow, stroke, outer glow. Layers are pixel, text or shape layers
(no groups or adjustment layers).

**Selections.** Marquee (rectangle/ellipse; Normal, Fixed ratio, Fixed size), Lasso (freehand or polygonal —
click points, double-click or Enter to close), Magic Wand (Tolerance, Contiguous, Sample all layers). Hold
Shift to add, Alt to subtract, Shift+Alt to intersect. *Select* menu: All, Deselect (Ctrl+Shift+A),
Inverse (Ctrl+Shift+I), Feather, Expand, Contract.

**Adjustments and filters.** *Image → Adjustments*: Brightness/Contrast, Levels (Ctrl+L), Curves (Ctrl+M),
Exposure, Vibrance, Hue/Saturation (Ctrl+U), Color Balance (Ctrl+B), Black & White, Photo Filter, Invert,
Posterize, Threshold, Desaturate, plus Auto Tone / Contrast / Color. *Filter*: Gaussian and Motion Blur,
Sharpen, Unsharp Mask, Add Noise, Reduce Noise, Emboss, Find Edges, Oil Paint, Pixelate, Vignette, Film Grain,
High Pass. Every dialog has a live Preview. They change the pixels of the active layer (inside the selection,
if there is one), so duplicate the layer first (Ctrl+D) if you want to keep the original.

**Crop and transform.** Crop tool: ratio presets (1:1, 4:5, 16:9…) and Straighten; Enter applies, Esc resets.
*Edit → Free Transform* (Ctrl+T): drag the handles to scale, drag outside the box to rotate (Shift: free
aspect / 15° steps, Alt: from the center), Enter applies. *Image*: Image Size, Canvas Size, Image Rotation,
Crop to Selection.

**Retouching.** Spot Healing Brush: paint over spots and blemishes. Clone Stamp: Alt-click to pick the source,
then paint. Dodge/Burn/Sponge lighten, darken or (de)saturate where you paint.

**Text and shapes.** Text tool: click and type; finish with Esc, Ctrl+Enter or a click outside; double-click
text later to edit it. Font, size, weight, color, alignment and spacing are in the Properties panel. The Shapes
tool draws shapes that stay editable.

**AI.** The assistant can adjust brightness, contrast, exposure, temperature, saturation and more, apply
filters, add text, crop, resize, rotate, flip, fill, add layers, auto-enhance and remove the background.
The **AI** menu has:
- **Remove Background** — uses the free rembg tool (desktop app; see [AI_SETUP.md](AI_SETUP.md)). Without it,
  Ultima offers *Remove Uniform Background*, which works for plain backgrounds without AI.
- **Generative Fill…** — select an area, then describe what should appear there (leave it empty to remove what
  is there). Needs a local Stable Diffusion WebUI.
- **Generate Image…** — creates a picture from a description with the generator chosen in Settings → Image
  generation (Stable Diffusion, ComfyUI, a local image server, Antigravity with your Google AI plan, Codex with your
  ChatGPT plan, or an SVG drawing by your AI). The result is added as a new layer, or opens as a new document.
- **Describe / Alt Text…** — writes a description of the image (needs an AI that understands images).
- **Auto-Enhance** — automatic tone and vibrance (no AI needed).

**Files.** *Save Project* (Ctrl+S) keeps layers, masks, text and effects editable. *Export…* (Ctrl+E): PNG,
JPG or WebP (quality and scale) or PSD (layers, masks, blend modes and visibility are kept; text and shapes
are rasterized). PSD files open with their layers (groups are flattened, adjustment layers are dropped).

**Good to know.** Delete with nothing selected deletes the active layer (Ctrl+Z brings it back). Images can be
up to 16,000 px per side. HEIC photos aren't supported — export them as JPEG first.

## Photo Develop

*Like Lightroom: non-destructive editing, presets and batch export for whole photo shoots.*

**Start.** Drop photos onto the window or press **Import Photos…** (Ctrl+O): JPEG, PNG, WebP, AVIF, GIF, BMP,
TIFF and camera RAW files. Your edits are stored as settings; the original files are never changed. There are
two views: **Library** (G) and **Develop** (D). JPEG and PNG files opened from Home go to the Photo Editor —
to develop them, use Import here.

**Library.** Rate with **0**–**5**, color labels with **6**–**9**, **P** pick, **X** reject, **U** unflag.
The filter bar searches and filters by rating, flag, label or edit state; the Catalog list on the left has
All photographs, Picked, Rejected, Unrated, 3 stars and up, Edited. *Quick Develop* on the right applies
presets, exposure steps, Auto Tone and Auto WB to all selected photos. Enter opens a photo in Develop.

**Develop panels.** Histogram · **Basic** (Color or Black & White, white balance with the picker **W**, Exposure,
Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation) · **Tone Curve** ·
**HSL / Color** (eight color ranges) · **Color Grading** (shadows, midtones, highlights) · **Detail**
(sharpening, noise reduction) · **Effects** (vignette, grain) · **Transform & Crop** (**R**: aspect,
straighten, overlays). Double-click a slider's name to reset it, or type a value; ↺ resets a whole section.

**Compare.** **\\** switches Before/After, **Y** shows a split view with a movable divider, **J** marks clipped
highlights (red) and shadows (blue). **Z** or a click switches between fit and 100%. **←**/**→** move to the
previous/next photo.

**Presets.** 17 built-in looks (Vivid, Portrait Soft, Film Warm, Cinematic Teal & Orange, B&W Classic, Sepia…):
hover to preview, click to apply, **+** saves your current settings as your own preset.

**Many photos at once.** Select photos in the Library, then *Copy Settings* (Ctrl+Shift+C) and *Paste Settings*
(Ctrl+Shift+V), or *Sync Settings…* and tick the groups to copy. *Create Virtual Copy* (Ctrl+D) makes another
version of the same photo with its own edits.

**AI.** The assistant can set or nudge sliders, change the tone curve, apply presets, Auto Tone / Auto WB, crop,
straighten, rotate, reset and rate — say *“for all selected photos”* to apply it to the selection. *AI* menu:
**AI Auto Edit Selected…**, **Describe a Look…** (turns *“moody film look with faded blacks”* into settings,
which you can save as a preset) and **Suggest Ratings…** (needs an AI that understands images; you review the
suggestions before they are applied).

**Export** (Ctrl+E): JPEG, PNG or WebP; quality; full size or resized by long edge, short edge or megapixels;
a file-name template ({name}, {n}, {date}, {rating}, {width}, {height}); keep camera EXIF data (JPEG). Several
photos are saved together as one ZIP.

**Catalog.** *Save Catalog* (Ctrl+S) stores your ratings and edits in a `.ultima` file. When the photos total
300 MB or less you can embed them in it; otherwise leave the originals where they are — moved files show as
*Missing* until you use *Locate Missing Files…*.

**Good to know.** For RAW files Ultima uses the full-size JPEG preview that the camera stores inside the file
(true RAW processing isn't available yet). HEIC/HEIF isn't supported — export as JPEG first (iPhone: Settings →
Camera → Formats → Most Compatible). Develop needs WebGL 2 (any graphics driver from recent years).
Adjustments apply to the whole photo; use the Photo Editor for local retouching.

## Vector Designer

*Like Illustrator: logos, icons and illustrations made of shapes and paths.*

**Start.** Opens on a 1080 × 1080 artboard. *New…* (Ctrl+N) offers A4, Letter, 1080 × 1080, 1920 × 1080,
Logo 512 × 512, Icon 24 × 24, Business card or a custom size, with a white, transparent or colored background.

**Tools:** Selection (V) · Direct Selection (A) · Pen (P) · Pencil (N) · Rectangle (M) · Ellipse (L) · Polygon ·
Star · Line (\\) · Text (T) · Eyedropper (I) · Hand (H) · Zoom (Z). **X** switches between fill and stroke,
**Shift+X** swaps them, **D** resets them, **/** sets None. Arrow keys nudge by 1 px (Shift: 10 px).

**Drawing.**
- Shapes: hold Shift for a square or circle, Alt to draw from the center; a single click makes a 100 × 100 shape.
- Pen: click for corners, drag for curves, click the first point to close the path; Enter or Esc finishes;
  Shift snaps to 45°. With a path selected, click a segment to add a point or a point to remove it.
- Direct Selection: drag points and handles, use the Corner / Smooth buttons, double-click a segment to add a
  point. Shapes turn into paths when you edit their points.
- Double-click a group to work inside it (Esc leaves it); double-click text to edit it.

**Color and appearance** (Properties panel): fill and stroke as a solid color or a linear/radial gradient
(click the gradient bar to add stops), stroke width, dashes, caps, joins and position, opacity, 16 blend modes,
drop shadow and blur. The Swatches tab keeps the document's colors.

**Arranging.** *Object* menu: Group (Ctrl+G), Arrange (Ctrl+[ and Ctrl+]), Align and Distribute (to the
selection or the artboard), flip and rotate, Lock (Ctrl+2), Hide (Ctrl+3), Convert to path, Outline stroke,
Put text on path. *Pathfinder*: Unite, Minus front, Intersect, Exclude. The Layers tab reorders, groups, hides
and locks objects; the Artboards tab adds, duplicates, renames and deletes artboards. *View*: grid, snap to
grid, smart guides, outline mode.

**AI.** The assistant can add and change shapes, paths and text, recolor, align, group, insert SVG artwork and
resize the artboard. *AI* menu: **Generate artwork…** (describe it and pick a style), **Logo ideas…** (four
logo concepts for a brand name), **Recolor artwork…** (suggested palettes) and **Name layers**.

**Files.** *Save* (Ctrl+S) as `.ultima`. *Place SVG or image…*, drag and drop, or paste SVG code.
*Export…* (Ctrl+E): SVG, PNG, JPG (1×/2×/4×, transparent background) or PDF (one page per artboard) — the
current artboard, all artboards (a ZIP for PNG/JPG/SVG) or only the selection (SVG).

**Good to know.** Text can't be converted to outlines yet, and text is point text (Enter starts a new line;
there are no text boxes that wrap). SVG exports keep text as live text, so the font must be installed wherever
the SVG is used. SVG features Ultima can't edit (masks, filters, patterns) are imported as fixed *SVG content*.
The desktop app exports vector PDFs; the browser version exports PDF pages as images.

## Layout & Publishing

*Like InDesign and Adobe Express: posters, flyers, social posts, documents and print-ready PDFs.*

**Start.** *What do you want to make?* offers blank formats (A4, Letter, Instagram post and story, Presentation
16:9, YouTube thumbnail, Business card, Poster) and 15 templates: Event poster, Sale flyer, Instagram post,
Instagram story, YouTube thumbnail, Business card, Resume / CV, Newsletter, Invitation, Certificate, Restaurant
menu, Presentation deck, Open house flyer, Facebook cover and LinkedIn banner. Ctrl+N opens the template picker
again; *New blank document…* sets the size, units, pages, columns, margins, bleed and facing pages.

**Tools:** Select (V) · Text frame (T) · Image frame (F) · Rectangle (R) · Ellipse (E) · Line (L) · Table ·
Hand (H, or hold Space). Enter edits the selected text frame; arrow keys nudge.

**Text.** Double-click a text frame (or press Enter) to type. Paragraph styles in the *Styles* tab (Title,
Subtitle, Heading 1 and 2, Body, Caption, Quote, Label): click to apply; when a frame differs from its style,
*Modified* offers Reset and Update style. The *Design* tab sets font, weight, size, bold/italic/underline/all
caps, alignment, line spacing, tracking and space after, plus the frame's columns, inset, vertical alignment,
fill and border. Formatting applies to a whole frame (mixed formatting inside one frame isn't possible yet).

**Text that doesn't fit.** A **+** marker on the frame and *“1 text frame(s) overflow”* in the status bar show
hidden text. Enlarge the frame, or press **Link** (or *Object → Continue text in another frame…*) and click the
frame that should continue the text; **Add frame** creates one (on the next page if needed). For page numbers
type `{page}` or `{pages}`.

**Pages.** The pages strip at the bottom adds, duplicates, deletes and reorders pages (PgUp/PgDn move between
them). The **master page** (*Page → Edit master page*) holds items that appear on every page, such as a footer
with `{page}`. *View* switches between single page and continuous scroll and shows guides, margins, rulers
(drag from a ruler to make a guide) and the bleed area.

**Images and shapes.** Draw an image frame (F) to pick a picture, or drop/paste images onto the page. Fit:
Fill frame (crop), Fit inside frame, Stretch, Original size; zoom and position the picture, or press *Adjust*
and drag it inside its frame. Shapes can become a triangle, diamond or star and take gradient fills. Tables
have a header row, banding and lines.

**Theme colors.** The *Styles* tab has six theme colors (Text, Background, Primary, Secondary, Neutral,
Highlight) and ready palettes (Ocean, Sunset, Forest, Coffee…). Colors picked from the theme change when the
theme changes.

**AI.** **AI design** in the header (*AI → Design from a brief…*): describe what you need (*“a poster for a jazz
night on 12 May, dark and elegant”*) and choose a new page, the current page or a new document.
**Rewrite selected text…** (shorten, more formal, catchier, translate EN ↔ ID, fix grammar, expand) and
**Generate copy…** (headline, subheadline, body and call to action). The assistant can add and change frames,
text, shapes, pages, backgrounds, theme colors and paragraph styles. The AI adds placeholders for pictures; it
doesn't generate photos.

**Export** (Ctrl+E): PDF (all pages, the current page or a range like `1-3, 5`; bleed and crop marks), PNG or
JPG (72–600 dpi, or a scale for pixel-based documents; several pages become a ZIP), or Print. The desktop app
makes vector PDFs with selectable text; the browser version makes PDF pages from images.

**Good to know.** Fonts aren't stored in the project; if a font is missing on another computer, a similar one is
used. Locked or hidden frames are selected in the *Layers* tab. Pictures are stored inside the `.ultima` file
(very large ones are scaled down to 6000 px).

## Video Editor

*Like Premiere Pro: cut, title, caption and export videos.*

**Start.** *Import media…* or drop files: video (MP4, WebM, MOV, MKV, M4V, OGV, AVI, 3GP), audio, images and
SRT/VTT captions. Double-click a file in the *Media* tab to insert it at the playhead, or drag it onto the
timeline. *New project* (Ctrl+N) and *Project settings…*: 1080p, 720p, 4K, Vertical 9:16, Square 1:1 or a
custom size, 24–60 fps, background color. If you didn't choose a size, the first video you add sets it.

**Timeline.**
- Selection tool (V) and Razor tool (C). **S** (or Ctrl+K) splits at the playhead, **Shift+Delete** is ripple
  delete, **N** toggles snapping, **M** adds a marker, **I**/**O** set in and out points.
- Drag a clip to move it (it replaces whatever it lands on), drag its edges to trim. Shift- or Ctrl-click adds
  to the selection; drag on an empty area for a box selection. Link/Unlink clips keeps video and its sound together.
- *+ Track* adds video, audio and caption tracks; track headers hide, mute, solo and lock tracks.
- Playback: **Space** plays/pauses, **J**/**K**/**L** shuttle backward/stop/forward (press again for 2×, 4×,
  8×), **←**/**→** one frame (Shift: one second), **↑**/**↓** previous/next cut, Home/End.
- Zoom: Ctrl+wheel or Ctrl+= / Ctrl+- on the timeline, **Ctrl+0** fits the whole timeline. The preview has a
  Fit/25/50/100% menu; **Ctrl+1** toggles 100%.

**Inspector** (select a clip): start and duration; Transform (position, scale, rotation, opacity, crop — or drag
the clip in the preview); Speed 0.25–4× with *Keep audio pitch*; volume and audio fades; opacity fades;
Transition in (Cross dissolve, Dip to black/white, Wipe, Slide, Zoom); Color & blur (brightness, contrast,
saturation, temperature, hue, blur); Chroma key for green or blue screens.

**Keyframes, speed curves and freeze frames.**
- Click **◆** next to position, scale, rotation, opacity, a color value, blur or volume to add a keyframe at the
  playhead. Once a value has keyframes, changing it at another time (or dragging the clip in the preview) adds
  another one. The keyframe bar at the top of the inspector jumps to the previous/next keyframe, sets the easing of
  the keyframe at the playhead (Linear, Ease in, Ease out, Ease in-out, Hold) and removes all keyframes. Keyframes
  show as small diamonds on the clip in the timeline.
- *Speed curve* (Inspector → Speed, or right-click a clip): Montage hit (fast → slow-mo → fast), Slow-mo in the
  middle, Speed up in the middle, Slow to fast and Fast to slow. *A new curve keeps* the clip length (cuts stay on
  the beat) or all content (the clip gets longer or shorter and the clips after it move).
- *Play backwards* reverses a clip and its sound. *Smooth slow motion* blends neighbouring frames on export when a
  clip plays slower than it was recorded. *Freeze frame at the playhead* holds that frame for one second and moves
  everything after it.

**Effects, color grading and compositing** (Inspector):
- *Effects*: camera shake (strength and speed), glow, RGB split, motion blur (with direction), zoom blur, vignette,
  sharpen, film grain and letterbox (2.39:1, 2:1, 1.85:1 or any height). Every effect can be animated with ◆, for a
  punch on a beat.
- *Color grade*: a look (Cinematic, Teal & orange, Warm, Cool, Vintage, Faded film, Black & white, Noir, Sepia,
  Vivid, Cyberpunk, Moody, Golden hour, Bleach bypass, Pastel, Day for night) with a strength; a LUT — *Import…*
  a `.cube` file (also *File → Import LUT (.cube)…* or drop it on the window); tone curves for RGB, red, green and
  blue (click to add a point, drag it, double-click to remove it); and *Color ranges (HSL)* to change the hue,
  saturation and luminance of reds, oranges, yellows, greens, aquas, blues, purples or magentas only.
- *Blend mode* (Multiply, Screen, Overlay, Soft light, Add and more) and *Mask* (rectangle, ellipse or a straight
  split, with feather and invert; it moves with the clip).
- *Transition out* animates a clip away at its end. New transitions: Flash, Whip pan left/right, Spin, Zoom blur,
  Glitch, Luma fade and Blur dissolve.
- **Adjustment layer** (*Titles* tab, or *Timeline → Add adjustment layer*): a clip without a picture whose look,
  color, effects, mask and transform apply to everything on the tracks below it — one grade, one shake or one
  letterbox for the whole video.

**Sound effects and ducking** (Inspector → *Sound effects*, for audio clips and a video's sound): presets (Muffled,
Underwater, Phone call, Old radio, Small room, Big hall, Cave, Bass boost, Clear voice, Lo-fi), low cut, high cut
(the muffle — animatable with ◆, e.g. muffled right after an explosion), bass, mids, treble and reverb with room
size. You hear them while editing and they are in the export. **Auto ducking** lowers a clip (usually the music)
wherever the other sound — voice or game audio — is loud, by writing volume keyframes you can still adjust.

**Titles and captions.** *Titles* tab: Basic title, Lower third, Big bold, Bottom text, Typewriter, Pop label and
End card — click or drag one onto the timeline, then edit its text, font, colors, outline, background and
animation (Fade, Slide up, Pop, Typewriter). *Captions* tab: add captions by hand, import or export SRT/VTT,
set the caption style, or create them with **Auto captions…**.

**AI.** The *AI tools* menu:
- **Auto captions…** — transcribes the speech with Whisper on your own computer (desktop app), in many languages.
- **Remove silences…** — finds pauses (threshold, minimum length, padding), shows them in red and removes them
  on all unlocked tracks (this is audio analysis, no AI needed).
- **Write titles & description…** — YouTube titles, a description, chapters (can be added as markers) and tags.
- **Rough cut from transcript…** — suggests cuts based on the captions.
- **Voice-over from text…** — type a script, choose a voice, listen, then *Add to timeline*: the speech is placed at
  the playhead on a free audio track, so it never cuts the sound already there (desktop app; see [Text to speech](AI_SETUP.md#text-to-speech)).

**The assistant** (AI panel) reads the whole timeline — every clip, Media bin item (with its id), marker, track and
font — and, with an AI that accepts pictures, sees the frame at the playhead plus frames from every clip. It can ask
to *look* at exact moments before it cuts. Ultima also analyses the sound and picture of your media for it: tempo
(BPM), beats and bar starts, the strongest hits, loud moments (gunshots, impacts, cheers) and bursts of them, and
scene changes — so it can cut on the beat or build a montage around the action (kills or headshots can't be told
apart for sure from sound alone).

It can add clips from the Media bin; split, trim, move, shift, delete and duplicate clips, close gaps and remove a
time range; link and unlink sound; change one clip, a whole track or all clips at once; animate with keyframes
(zoom, pan, shake, fades, volume, muffle); add speed curves, reverse clips and freeze frames; add effects, looks,
LUTs, curves, HSL changes, masks, blend modes and adjustment layers; add sound effects and duck the music; restyle titles; add transitions in and out; add,
move, rename and delete markers; add, mute, lock and delete tracks; set the work area; move the playhead; undo; and
open the export dialog. After you press *Apply* (or with *Apply AI edits automatically* on) the
AI is told what happened to every step, and *What happened to each step* shows you the same list.

**Export** (Ctrl+E): MP4 (H.264 + AAC) or WebM (VP9 + Opus) for the whole timeline or the work area, with
resolution, frame rate, quality or bitrate, audio and *Burn captions into the picture*; *MP4/MOV via FFmpeg*
(desktop app with FFmpeg); GIF (up to 60 s); WAV audio; or the current frame as PNG. Which encoders are available
depends on your computer; WebM always works. MP4 files have their index at the start (fast start).

**TikTok · Reels · Shorts** (*File → Export for TikTok · Reels · Shorts…*): TikTok, Instagram and YouTube
re-encode every upload — no app or file can switch that off. This export gives them the cleanest possible source so
their compression takes away as little as possible: 1080 px on the short side (1080×1920 for a 9:16 project), a
constant 30 or 60 fps, H.264 High at 16 or 24 Mbps, AAC 320 kbps and BT.709 color. Where the system has no AAC
encoder (Linux), the desktop app writes the final MP4 with FFmpeg. Choose 60 fps for 60 fps footage (set the project
to 60 fps too); clips recorded at 30 fps stay at 30. When you upload: turn on *Allow high-quality uploads* in
TikTok's *More options*, upload over Wi-Fi with Data Saver off, finish text and effects in Ultima (edits made in the
app are rendered again there), and upload the file as it is rather than sending it through a chat app first. Large
files that the phone app refuses can be uploaded from a computer at tiktok.com.

**Projects.** *Save project* (Ctrl+S) stores the edit, not the media files — keep your media where it is. If
files were moved, *Relink missing media…* finds them by name.

**Good to know.** Files your system can't preview show *No preview*; right-click → *Convert with FFmpeg*
(desktop app). Captions are burned into the picture or exported as SRT/VTT files (no subtitle track inside the
MP4). For animated text and shapes use Motion Graphics.

## Motion Graphics

*Like After Effects: animate text, shapes, images and video with keyframes.*

**Start.** A 1920 × 1080, 30 fps, 5-second composition. *New composition…* (Ctrl+N) and *Composition settings…*:
HD 1080p, 4K, Square, Vertical story, GIF 480 or a custom size; frame rate; duration; background color or
transparent.

**Tools:** Selection (V) · Anchor point (Y) · Hand (H) · Text (T) · Rectangle (R) · Ellipse (E) · Polygon · Star ·
Line (L) · Pen (P: click for corners, drag for curves, Enter to finish) · Import image, video or SVG… · New null
(to group and parent layers). *Layer → New* also adds a solid.

**Keyframes.** Select a layer, click the **stopwatch** next to a property (timeline or Properties panel), move the
playhead and change the value — Ultima adds a keyframe. You can animate anchor point, position, scale, rotation,
opacity, size, fill and stroke color, stroke width, corner radius, trim paths, tracking, text reveal and blur.
**U** shows only animated properties, **J**/**K** jump to the previous/next keyframe, **F9** applies Easy ease.
Right-click a keyframe to choose its easing (Linear, Ease In, Ease Out, Ease In-Out, Hold, Back, Elastic, Bounce),
or double-click it to edit the curve.

**Playback and timing.** Tap **Space** to play/pause (hold Space and drag to pan), **←**/**→** one frame (Shift:
10 frames), Home/End. Drag a layer's bar to move it in time and its ends to trim it (or **Alt+[** / **Alt+]** at
the playhead). **I**/**O** jump to the layer's start/end, **B**/**N** set the work area. The time field accepts
seconds, frames (`45f`) or `mm:ss:ff`.

**Presets** (*Presets* tab or right-click): Fade In/Out, Slide In from four sides, Pop In, Bounce In, Spin In,
Typewriter and Word by Word (text), Wiggle, Pulse, Float, Shake and Draw On (shapes). Presets start at the playhead.

**Text, shapes and effects.** Text: font, size, weight, fill, stroke, tracking and *Text Reveal* by characters,
words or lines. Shapes: size, corner radius, points, stroke, Trim Paths. Effects: blur, drop shadow, glow;
17 blend modes; layers can be parented to other layers or nulls.

**AI.** **Animate with AI** (*Animation → Animate from description…*): describe a scene (*“the logo pops in, then
the tagline types on”*) and the AI builds the layers and keyframes — one Undo removes it all. **Suggest easing &
timing** polishes the motion of a layer. The assistant can change the composition, add layers, set properties and
keyframes, apply presets and change easing.

**Export** (Ctrl+E): MP4, WebM, animated GIF (dithering, loop), PNG sequence (ZIP) or the current frame; the whole
composition or the work area; size, frame rate and quality. Transparency is kept in WebM, PNG and GIF.

**Good to know.** Motion graphics have no sound — add music in the Video Editor. Images and videos are stored
inside the project (videos up to 400 MB). Some keys differ from the Video Editor: J/K jump between keyframes and
L is the Line tool.

## Audio Editor

*Like Audition: clean up, edit and mix voice and music.*

**Start.** *Open file…* (WAV, MP3, OGG, FLAC, M4A, AAC, Opus, WebM, or the sound of a video file), *Record…* or
*Generate tone…*. **Generate → Speech from text…** reads a text aloud with the voice from Settings → Speech and
inserts it at the cursor (or replaces the selection; in Multitrack it becomes a new track at the playhead). *New audio file…* (Ctrl+N) asks for the sample rate and mono/stereo. Two views: **Waveform**
(edit one file) and **Multitrack** (arrange clips on tracks).

**Editing (Waveform).** Drag to select, click to place the cursor, Shift+click to extend. **Space** plays/pauses
(Shift+Space ignores the selection), **L** loops, **Esc** stops. Cut, copy, paste, *Mix paste* (Ctrl+Shift+V),
delete, *Trim to selection*, *Silence selection*, *Insert silence…*. Markers: **M** adds one, **[** / **]** jump
between them, double-click the ruler to add or rename one. Zoom: Ctrl+wheel (time), Alt+wheel (height),
**Ctrl+0** whole file, **Ctrl+1** zoom to the selection; the wheel scrolls.

**Effects** (*Effects* menu or panel; each has a Preview and applies to the selection or the whole file): Amplify,
Normalize (peak or loudness in LUFS), Fade In/Out, Parametric EQ (presets such as *Voice clarity* and *Remove
hum*), high- and low-pass filters, Compressor, Hard Limiter, Noise Gate, Reverse, Change Speed, Pitch Shift,
Reverb, Echo / Delay, channel tools and Remove DC Offset.

**Cleaning up a recording.**
1. **Auto Clean Voice…** does high-pass filtering, noise reduction, compression and normalizing in one step.
2. For stubborn noise: select half a second of pure noise, *Capture noise print* (Shift+P), then
   *Noise Reduction…*.
3. **Remove silence…** shortens long pauses (threshold, minimum length, padding).

The *Statistics* panel shows peak, RMS and loudness (LUFS); *View → Spectral frequency display* makes noise and
hum visible.

**Recording.** *Record…* chooses the microphone and whether the recording goes in at the cursor or into a new
file. Allow microphone access when your system asks.

**Multitrack.** Add tracks, import files or the current waveform, drag clips to move them and their edges to trim,
**S** splits at the playhead. Each track has volume, pan, mute and solo; clips can fade in and out. *Export mix…*
or *Mixdown to new file*.

**Transcripts and AI.** *AI → Transcribe* (Whisper on your own computer, desktop app) fills the *Transcript*
panel: click a segment to play it, delete words and press *Apply cut* to remove that audio, export the transcript
as TXT, SRT or VTT. *Summarize transcript* and *Write show notes* use your connected AI. The assistant can select
ranges, apply effects, trim, delete, fade, normalize (*“make it −16 LUFS for a podcast”*), add markers and run
Auto Clean Voice.

**Export** (Ctrl+E): WAV (16-bit, 24-bit or 32-bit float), MP3, FLAC, OGG/Opus, WebM/Opus or M4A/AAC with sample
rate, channels and bitrate; the whole file, the selection or the multitrack mix. MP3 and FLAC need the desktop app
with FFmpeg. Markers can be exported as text, CSV or YouTube chapters.

**Projects.** *Save project* (Ctrl+S) stores the audio, markers, transcript and multitrack session in a `.ultima`
file. Your original audio file is never overwritten — use Export for a WAV or MP3.

## PDF Studio

*Like Acrobat: read, organize, annotate, sign, fill and redact PDFs.*

**Start.** *Open PDF…* (also images and `.ultima` projects), *Combine files…*, *Images to PDF…* or *New blank PDF*.
When you open more files you can combine them, add them to the end, insert them after the current page or open
a new document. Password-protected PDFs ask for the password.

**Reading.** Page thumbnails and bookmarks on the left; *Find* (Ctrl+F) with match case and whole words; zoom with
Ctrl+wheel, *Fit width* (Ctrl+0), *Actual size* (Ctrl+1); pan with Space+drag or the Hand tool; PgUp/PgDn.

**Annotating** (in *View & Edit* mode): Select (V) · Hand (H) · Add text (T) · Draw (D) · Highlight (Y) ·
Underline (U) · Strikethrough (K) · Rectangle (R) · Ellipse (O) · Line (L) · Arrow (A) · Image (I) · Stamp (S:
Approved, Draft, Confidential, Paid, Copy or your own text) · Sign (G) · Date · Note (N) · Whiteout (W) · Redact (X).
Select text to highlight, underline or strike it out, or to mark it for redaction. The *Edit* tab on the right
changes color, font, size, border and opacity.

**Signing.** Sign (G): draw, type (four handwriting styles) or upload a picture of your signature; Ultima can
remember up to 8. Signatures are placed as images (certificate-based digital signatures aren't supported).

**Forms.** Fill text fields, checkboxes, radio buttons and lists on the page or in the *Forms* tab; choose
*Flatten form when saving* to make the answers part of the page.

**Pages.** *Organize* mode shows all pages: drag to reorder, rotate, duplicate, delete, insert blank pages, other
PDFs or images, and extract pages. *Split document…* splits every N pages or by ranges (`1-3, 4-6, 7-`).
*Merge files…* adds PDFs at the end.

**Redaction.** Mark areas with Redact (X), selected text with *Mark for redaction*, or every occurrence of a word.
*Apply redactions…* removes the content for real: the affected pages become images with black boxes.
Whiteout only covers content — the text underneath stays in the file.

**AI.** *AI* tab and menu: **Summarize document** (with links to the pages), **Ask this PDF** (a chat that cites
pages), **Translate page…**, **Extract key data…** (saved as JSON or CSV) and **Fill form with AI…** (you check the
values before they are filled in). The assistant can go to pages, rotate, delete and extract pages, add text boxes,
highlight phrases, fill form fields and set the document properties.

**Saving.** *Save PDF* (Ctrl+S) writes a normal PDF with your annotations, signatures, page changes and form values.
*Save project (.ultima)…* keeps the annotations editable for later. You can also export pages as images (PNG/JPG,
72–600 DPI), extract all text or print.

**Good to know.** Scanned PDFs without a text layer can't be searched or read by the AI (no text recognition yet).
A password-protected PDF is saved without its password. Existing text in a PDF can't be edited in place — cover it
with Whiteout and add new text. Watermarks, page numbering, compression and encryption aren't available yet.

## Color Studio

*Like Adobe Color: palettes, harmonies, gradients and accessibility checks.*

The header switches between five views:

- **Wheel:** pick a harmony (Analogous, Monochromatic, Triad, Complementary, Split Complementary, Square, Compound,
  Shades or Custom) and drag the markers on the wheel (artistic RYB or RGB); adjust the spread. Lock a swatch (**L**)
  to keep it, **B** makes the selected swatch the base color, **←**/**→** select swatches. Every swatch shows
  HEX/RGB/HSB/HSL/CMYK/LAB values you can copy.
- **Extract:** open a photo and Ultima picks 2–10 colors in a mood (Balanced, Colorful, Bright, Muted, Deep, Dark).
  Drag the circles on the photo, or click it to pick the selected color again.
- **Gradient:** linear, radial or conic, stops from your palette, sRGB or OKLab blending; copy the CSS or export
  PNG/SVG.
- **Accessibility:** a contrast checker (WCAG AA/AAA, optional APCA) with one-click fixes, a contrast grid for the
  whole palette, *Auto-fix text pairs* and a color-blindness simulation (protanopia, deuteranopia, tritanopia,
  achromatopsia).
- **Library:** your saved palettes; search by name, tag or hex code; *Import…* adds palette files to the library.

**AI palette tools** (right panel): **Palette from a description** (*“calm spa, sage and sand”*), **Name my colors**
and **Make it accessible**. The assistant can replace or change colors, set the harmony and base color, edit the
gradient, and name, tag, lock and sort the palette.

**Use your palette elsewhere.** *Use in…* → Vector (swatches), Layout (theme colors) or Motion (recolors layers).

**Files.** *Save* stores a `.ultima` file. *Export…*: CSS variables, SCSS, JSON, Tailwind, Adobe Swatch Exchange
(`.ase`), GIMP/Inkscape palette (`.gpl`) or a PNG swatch sheet. Ultima opens `.ase`, `.gpl`, JSON and CSS/text
files (up to 12 colors).

## AI Studio

*Chat with the AI you already pay for — or a free local model — and send the results to the other tools.*

**Chat.** Choose a persona (Creative assistant, Creative copywriter, Social media manager, Video script writer,
Translator EN↔ID, Brainstorm partner, SVG illustrator, Image-prompt engineer, Photo editing coach or your own),
the AI and the model in the toolbar. Attach images or text files with the paperclip, by pasting or by dropping them.
Every answer has Copy, Regenerate, *Edit & resend* and **Send to…** (Vector, Color Studio, Layout, Motion, Video). SVG
drawings in an answer get a preview with *Open in Vector* and *Save SVG*; color codes become chips you can open in
Color Studio. Chats are saved automatically; you can pin, rename, search and export them (Markdown or `.ultima`).

**Prompt library.** 24 ready-made prompts for captions, YouTube metadata, ad copy, scripts, slogans, translation,
proofreading, palettes, image prompts, SVG icons and more — fill in the fields, then *Insert into message* or
*Send now*.

**Compare.** Send the same prompt to two AIs and read the answers side by side; *Continue in chat* with the better one.

**Images** (desktop app). Text-to-image with the generator you pick at the top: Stable Diffusion WebUI or ComfyUI
(prompt, negative prompt, size, steps, guidance, seed, batch), a local OpenAI-style image server such as LocalAI
(model, prompt, size), **Antigravity** with your Google AI Pro or Ultra plan or **Codex** with your ChatGPT plan
(prompt and shape; about a minute per image), or **SVG drawing by your AI** — any connected AI such as Claude draws
the picture as SVG code (choose it under *AI that draws*; also works in the browser version with a local AI).
*Improve prompt* lets your chat AI rewrite the idea. Save a result, *Open in Photo*, or — for SVG drawings — *Open in
Vector* to keep editing the shapes.

**Speech** (desktop app). Type or paste a script, choose the engine and voice (Settings → Speech) and speed, then
*Create speech*. Each clip can be played, saved (WAV), opened in Audio or added to the Video timeline at the playhead
as a voice-over. In the browser version, *Read aloud* uses the browser's own voice (it can't be saved).

**Good to know.** The AI tools don't remember earlier messages by themselves, so Ultima sends the recent part of the
chat with every request (*Memory* settings on the right; small local models work best with 8–16k characters). AIs
that can't read images get a note instead of the picture. In the browser version only Ollama and LM Studio work.

## Tips & troubleshooting

- **Big files:** long 4K videos and very large images need a lot of memory. Tools you visited stay open in the
  background; restarting Ultima frees all of it.
- **Fonts:** Ultima lists the fonts installed on your computer (you may be asked to allow font access once).
- **Where are my settings?** Windows `%APPDATA%\Ultima`, macOS `~/Library/Application Support/Ultima`,
  Linux `~/.config/Ultima`.
- More help: [INSTALL.md → Troubleshooting](INSTALL.md#troubleshooting), [AI_SETUP.md → Troubleshooting](AI_SETUP.md#troubleshooting),
  or [open an issue](https://github.com/tenmaryut/ultima/issues/new/choose).
