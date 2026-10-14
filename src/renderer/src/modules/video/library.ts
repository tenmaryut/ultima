import type { MediaRef } from './types';

/*
 * The built-in library: sound effects, stickers and overlays made in code (no downloads, no
 * licenses). Every item has a fixed media id, so projects and the AI can use it before the file
 * exists; the editor generates the file when a project needs it.
 */

export type LibraryKind = 'sfx' | 'sticker' | 'overlay';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  label: string;
  /** What it is, for the AI and as a tooltip. */
  description: string;
  /** Sound effects: seconds. */
  duration?: number;
  /** Overlays: the blend mode they are meant for. */
  blend?: 'screen' | 'multiply' | 'normal';
}

export const SFX_RATE = 48000;

export const SFX: LibraryItem[] = [
  { id: 'whoosh', kind: 'sfx', label: 'Whoosh', description: 'air swish for transitions and fast moves', duration: 0.9 },
  { id: 'swipe', kind: 'sfx', label: 'Swipe', description: 'short fast swish', duration: 0.35 },
  { id: 'reverseWhoosh', kind: 'sfx', label: 'Reverse whoosh', description: 'rises into a cut, ends abruptly', duration: 1.3 },
  { id: 'riser', kind: 'sfx', label: 'Riser', description: 'tension build-up before a drop', duration: 3 },
  { id: 'impact', kind: 'sfx', label: 'Impact', description: 'deep cinematic hit', duration: 1.6 },
  { id: 'boom', kind: 'sfx', label: 'Boom', description: 'explosion-like rumble', duration: 2.6 },
  { id: 'bassDrop', kind: 'sfx', label: 'Bass drop', description: 'falling sub bass for a drop or a big moment', duration: 1.6 },
  { id: 'glitch', kind: 'sfx', label: 'Glitch', description: 'digital stutter', duration: 0.6 },
  { id: 'hitmarker', kind: 'sfx', label: 'Hitmarker', description: 'game hit tick', duration: 0.12 },
  { id: 'click', kind: 'sfx', label: 'Click', description: 'UI click', duration: 0.06 },
  { id: 'pop', kind: 'sfx', label: 'Pop', description: 'bubbly pop for text and stickers', duration: 0.18 },
  { id: 'ding', kind: 'sfx', label: 'Ding', description: 'bright bell', duration: 1.4 },
  { id: 'shutter', kind: 'sfx', label: 'Camera shutter', description: 'photo snap for freeze frames', duration: 0.3 },
  { id: 'heartbeat', kind: 'sfx', label: 'Heartbeat', description: 'two low thumps', duration: 1.1 },
];

export const STICKERS: LibraryItem[] = [
  { id: 'hitMarker', kind: 'sticker', label: 'Hit marker', description: 'gaming hit marker, four slanted ticks' },
  { id: 'crosshair', kind: 'sticker', label: 'Crosshair', description: 'gaming crosshair' },
  { id: 'arrow', kind: 'sticker', label: 'Arrow', description: 'red arrow pointing right, rotate it to point elsewhere' },
  { id: 'circle', kind: 'sticker', label: 'Circle', description: 'red ring to highlight something' },
  { id: 'burst', kind: 'sticker', label: 'Comic burst', description: 'yellow comic "pow" burst' },
  { id: 'bubble', kind: 'sticker', label: 'Speech bubble', description: 'white speech bubble, put a title on it' },
  { id: 'star', kind: 'sticker', label: 'Star', description: 'yellow star' },
  { id: 'heart', kind: 'sticker', label: 'Heart', description: 'red heart' },
  { id: 'lightning', kind: 'sticker', label: 'Lightning', description: 'yellow lightning bolt' },
  { id: 'check', kind: 'sticker', label: 'Check mark', description: 'green check mark' },
  { id: 'cross', kind: 'sticker', label: 'Cross mark', description: 'red X' },
];

