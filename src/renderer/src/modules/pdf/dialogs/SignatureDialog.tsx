/**
 * Signature manager: draw with mouse/pen, type a name in a script font, or upload an
 * image (with white background removal). Signatures can be kept in localStorage.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, Upload } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { pickFiles } from '../../../core/platform';
import { Button, IconButton, Modal, Segmented, Select, Tabs, TextInput, Toggle, toast } from '../../../components/ui';
import { usePdfUi } from '../store';

const STORE_KEY = 'ultima-pdf-signatures';
const MAX_SAVED = 8;

interface SavedSignature {
  id: string;
  src: string;
  width: number;
  height: number;
}

function loadSaved(): SavedSignature[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as SavedSignature[];
    return Array.isArray(list) ? list.filter((s) => typeof s?.src === 'string' && s.src.startsWith('data:image/png')) : [];
  } catch {
    return [];
  }
}

function storeSaved(list: SavedSignature[]): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}

const SCRIPT_FONTS = [
  { value: 'script', label: 'Script', css: "'Segoe Script', 'Lucida Handwriting', 'Snell Roundhand', 'Apple Chancery', 'URW Chancery L', 'Z003', cursive" },
  { value: 'brush', label: 'Brush', css: "'Brush Script MT', 'Brush Script Std', 'Bradley Hand', 'Ink Free', 'Segoe Print', cursive" },
  { value: 'hand', label: 'Handwriting', css: "'Ink Free', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive" },
  { value: 'serif', label: 'Classic', css: "Georgia, 'Times New Roman', serif" },
];

/** Crops a canvas to its non-transparent content (with a small margin). */
function cropCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const m = 6;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m);
  y1 = Math.min(height - 1, y1 + m);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')?.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function toSignature(canvas: HTMLCanvasElement): SavedSignature | null {
  const cropped = cropCanvas(canvas);
  if (!cropped) return null;
  // natural size: about 40pt high, at most 220pt wide
  const h = 40;
  const w = Math.min(220, (cropped.width / cropped.height) * h);
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, src: cropped.toDataURL('image/png'), width: w, height: (w / cropped.width) * cropped.height };
}

