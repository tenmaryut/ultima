import { Circle, Crosshair, Target, Trash2, Type, Users } from 'lucide-react';
import type { Clip } from '../types';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Panel } from '../../../components/ui';
import { trackSpan, trackSureness } from '../tracking';
import type { TrackingApi } from '../useTracking';

/* Motion tracking for a video clip: track something, then pin a crosshair, a circle, a text or other clips to it. */

export function TrackingPanel({ clip, tracking, selected }: { clip: Clip; tracking: TrackingApi; selected: number }) {
  const t = useT();
  const tracks = clip.tracks ?? [];
  const busy = Boolean(tracking.job) || tracking.pick !== null;
  return (
    <Panel title={t('Motion tracking')} defaultOpen={tracks.length > 0}>
      <div className="vd-hint">{t('Follow something that moves (an enemy, a car, a face) and pin a crosshair, a circle or a text to it.')}</div>
      <Button icon={Target} disabled={busy || clip.freeze} onClick={() => tracking.startPick(clip.id)}>
        {tracking.pick === clip.id ? t('Draw the box on the picture…') : t('Track something…')}
      </Button>
      {tracks.map((tr) => {
        const span = trackSpan(clip, tr);
        return (
          <div key={tr.id} className="vd-track-row">
            <span className="name">{tr.name}</span>
            <span className="muted grow">
              {span ? `${span.start.toFixed(2)}–${span.end.toFixed(2)} s` : t('trimmed away')} · {t('{pct}% found', { pct: Math.round(trackSureness(tr) * 100) })}
            </span>
            <IconButton icon={Trash2} label={t('Delete motion track')} onClick={() => tracking.remove(clip.id, tr.id)} />
            <div className="row" style={{ gap: 4, flexWrap: 'wrap', width: '100%' }}>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('Pin to it:')}
              </span>
              <Button size="sm" icon={Crosshair} disabled={!span} onClick={() => tracking.follow(clip.id, tr.id, 'crosshair')}>
                {t('Crosshair')}
              </Button>
              <Button size="sm" icon={Circle} disabled={!span} onClick={() => tracking.follow(clip.id, tr.id, 'circle')}>
                {t('Circle')}
              </Button>
              <Button size="sm" icon={Type} disabled={!span} onClick={() => tracking.follow(clip.id, tr.id, 'text')}>
                {t('Text')}
              </Button>
              <Button size="sm" icon={Users} disabled={!span || selected === 0} title={t('Ctrl+click titles or stickers on the timeline first')} onClick={() => tracking.follow(clip.id, tr.id, 'selected')}>
                {t('Selected clips ({count})', { count: selected })}
              </Button>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