export const OVERLAYS: LibraryItem[] = [
  { id: 'lightLeak', kind: 'overlay', label: 'Light leak', description: 'warm film light leak, screen blend', blend: 'screen' },
  { id: 'filmDust', kind: 'overlay', label: 'Film dust', description: 'dust and scratches, screen blend', blend: 'screen' },
  { id: 'bokeh', kind: 'overlay', label: 'Bokeh', description: 'soft out-of-focus lights, screen blend', blend: 'screen' },
  { id: 'lensFlare', kind: 'overlay', label: 'Lens flare', description: 'anamorphic flare streak, screen blend', blend: 'screen' },
  { id: 'scanlines', kind: 'overlay', label: 'Scanlines', description: 'old TV lines, multiply blend', blend: 'multiply' },
];

export const LIBRARY: LibraryItem[] = [...SFX, ...STICKERS, ...OVERLAYS];

export const STICKER_SIZE = 512;
export const OVERLAY_SIZE = { width: 1920, height: 1080 };

export const libraryMediaId = (item: LibraryItem) => `lib_${item.kind}_${item.id}`;
export const isLibraryMedia = (id: string | undefined) => Boolean(id?.startsWith('lib_'));

/** The library item behind a media id. */
export function libraryItemOf(mediaId: string | undefined): LibraryItem | undefined {
  return LIBRARY.find((i) => libraryMediaId(i) === mediaId);
}

/** Other names people (and AIs) use for library items. */
const ALIASES: Record<string, string> = {
  swoosh: 'whoosh',
  swish: 'whoosh',
  transition: 'whoosh',
  explosion: 'boom',
  hit: 'impact',
  thud: 'impact',
  drop: 'bassDrop',
  rise: 'riser',
  buildup: 'riser',
  camera: 'shutter',
  bell: 'ding',
  notification: 'ding',
  tick: 'hitmarker',
  kill: 'hitmarker',
  pow: 'burst',
  explosionsticker: 'burst',
  tick2: 'check',
  checkmark: 'check',
  x: 'cross',
  bolt: 'lightning',
  flare: 'lensFlare',
  dust: 'filmDust',
  grain: 'filmDust',
  leak: 'lightLeak',
};

/** An item by id or (loosely) by name, optionally of one kind. */
export function findLibraryItem(ref: unknown, kinds?: LibraryKind[]): LibraryItem | undefined {
  if (typeof ref !== 'string') return undefined;
  let k = ref.toLowerCase().replace(/[^a-z]/g, '');
  const alias = ALIASES[k];
  if (alias && (!kinds || LIBRARY.some((i) => i.id === alias && kinds.includes(i.kind)))) k = alias.toLowerCase();
  const pool = kinds ? LIBRARY.filter((i) => kinds.includes(i.kind)) : LIBRARY;
  return pool.find((i) => i.id.toLowerCase() === k || i.label.toLowerCase().replace(/[^a-z]/g, '') === k) ?? pool.find((i) => k.length >= 3 && i.label.toLowerCase().replace(/[^a-z]/g, '').includes(k));
}

/** Samples of a sound effect (mono). */
export const sfxLength = (item: LibraryItem) => Math.round((item.duration ?? 1) * SFX_RATE);

/** The media reference of a library item (also before its file exists). */
export function libraryMediaRef(item: LibraryItem): MediaRef {
  const id = libraryMediaId(item);
  if (item.kind === 'sfx') {
    const n = sfxLength(item);
    return { id, name: `${item.label}.wav`, kind: 'audio', duration: n / SFX_RATE, width: 0, height: 0, size: 44 + n * 4, mime: 'audio/wav', hasAudio: true };
  }
  const size = item.kind === 'sticker' ? { width: STICKER_SIZE, height: STICKER_SIZE } : OVERLAY_SIZE;
  return { id, name: `${item.label}.png`, kind: 'image', duration: 0, ...size, size: 0, mime: 'image/png', hasAudio: false };
}

