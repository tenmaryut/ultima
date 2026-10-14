import { useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, EmptyState } from '../../components/ui';
import { useElementSize } from '../../core/hooks';
import { useT } from '../../core/i18n';
import { sampleAverage } from './extract';
import type { LoadedImage } from './render';
import type { ColorDoc } from './state';

interface Props {
  doc: ColorDoc;
  image: LoadedImage | null;
  selected: number;
  onSelect: (index: number) => void;
  onPreview: (doc: ColorDoc) => void;
  onCommit: (label: string) => void;
  onOpenImage: () => void;
  busy: boolean;
}

/** The source image with one draggable picker point per extracted swatch. */
export function ExtractView({ doc, image, selected, onSelect, onPreview, onCommit, onOpenImage, busy }: Props) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapRef);
  const drag = useRef<{ index: number; pointerId: number; start: ColorDoc } | null>(null);

  if (!image) {
    return (
      <div className="co-extract-wrap" ref={wrapRef}>
        <EmptyState icon={<ImagePlus size={36} />} title={t('Extract a palette from an image')}>
          <span className="muted" style={{ maxWidth: 420 }}>
            {t('Open or drop a photo. Ultima finds its key colors (k-means clustering in Lab color space) and places picker points you can drag.')}
          </span>
          <Button variant="primary" icon={ImagePlus} onClick={onOpenImage}>
            {t('Open image…')}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const pad = 24;
  const availW = Math.max(50, size.width - pad * 2);
  const availH = Math.max(50, size.height - pad * 2);
  const scale = Math.min(availW / image.width, availH / image.height);
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);

  const pickAt = (clientX: number, clientY: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const hex = sampleAverage(image.pick.data, image.pick.width, image.pick.height, x * (image.pick.width - 1), y * (image.pick.height - 1), 1);
    return { x, y, hex };
  };

  const apply = (start: ColorDoc, index: number, p: { x: number; y: number; hex: string }): ColorDoc => ({
    ...start,
    rule: 'custom',
    swatches: start.swatches.map((s, i) => (i === index ? { ...s, hex: p.hex, point: { x: p.x, y: p.y } } : s)),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const marker = (e.target as Element).closest('[data-point]');
    const index = marker ? Number(marker.getAttribute('data-point')) : selected;
    if (!doc.swatches[index]) return;
    onSelect(index);
    if (doc.swatches[index].locked) return;
    const p = pickAt(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { index, pointerId: e.pointerId, start: doc };
    if (!marker) onPreview(apply(doc, index, p));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p) onPreview(apply(d.start, d.index, p));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    onCommit('Pick color from image');
  };

  return (
    <div className="co-extract-wrap" ref={wrapRef}>
      <div
        ref={boxRef}
        className={`co-extract-box ${busy ? 'busy' : ''}`}
        style={{ width: w, height: h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title={t('Click to move the selected color’s picker here')}
      >
        <img src={image.url} alt="" draggable={false} width={w} height={h} />
        {doc.swatches.map((s, i) =>
          s.point ? (
            <span
              key={s.id}
              data-point={i}
              className={`co-point ${i === selected ? 'selected' : ''} ${s.locked ? 'locked' : ''}`}
              style={{ left: `${s.point.x * 100}%`, top: `${s.point.y * 100}%`, background: s.hex }}
              title={s.hex.toUpperCase()}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
