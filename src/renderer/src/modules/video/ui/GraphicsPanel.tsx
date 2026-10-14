import { memo, type CSSProperties } from 'react';
import { useT } from '../../../core/i18n';
import { TITLE_PRESETS, DEFAULT_TITLE_DURATION, type TitlePresetId } from '../presets';
import { DND_MIME, setDragPayload } from '../dnd';

/** Tiny CSS mock-up of each title preset. */
const ART: Record<TitlePresetId, { text: string; style: CSSProperties }[]> = {
  basic: [{ text: 'Your title', style: { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontWeight: 700, fontSize: 13 } }],
  lowerThird: [
    { text: '', style: { left: '7%', top: '64%', width: '46%', height: '24%', background: 'rgba(17,18,22,0.8)', borderRadius: 2 } },
    { text: 'Your Name', style: { left: '10%', top: '66%', fontWeight: 700, fontSize: 10 } },
    { text: 'Title or role', style: { left: '10%', top: '78%', fontSize: 7, opacity: 0.85 } },
  ],
  big: [{ text: 'BIG NEWS', style: { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontWeight: 900, fontSize: 19, WebkitTextStroke: '1px #000' } }],
  subtitle: [{ text: 'Text near the bottom', style: { left: '50%', top: '80%', transform: 'translate(-50%,-50%)', fontSize: 8, background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 2 } }],
  typewriter: [{ text: 'Typing this|', style: { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontFamily: 'Courier New, monospace', fontWeight: 700, fontSize: 11 } }],
  pop: [{ text: 'NEW!', style: { left: '66%', top: '12%', fontWeight: 800, fontSize: 11, background: '#ffd43b', color: '#111216', padding: '1px 5px', borderRadius: 3 } }],
  endCard: [
    { text: 'Thanks for watching', style: { left: '50%', top: '44%', transform: 'translate(-50%,-50%)', fontWeight: 700, fontSize: 11 } },
    { text: 'Subscribe for more', style: { left: '50%', top: '62%', transform: 'translate(-50%,-50%)', fontSize: 7, opacity: 0.85 } },
  ],
};

export const GraphicsPanel = memo(function GraphicsPanel({ onAdd }: { onAdd: (id: TitlePresetId) => void }) {
  const t = useT();
  return (
    <>
      <div className="vd-section-title">{t('Titles')}</div>
      <div className="vd-preset-list">
        {TITLE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="vd-preset"
            draggable
            onDragStart={(e) => {
              setDragPayload({ kind: 'title', presetId: p.id, duration: DEFAULT_TITLE_DURATION });
              e.dataTransfer.setData(DND_MIME, p.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDragEnd={() => setDragPayload(null)}
            onClick={() => onAdd(p.id)}
            title={t('Click to add at the playhead, or drag onto the timeline')}
          >
            <div className="vd-preset-art">
              {ART[p.id].map((a, i) => (
                <span key={i} style={a.style}>
                  {a.text ? t(a.text) : ''}
                </span>
              ))}
            </div>
            <span className="vd-preset-name">{t(p.label)}</span>
            <span className="vd-preset-desc">{t(p.description)}</span>
          </button>
        ))}
      </div>
      <div className="vd-hint">{t('Titles go on a free video track above your footage. Edit the text, font, colors and animation in the inspector.')}</div>
    </>
  );
});