/* ------------------------------- Sound synthesis ------------------------------- */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Resonant state-variable filter (cutoff may change per sample). */
function svf() {
  let low = 0;
  let band = 0;
  return (x: number, cutoff: number, q = 0.7) => {
    const f = Math.min(0.99, 2 * Math.sin((Math.PI * Math.min(cutoff, SFX_RATE / 4)) / SFX_RATE));
    low += f * band;
    const high = x - low - band / Math.max(0.5, q * 2);
    band += f * high;
    return { low, band, high };
  };
}

const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** A sound effect as mono samples (−1…1), always the same for the same id. */
export function renderSfx(item: LibraryItem): Float32Array {
  const n = sfxLength(item);
  const out = new Float32Array(n);
  const r = rng(item.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const noise = () => r() * 2 - 1;
  const d = n / SFX_RATE;
  const filt = svf();
  const filt2 = svf();
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SFX_RATE;
    const x = t / d;
    let v = 0;
    switch (item.id) {
      case 'whoosh':
      case 'swipe': {
        const bell = Math.sin(Math.PI * Math.pow(x, 0.8)) ** 2;
        const cutoff = 300 + 3200 * Math.sin(Math.PI * x);
        v = filt(noise(), cutoff, 1.4).band * bell * 2.2;
        break;
      }
      case 'reverseWhoosh': {
        const rise = Math.pow(x, 2.5);
        v = filt(noise(), 200 + 5000 * x * x, 1.2).band * rise * 2.4 * (x > 0.97 ? (1 - x) / 0.03 : 1);
        break;
      }
      case 'riser': {
        const f = 120 * Math.pow(2, x * 3.2);
        phase += (2 * Math.PI * f) / SFX_RATE;
        phase2 += (2 * Math.PI * f * 1.502) / SFX_RATE;
        const tone = 0.5 * Math.sin(phase) + 0.25 * Math.sin(phase2);
        v = (tone + filt(noise(), 400 + 7000 * x, 1).band * 0.8) * Math.pow(x, 1.6) * (x > 0.985 ? (1 - x) / 0.015 : 1);
        break;
      }
      case 'impact': {
        const f = 38 + 90 * Math.exp(-t * 18);
        phase += (2 * Math.PI * f) / SFX_RATE;
        const body = Math.sin(phase) * env(t, 0.003, 0.45);
        const crack = filt(noise(), 2500, 0.8).low * env(t, 0.001, 0.05);
        const tail = filt2(noise(), 300, 0.7).low * env(t, 0.01, 0.6) * 0.8;
        v = Math.tanh((body * 1.4 + crack * 1.5 + tail) * 1.3);
        break;
      }
      case 'boom': {
        const f = 32 + 60 * Math.exp(-t * 6);
        phase += (2 * Math.PI * f) / SFX_RATE;
        const rumble = filt(noise(), 180 + 900 * Math.exp(-t * 3), 0.7).low;
        v = Math.tanh((Math.sin(phase) * env(t, 0.005, 0.8) + rumble * 2.2 * env(t, 0.01, 0.9)) * 1.5);
        break;
      }
      case 'bassDrop': {
        const f = 30 + 130 * Math.exp(-t * 2.4);
        phase += (2 * Math.PI * f) / SFX_RATE;
        v = Math.tanh(Math.sin(phase) * 2.2) * 0.85 * env(t, 0.004, 0.7);
        break;
      }
      case 'glitch': {
        const block = Math.floor(t * 40);
        const br = rng(block * 977 + 13);
        const on = br() > 0.35;
        const f = 80 + br() * 1600;
        phase += (2 * Math.PI * f) / SFX_RATE;
        const crushed = Math.round(noise() * 3) / 3;
        v = on ? (br() > 0.5 ? Math.sign(Math.sin(phase)) * 0.45 : crushed * 0.5) * (1 - x * 0.4) : 0;
        break;
      }
      case 'hitmarker': {
        phase += (2 * Math.PI * 3100) / SFX_RATE;
        phase2 += (2 * Math.PI * 4650) / SFX_RATE;
        v = (Math.sin(phase) * 0.6 + Math.sin(phase2) * 0.3 + noise() * 0.15) * env(t, 0.0005, 0.025);
        break;
      }
      case 'click':
        v = filt(noise(), 3000, 0.8).band * env(t, 0.0003, 0.006) * 3;
        break;
      case 'pop': {
        const f = 300 + 900 * Math.exp(-t * 40);
        phase += (2 * Math.PI * f) / SFX_RATE;
        v = Math.sin(phase) * env(t, 0.002, 0.04) * 0.9;
        break;
      }
      case 'ding': {
        const partials = [1, 2.76, 5.4, 8.93];
        for (let k = 0; k < partials.length; k++) v += Math.sin(2 * Math.PI * 1320 * partials[k] * t) * env(t, 0.002, 0.5 / (k + 1)) * (0.5 / (k + 1));
        break;
      }
      case 'shutter': {
        const click = (at: number) => (t >= at ? filt(noise(), 3500, 0.9).band * env(t - at, 0.0005, 0.012) * 2.5 : 0);
        v = click(0) + click(0.11) + filt2(noise(), 900, 0.7).low * env(t, 0.005, 0.05) * 0.4;
        break;
      }
      case 'heartbeat': {
        const thump = (at: number, amp: number) => {
          if (t < at) return 0;
          const tt = t - at;
          return Math.sin(2 * Math.PI * (48 + 30 * Math.exp(-tt * 30)) * tt) * env(tt, 0.004, 0.09) * amp;
        };
        v = Math.tanh((thump(0.02, 1) + thump(0.3, 0.75)) * 1.6);
        break;
      }
      default:
        v = 0;
    }
    out[i] = v;
  }
  // a short fade at both ends (no clicks) and a common peak level
  const fade = Math.min(n >> 2, Math.round(SFX_RATE * 0.003));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[n - 1 - i] *= i / fade;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.89 / peak;
  return out;
}

