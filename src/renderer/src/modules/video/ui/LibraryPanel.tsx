import { memo, useEffect, useRef, useState } from 'react';
import { Play, Plus, Square } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { getAudioContext } from '../../../core/utils/audio';
import { IconButton } from '../../../components/ui';
import { OVERLAYS, SFX, SFX_RATE, STICKERS, drawOverlay, drawSticker, renderSfx, type LibraryItem } from '../library';

/* Built-in sound effects, stickers and overlays: click to add at the playhead. */

/** Small preview picture of a sticker or overlay (drawn once). */
function Thumb({ item }: { item: LibraryItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (item.kind === 'sticker') drawSticker(ctx, item.id, c.width);
    else drawOverlay(ctx, item.id, c.width, c.height);
  }, [item]);
  return <canvas ref={ref} width={item.kind === 'sticker' ? 96 : 160} height={item.kind === 'sticker' ? 96 : 90} className={`vd-lib-thumb ${item.kind}`} />;
}

export const LibraryPanel = memo(function LibraryPanel({ onAdd }: { onAdd: (item: LibraryItem) => void }) {
  const t = useT();
  const [playing, setPlaying] = useState<string | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => source.current?.stop(), []);

  const preview = (item: LibraryItem) => {
    source.current?.stop();
    source.current = null;
    if (playing === item.id) {
      setPlaying(null);
      return;
    }
    const ctx = getAudioContext();
    const data = renderSfx(item);
    const buf = ctx.createBuffer(1, data.length, SFX_RATE);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setPlaying((p) => (p === item.id ? null : p));
    void ctx.resume();
    src.start();
    source.current = src;
    setPlaying(item.id);
  };

  const grid = (items: LibraryItem[]) => (
    <div className={`vd-lib-grid ${items[0]?.kind}`}>
      {items.map((item) => (
        <button key={item.id} type="button" className="vd-lib-item" title={`${t(item.label)} — ${t('Click to add at the playhead')}`} onClick={() => onAdd(item)}>
          <Thumb item={item} />
          <span className="vd-lib-name">{t(item.label)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="vd-section-title">{t('Sound effects')}</div>
      <div className="vd-lib-sounds">
        {SFX.map((item) => (
          <div key={item.id} className="vd-lib-sound">
            <IconButton size="sm" icon={playing === item.id ? Square : Play} label={playing === item.id ? t('Stop') : t('Listen')} onClick={() => preview(item)} />
            <span className="vd-lib-name grow" title={item.description}>
              {t(item.label)}
            </span>
            <span className="faint">{item.duration?.toFixed(1)} s</span>
            <IconButton size="sm" icon={Plus} label={t('Add at the playhead')} onClick={() => onAdd(item)} />
          </div>
        ))}
      </div>
      <div className="vd-section-title">{t('Stickers')}</div>
      {grid(STICKERS)}
      <div className="vd-section-title">{t('Overlays')}</div>
      {grid(OVERLAYS)}
      <div className="vd-hint">{t('Made by Ultima — free to use anywhere. Sounds go on a free audio track, stickers and overlays above your footage. The AI assistant can add them too.')}</div>
    </>
  );
});
