import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { FilePlus, FolderOpen, Image as ImageIcon, X } from 'lucide-react';
import { useT } from '../../../core/i18n';
import type { ViewState } from '../../../core/viewport';
import { Button } from '../../../components/ui';
import { newDocument, pickAndOpen, closeDocument } from '../actions';
import { findLayer, removeLayer, updateLayer } from '../doc';
import type { PhotoEngine } from '../engine';
import { layoutText, textFont } from '../render';
import { isDirty, usePhotoStore } from '../store';
import type { PhotoDoc, TextLayer } from '../types';

export const DOC_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'hd', label: 'HD 1920 × 1080', w: 1920, h: 1080 },
  { id: '4k', label: '4K UHD 3840 × 2160', w: 3840, h: 2160 },
  { id: 'a4', label: 'A4 300 dpi 2480 × 3508', w: 2480, h: 3508 },
  { id: 'instagram', label: 'Instagram post 1080 × 1080', w: 1080, h: 1080 },
  { id: 'story', label: 'Story 1080 × 1920', w: 1080, h: 1920 },
  { id: 'youtube', label: 'YouTube thumbnail 1280 × 720', w: 1280, h: 720 },
];

/* -------------------------------- Text editor -------------------------------- */

export function TextEditor({ engine, layerId, view, doc }: { engine: PhotoEngine; layerId: string; view: ViewState; doc: PhotoDoc }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const layer = findLayer(doc, layerId) as TextLayer | undefined;
  const isNew = useRef(layer ? layer.text === '' : false);
  const done = useRef(false);

  useEffect(() => {
    engine.overrides.hidden.add(layerId);
    engine.requestRender();
    const el = ref.current;
    if (el) {
      el.focus();
      el.select();
    }
    return () => {
      engine.overrides.hidden.delete(layerId);
      engine.requestRender();
    };
  }, [engine, layerId]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const current = engine.doc;
    const l = current ? findLayer(current, layerId) : undefined;
    if (current && l?.type === 'text' && !l.text.trim()) {
      if (isNew.current) engine.history?.discardLive();
      else engine.commit(removeLayer(current, layerId), 'Delete Layer');
    } else engine.commitLive(isNew.current ? 'Type Tool' : 'Edit Text');
    usePhotoStore.getState().setEditingText(null);
  };

  if (!layer || layer.type !== 'text') return null;
  const lay = layoutText(layer);
  const z = view.zoom;
  const extra = Math.max(12, layer.size * z * 0.6);
  const width = lay.width * z + extra;
  const height = lay.height * z + 4;
  const cx = view.x + lay.cx * z;
  const cy = view.y + lay.cy * z;
  const left = layer.align === 'left' ? view.x + lay.box.x * z : layer.align === 'right' ? view.x + (lay.box.x + lay.box.w) * z - width + extra : cx - width / 2;
  const style: CSSProperties = {
    left,
    top: cy - height / 2,
    width,
    height,
    font: textFont(layer, z),
    letterSpacing: `${layer.letterSpacing * z}px`,
    lineHeight: `${layer.size * layer.lineHeight * z}px`,
    color: layer.color,
    textAlign: layer.align,
    textDecoration: layer.underline ? 'underline' : undefined,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    transformOrigin: `${cx - left}px ${height / 2}px`,
  };
  return (
    <textarea
      ref={ref}
      className="ph-text-editor"
      style={style}
      value={layer.text}
      spellCheck={false}
      aria-label={t('Edit text')}
      placeholder={t('Type here')}
      onChange={(e) => {
        const d = engine.doc;
        if (d) engine.live(updateLayer(d, layerId, { text: e.target.value }));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
      onBlur={finish}
    />
  );
}

/* ------------------------------- Start screen ------------------------------- */

export function StartScreen({ onNew }: { onNew: () => void }) {
  const t = useT();
  return (
    <div className="ph-start">
      <div className="ph-start-card">
        <div className="ph-start-icon">
          <ImageIcon size={28} />
        </div>
        <h2>{t('Photo Editor')}</h2>
        <p className="muted">{t('Create a new image, open a photo or PSD, or drop files here.')}</p>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" icon={FilePlus} onClick={onNew}>
            {t('New…')}
          </Button>
          <Button icon={FolderOpen} onClick={() => void pickAndOpen()}>
            {t('Open…')}
          </Button>
        </div>
        <div className="ph-presets">
          {DOC_PRESETS.map((p) => (
            <button key={p.id} type="button" className="ph-preset" onClick={() => newDocument(p.w, p.h, '#ffffff')}>
              <span className="ph-preset-shape" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
              <span>{t(p.label)}</span>
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12 }}>
          {t('Opens PNG, JPG, WebP, GIF, BMP, AVIF, SVG, PSD and Ultima projects.')}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- Tabs ---------------------------------- */

export function DocTabs() {
  const t = useT();
  const sessions = usePhotoStore((s) => s.sessions);
  const activeId = usePhotoStore((s) => s.activeId);
  const setActive = usePhotoStore((s) => s.setActiveSession);
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    tabsRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  if (!sessions.length) return null;
  return (
    <div className="ph-tabs" ref={tabsRef} role="tablist">
      {sessions.map((s) => (
        <div key={s.id} role="tab" aria-selected={s.id === activeId} className={`ph-tab ${s.id === activeId ? 'active' : ''}`} onClick={() => setActive(s.id)} title={s.name}>
          <span className="ph-ellipsis">{s.name}</span>
          {isDirty(s) && <span className="ph-dirty" aria-label={t('Unsaved changes')} />}
          <button
            type="button"
            className="ph-tab-close"
            aria-label={t('Close {name}', { name: s.name })}
            onClick={(e) => {
              e.stopPropagation();
              void closeDocument(s.id);
            }}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