/** A sound effect as a 16-bit stereo WAV file. */
export function sfxWav(item: LibraryItem): Uint8Array {
  const mono = renderSfx(item);
  const n = mono.length;
  const bytes = new Uint8Array(44 + n * 4);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, SFX_RATE, true);
  v.setUint32(28, SFX_RATE * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    const q = s < 0 ? s * 0x8000 : s * 0x7fff;
    v.setInt16(44 + i * 4, q, true);
    v.setInt16(46 + i * 4, q, true);
  }
  return bytes;
}

/* ---------------------------------- Graphics ---------------------------------- */

type Ctx = CanvasRenderingContext2D;

function starPath(c: Ctx, cx: number, cy: number, points: number, outer: number, inner: number, rotation = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? inner : outer;
    const a = rotation + (i * Math.PI) / points;
    c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  c.closePath();
}

/** Draws a sticker into a size × size transparent canvas. */
export function drawSticker(c: Ctx, id: string, size = STICKER_SIZE) {
  const s = size / 512;
  c.save();
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const shadow = () => {
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 4;
  };
  switch (id) {
    case 'hitMarker':
      shadow();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 26;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        c.beginPath();
        c.moveTo(256 + dx * 60, 256 + dy * 60);
        c.lineTo(256 + dx * 170, 256 + dy * 170);
        c.stroke();
      }
      break;
    case 'crosshair':
      shadow();
      c.strokeStyle = '#7CFC6A';
      c.lineWidth = 18;
      for (const [x1, y1, x2, y2] of [
        [256, 70, 256, 200],
        [256, 312, 256, 442],
        [70, 256, 200, 256],
        [312, 256, 442, 256],
      ]) {
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
      }
      c.beginPath();
      c.arc(256, 256, 12, 0, Math.PI * 2);
      c.fillStyle = '#7CFC6A';
      c.fill();
      break;
    case 'arrow':
      shadow();
      c.fillStyle = '#ff3b30';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 14;
      c.beginPath();
      c.moveTo(40, 200);
      c.lineTo(300, 200);
      c.lineTo(300, 110);
      c.lineTo(470, 256);
      c.lineTo(300, 402);
      c.lineTo(300, 312);
      c.lineTo(40, 312);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'circle':
      shadow();
      c.strokeStyle = '#ff3b30';
      c.lineWidth = 34;
      c.beginPath();
      c.ellipse(256, 256, 200, 180, -0.15, 0, Math.PI * 2);
      c.stroke();
      break;
    case 'burst':
      shadow();
      starPath(c, 256, 256, 14, 245, 165, -0.2);
      c.fillStyle = '#ffd60a';
      c.fill();
      c.lineWidth = 16;
      c.strokeStyle = '#e63946';
      c.stroke();
      break;
    case 'bubble':
      shadow();
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#111111';
      c.lineWidth = 12;
      c.beginPath();
      c.ellipse(256, 220, 220, 160, 0, 0, Math.PI * 2);
      c.moveTo(150, 340);
      c.lineTo(110, 470);
      c.lineTo(250, 370);
      c.fill();
      c.stroke();
      c.beginPath();
      c.ellipse(256, 220, 214, 154, 0, 0, Math.PI * 2);
      c.fill();
      break;
    case 'star':
      shadow();
      starPath(c, 256, 270, 5, 240, 100);
      c.fillStyle = '#ffd60a';
      c.fill();
      c.lineWidth = 12;
      c.strokeStyle = '#f4a100';
      c.stroke();
      break;
    case 'heart':
      shadow();
      c.fillStyle = '#ff2d55';
      c.beginPath();
      c.moveTo(256, 450);
      c.bezierCurveTo(60, 330, 20, 200, 110, 120);
      c.bezierCurveTo(180, 60, 240, 100, 256, 150);
      c.bezierCurveTo(272, 100, 332, 60, 402, 120);
      c.bezierCurveTo(492, 200, 452, 330, 256, 450);
      c.fill();
      break;
    case 'lightning':
      shadow();
      c.fillStyle = '#ffd60a';
      c.strokeStyle = '#f48c06';
      c.lineWidth = 12;
      c.beginPath();
      c.moveTo(300, 30);
      c.lineTo(120, 290);
      c.lineTo(240, 290);
      c.lineTo(190, 480);
      c.lineTo(400, 200);
      c.lineTo(275, 200);
      c.closePath();
      c.fill();
      c.stroke();
      break;
    case 'check':
      shadow();
      c.strokeStyle = '#34c759';
      c.lineWidth = 64;
      c.beginPath();
      c.moveTo(90, 270);
      c.lineTo(205, 385);
      c.lineTo(430, 140);
      c.stroke();
      break;
    case 'cross':
      shadow();
      c.strokeStyle = '#ff3b30';
      c.lineWidth = 64;
      c.beginPath();
      c.moveTo(120, 120);
      c.lineTo(392, 392);
      c.moveTo(392, 120);
      c.lineTo(120, 392);
      c.stroke();
      break;
  }
  c.restore();
}