function DrawPad({ color, width, canvasRef }: { color: string; width: number; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * 2);
    c.height = Math.round(r.height * 2);
  }, [canvasRef]);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.setPointerCapture(e.pointerId);
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const pts: { x: number; y: number }[] = [{ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx }];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const base = width * sx;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, base / 2, 0, Math.PI * 2);
    ctx.fill();
    const move = (ev: PointerEvent) => {
      const events = typeof ev.getCoalescedEvents === 'function' && ev.getCoalescedEvents().length ? ev.getCoalescedEvents() : [ev];
      for (const ce of events) {
        const p = { x: (ce.clientX - r.left) * sx, y: (ce.clientY - r.top) * sx };
        const prev = pts[pts.length - 1];
        const pressure = ce.pressure && ce.pointerType === 'pen' ? 0.4 + ce.pressure : 1;
        ctx.lineWidth = base * pressure;
        const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
        const before = pts.length > 1 ? pts[pts.length - 2] : prev;
        ctx.beginPath();
        ctx.moveTo((before.x + prev.x) / 2, (before.y + prev.y) / 2);
        ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
        ctx.stroke();
        pts.push(p);
      }
    };
    const up = () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  };
  return <canvas ref={canvasRef} className="pd-sig-canvas" onPointerDown={onDown} aria-label="Signature pad" />;
}

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState<SavedSignature[]>(loadSaved);
  const [tab, setTab] = useState<'saved' | 'draw' | 'type' | 'upload'>(saved.length ? 'saved' : 'draw');
  const [color, setColor] = useState('#111827');
  const [pen, setPen] = useState(3);
  const [name, setName] = useState('');
  const [font, setFont] = useState(SCRIPT_FONTS[0].value);
  const [keep, setKeep] = useState(true);
  const [removeBg, setRemoveBg] = useState(true);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);

  const use = (sig: SavedSignature, remember: boolean) => {
    if (remember && !saved.some((s) => s.src === sig.src)) {
      const next = [sig, ...saved].slice(0, MAX_SAVED);
      if (storeSaved(next)) setSaved(next);
      else toast.warning(t('The signature could not be remembered (storage is full).'));
    }
    usePdfUi.getState().set({ tool: 'signature', pending: { kind: 'signature', src: sig.src, width: sig.width, height: sig.height }, mode: 'view', editing: null, dialog: null });
    toast.info(t('Click on a page to place your signature'));
    onClose();
  };

  const fontCss = SCRIPT_FONTS.find((f) => f.value === font)?.css ?? 'cursive';

  const create = (): SavedSignature | null => {
    if (tab === 'draw') {
      const c = drawRef.current;
      return c ? toSignature(c) : null;
    }
    if (tab === 'type') {
      if (!name.trim()) return null;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      const size = 120;
      ctx.font = `italic ${size}px ${fontCss}`;
      const w = Math.ceil(ctx.measureText(name).width + size);
      c.width = Math.min(4000, w);
      c.height = Math.round(size * 1.8);
      ctx.font = `italic ${size}px ${fontCss}`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(name, size / 2, c.height / 2);
      return toSignature(c);
    }
    if (tab === 'upload' && upload) return toSignature(upload);
    return null;
  };

  const chooseUpload = async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      if (removeBg) {
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // fade near-white paper to transparent, keep the ink
          if (lum > 215) d[i + 3] = 0;
          else if (lum > 170) d[i + 3] = Math.round(d[i + 3] * ((215 - lum) / 45));
        }
        ctx.putImageData(img, 0, 0);
      }
      setUpload(c);
    } catch {
      toast.error(t('Could not read the image'));
    }
  };

  const ready = tab === 'type' ? !!name.trim() : tab === 'upload' ? !!upload : tab === 'draw';

  return (
    <Modal
      title={t('Signature')}
      wide
      onClose={onClose}
      footer={
        tab !== 'saved' ? (
          <>
            <Toggle checked={keep} onChange={setKeep} label={t('Remember this signature')} />
            <span className="spacer" />
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button
              variant="primary"
              icon={Check}
              disabled={!ready}
              onClick={() => {
                const sig = create();
                if (!sig) toast.warning(t('Draw, type or upload a signature first'));
                else use(sig, keep);
              }}
            >
              {t('Use signature')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('Cancel')}</Button>
        )
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(saved.length ? [{ value: 'saved' as const, label: t('Saved ({count})', { count: saved.length }) }] : []),
          { value: 'draw', label: t('Draw') },
          { value: 'type', label: t('Type') },
          { value: 'upload', label: t('Upload image') },
        ]}
      />
      {tab === 'saved' && (
        <div className="pd-sig-list">
          {saved.map((s) => (
            <div key={s.id} className="pd-sig-item" role="button" tabIndex={0} onClick={() => use(s, false)} onKeyDown={(e) => e.key === 'Enter' && use(s, false)}>
              <img src={s.src} alt={t('Saved signature')} />
              <IconButton
                icon={Trash2}
                size="sm"
                label={t('Delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = saved.filter((x) => x.id !== s.id);
                  storeSaved(next);
                  setSaved(next);
                  if (!next.length) setTab('draw');
                }}
              />
            </div>
          ))}
        </div>
      )}
      {tab === 'draw' && (
        <>
          <DrawPad color={color} width={pen} canvasRef={drawRef} />
          <div className="row">
            <Segmented
              value={color}
              onChange={setColor}
              options={[
                { value: '#111827', label: t('Black') },
                { value: '#1d4ed8', label: t('Blue') },
              ]}
            />
            <Segmented
              value={String(pen)}
              onChange={(v) => setPen(Number(v))}
              options={[
                { value: '2', label: t('Fine') },
                { value: '3', label: t('Medium') },
                { value: '5', label: t('Bold') },
              ]}
            />
            <span className="spacer" />
            <Button
              size="sm"
              onClick={() => {
                const c = drawRef.current;
                c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
              }}
            >
              {t('Clear')}
            </Button>
          </div>
        </>
      )}
      {tab === 'type' && (
        <>
          <TextInput autoFocus placeholder={t('Your name')} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <Select value={font} onChange={setFont} options={SCRIPT_FONTS.map((f) => ({ value: f.value, label: f.label }))} small />
            <Segmented
              value={color}
              onChange={setColor}
              options={[
                { value: '#111827', label: t('Black') },
                { value: '#1d4ed8', label: t('Blue') },
              ]}
            />
          </div>
          <div className="pd-type-preview" style={{ fontFamily: fontCss, fontStyle: 'italic', color }}>
            {name || t('Your name')}
          </div>
        </>
      )}
      {tab === 'upload' && (
        <>
          <div className="row">
            <Button icon={Upload} onClick={() => void chooseUpload()}>
              {t('Choose image…')}
            </Button>
            <Toggle checked={removeBg} onChange={setRemoveBg} label={t('Remove white background')} />
          </div>
          {upload && (
            <div className="pd-sig-item" style={{ height: 140, cursor: 'default' }}>
              <img src={upload.toDataURL('image/png')} alt="" />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