/** Draws an overlay into a width × height canvas (meant for the blend mode in its definition). */
export function drawOverlay(c: Ctx, id: string, w = OVERLAY_SIZE.width, h = OVERLAY_SIZE.height) {
  const r = rng(id.length * 7919 + 17);
  c.save();
  if (id !== 'scanlines') {
    c.fillStyle = '#000000';
    c.fillRect(0, 0, w, h);
  }
  switch (id) {
    case 'lightLeak':
      c.globalCompositeOperation = 'lighter';
      for (const [x, y, rad, col] of [
        [0.08, 0.2, 0.55, 'rgba(255,120,30,0.85)'],
        [0.0, 0.85, 0.45, 'rgba(255,40,40,0.7)'],
        [0.35, 0.05, 0.35, 'rgba(255,200,90,0.55)'],
        [0.95, 0.9, 0.3, 'rgba(255,90,60,0.35)'],
      ] as [number, number, number, string][]) {
        const g = c.createRadialGradient(x * w, y * h, 0, x * w, y * h, rad * w);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
      break;
    case 'filmDust':
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 260; i++) {
        c.globalAlpha = 0.25 + r() * 0.6;
        const s = 1 + r() * 3.5;
        c.beginPath();
        c.ellipse(r() * w, r() * h, s, s * (0.5 + r()), r() * Math.PI, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = '#ffffff';
      for (let i = 0; i < 7; i++) {
        c.globalAlpha = 0.2 + r() * 0.35;
        c.lineWidth = 1 + r() * 1.5;
        const x = r() * w;
        c.beginPath();
        c.moveTo(x, r() * h * 0.3);
        c.bezierCurveTo(x + (r() - 0.5) * 30, h * 0.4, x + (r() - 0.5) * 30, h * 0.6, x + (r() - 0.5) * 40, h * (0.7 + r() * 0.3));
        c.stroke();
      }
      for (let i = 0; i < 12; i++) {
        c.globalAlpha = 0.35;
        c.lineWidth = 1;
        const x = r() * w;
        const y = r() * h;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60, x + (r() - 0.5) * 90, y + (r() - 0.5) * 90);
        c.stroke();
      }
      break;
    case 'bokeh':
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 38; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 25 + r() * 90;
        const hue = 20 + r() * 40;
        const g = c.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        g.addColorStop(0, `hsla(${hue}, 90%, 70%, ${0.15 + r() * 0.25})`);
        g.addColorStop(0.85, `hsla(${hue}, 90%, 65%, ${0.1 + r() * 0.15})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, rad, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case 'lensFlare': {
      c.globalCompositeOperation = 'lighter';
      const cx = w * 0.72;
      const cy = h * 0.32;
      const streak = c.createLinearGradient(0, cy, w, cy);
      streak.addColorStop(0, 'rgba(60,120,255,0)');
      streak.addColorStop(0.5, 'rgba(120,180,255,0.75)');
      streak.addColorStop(1, 'rgba(60,120,255,0)');
      c.fillStyle = streak;
      c.fillRect(0, cy - h * 0.006, w, h * 0.012);
      const core = c.createRadialGradient(cx, cy, 0, cx, cy, h * 0.18);
      core.addColorStop(0, 'rgba(255,255,255,0.95)');
      core.addColorStop(0.2, 'rgba(160,200,255,0.5)');
      core.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = core;
      c.fillRect(0, 0, w, h);
      for (const [f, rad, a] of [
        [0.35, 30, 0.25],
        [0.55, 60, 0.15],
        [0.8, 20, 0.3],
        [1.15, 90, 0.12],
      ]) {
        const x = cx + (w / 2 - cx) * f * 2;
        const y = cy + (h / 2 - cy) * f * 2;
        c.fillStyle = `rgba(150,190,255,${a})`;
        c.beginPath();
        c.arc(x, y, rad * (h / 1080), 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case 'scanlines':
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
      break;
  }
  c.restore();
}

/* ------------------------------------ Files ------------------------------------ */

/** The file of a library item (WAV or PNG), made on demand. */
export async function libraryFile(item: LibraryItem): Promise<File> {
  const ref = libraryMediaRef(item);
  if (item.kind === 'sfx') return new File([sfxWav(item) as Uint8Array<ArrayBuffer>], ref.name, { type: 'audio/wav', lastModified: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = ref.width;
  canvas.height = ref.height;
  const ctx = canvas.getContext('2d')!;
  if (item.kind === 'sticker') drawSticker(ctx, item.id, ref.width);
  else drawOverlay(ctx, item.id, ref.width, ref.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not draw the graphic.');
  return new File([blob], ref.name, { type: 'image/png', lastModified: 0 });
}
