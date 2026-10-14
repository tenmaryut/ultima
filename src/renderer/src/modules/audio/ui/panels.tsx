import { useEffect, useState } from 'react';
import { Activity, Bookmark, ChevronsLeftRight, Download, Plus, RefreshCw, Trash2, WandSparkles } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { formatBytes } from '../../../core/utils/format';
import { Button, DropdownButton, IconButton, Panel, Spinner, promptDialog } from '../../../components/ui';
import { audio } from '../controller';
import { useAudioUI } from '../state';
import { analyze } from '../ops';
import { exportMarkers } from '../files';
import { gainToDb } from '../dsp/basic';
import { formatClock } from './draw';
import { openEffect } from './menus';

const db = (v: number) => (v > 0 && Number.isFinite(gainToDb(v)) ? `${gainToDb(v).toFixed(1)} dB` : '-∞');

export function FileInfoPanel() {
  const t = useT();
  useAudioUI((s) => s.revision);
  const name = useAudioUI((s) => s.docName);
  const len = audio.length;
  const sr = audio.sampleRate;
  const rows: [string, string][] = [
    [t('Name'), name || t('Untitled')],
    [t('Format'), audio.sourceFormat || '—'],
    [t('Sample rate'), `${sr} Hz`],
    [t('Channels'), audio.doc.channels.length === 1 ? t('Mono') : audio.doc.channels.length === 2 ? t('Stereo') : String(audio.doc.channels.length)],
    [t('Duration'), formatClock(len / sr)],
    [t('Memory'), formatBytes(audio.doc.channels.reduce((s, c) => s + c.byteLength, 0) + audio.doc.historyBytes)],
  ];
  return (
    <Panel title={t('File')}>
      <div className="au-kv">
        {rows.map(([k, v]) => (
          <div key={k} className="au-kv-row">
            <span className="faint">{k}</span>
            <span className="au-kv-value" title={v}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function StatsPanel() {
  const t = useT();
  const revision = useAudioUI((s) => s.revision);
  const stats = useAudioUI((s) => s.stats);
  const running = useAudioUI((s) => s.statsRunning);
  const selection = useAudioUI((s) => s.selection);
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const effectiveScope = scope === 'selection' && selection ? 'selection' : 'all';
  // auto-analyse files up to ~20 minutes
  useEffect(() => {
    if (!audio.length || audio.length / audio.sampleRate > 1200) return;
    const timer = setTimeout(() => void analyze(effectiveScope), 400);
    return () => clearTimeout(timer);
  }, [revision, effectiveScope, selection]);
  const current = stats && stats.version === audio.doc.version ? stats : null;
  const d = current?.data;
  return (
    <Panel
      title={t('Statistics')}
      actions={<IconButton icon={RefreshCw} size="sm" label={t('Analyze')} disabled={!audio.length || running} onClick={() => void analyze(effectiveScope)} />}
    >
      <div className="row">
        <select className="select sm" value={effectiveScope} onChange={(e) => setScope(e.target.value as 'all' | 'selection')}>
          <option value="all">{t('Whole file')}</option>
          <option value="selection" disabled={!selection}>
            {t('Selection')}
          </option>
        </select>
        {running && <Spinner size={13} />}
      </div>
      {!d && !running && (
        <Button size="sm" icon={Activity} disabled={!audio.length} onClick={() => void analyze(effectiveScope)}>
          {t('Analyze')}
        </Button>
      )}
      {d && (
        <div className="au-kv">
          <div className="au-kv-row">
            <span className="faint">{t('Peak')}</span>
            <span className="au-kv-value">{db(d.peak)}FS</span>
          </div>
          <div className="au-kv-row">
            <span className="faint">{t('RMS')}</span>
            <span className="au-kv-value">{db(d.rms)}</span>
          </div>
          <div className="au-kv-row">
            <span className="faint">{t('Loudness (integrated)')}</span>
            <span className="au-kv-value">{Number.isFinite(d.loudness) ? `${d.loudness.toFixed(1)} LUFS` : '—'}</span>
          </div>
          <div className="au-kv-row">
            <span className="faint">{t('Clipped samples')}</span>
            <span className="au-kv-value" style={{ color: d.clipped ? 'var(--danger)' : undefined }}>
              {d.clipped.toLocaleString()}
            </span>
          </div>
          {d.perChannel.length > 1 &&
            d.perChannel.map((c, i) => (
              <div key={i} className="au-kv-row">
                <span className="faint">{i === 0 ? t('Left') : i === 1 ? t('Right') : `#${i + 1}`}</span>
                <span className="au-kv-value">
                  {db(c.peak)} · {t('RMS')} {db(c.rms)}
                </span>
              </div>
            ))}
          <div className="au-kv-row">
            <span className="faint">{t('DC offset')}</span>
            <span className="au-kv-value">{d.perChannel.map((c) => `${(c.dcOffset * 100).toFixed(3)}%`).join(' / ')}</span>
          </div>
          {d.perSecond.length > 1 && <LoudnessSparkline values={d.perSecond} />}
        </div>
      )}
    </Panel>
  );
}

function LoudnessSparkline({ values }: { values: number[] }) {
  const t = useT();
  const w = 240;
  const h = 36;
  const n = values.length;
  const step = Math.max(1, Math.ceil(n / w));
  const points: string[] = [];
  for (let i = 0; i < n; i += step) {
    const slice = values.slice(i, i + step);
    const v = Math.max(...slice);
    const x = (i / Math.max(1, n - 1)) * w;
    const y = h - ((Math.max(-60, v) + 60) / 60) * (h - 2) - 1;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="faint" style={{ fontSize: 11 }}>
        {t('Loudness over time')}
      </span>
      <svg className="au-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t('Loudness over time')}>
        <polyline points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function MarkersPanel() {
  const t = useT();
  useAudioUI((s) => s.revision);
  const markers = audio.doc.markers;
  const sr = audio.sampleRate;
  return (
    <Panel
      title={`${t('Markers')}${markers.length ? ` (${markers.length})` : ''}`}
      actions={
        <>
          <IconButton icon={Plus} size="sm" label={t('Add marker (M)')} disabled={!audio.length} onClick={() => audio.addMarker()} />
          <DropdownButton
            className="icon-btn sm"
            title={t('Export markers')}
            entries={[
              { label: t('Text list (.txt)'), onClick: () => void exportMarkers('txt') },
              { label: t('Spreadsheet (.csv)'), onClick: () => void exportMarkers('csv') },
              { label: t('YouTube chapters'), onClick: () => void exportMarkers('chapters') },
            ]}
          >
            <Download size={13} />
          </DropdownButton>
        </>
      }
    >
      {!markers.length && <div className="faint" style={{ fontSize: 12 }}>{t('Press M during playback or at the cursor to add a marker. Double-click the ruler to add one there.')}</div>}
      <div className="list au-markers">
        {markers.map((m) => (
          <div key={m.id} className="list-item au-marker-item" onClick={() => audio.seek(m.pos)} title={t('Jump to marker')}>
            <Bookmark size={12} color="var(--au-marker)" />
            <span className="mono faint" style={{ fontSize: 11 }}>
              {formatClock(m.pos / sr, 2)}
            </span>
            <span
              className="grow au-marker-label"
              onDoubleClick={async (e) => {
                e.stopPropagation();
                const label = await promptDialog({ title: t('Rename marker'), defaultValue: m.label, confirmLabel: t('Rename') });
                if (label !== null && label.trim()) audio.updateMarker(m.id, { label: label.trim().slice(0, 120) });
              }}
            >
              {m.label}
            </span>
            <IconButton
              icon={ChevronsLeftRight}
              size="sm"
              label={t('Select to next marker')}
              onClick={(e) => {
                e.stopPropagation();
                const next = markers.find((x) => x.pos > m.pos);
                audio.setSelection({ start: m.pos, end: next ? next.pos : audio.length });
              }}
            />
            <IconButton
              icon={Trash2}
              size="sm"
              label={t('Delete marker')}
              onClick={(e) => {
                e.stopPropagation();
                audio.removeMarker(m.id);
              }}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}

const QUICK: { id: Parameters<typeof openEffect>[0]; label: string }[] = [
  { id: 'amplify', label: 'Amplify' },
  { id: 'normalize', label: 'Normalize' },
  { id: 'fadeIn', label: 'Fade In' },
  { id: 'fadeOut', label: 'Fade Out' },
  { id: 'noiseReduction', label: 'Noise Reduction' },
  { id: 'eq', label: 'Parametric EQ' },
  { id: 'compressor', label: 'Compressor' },
  { id: 'reverb', label: 'Reverb' },
];

export function QuickEffectsPanel() {
  const t = useT();
  useAudioUI((s) => s.revision);
  const has = audio.length > 0;
  return (
    <Panel title={t('Effects')}>
      <Button variant="primary" size="sm" icon={WandSparkles} disabled={!has} onClick={() => openEffect('autoClean')}>
        {t('Auto Clean Voice')}
      </Button>
      <div className="au-quick-grid">
        {QUICK.map((q) => (
          <button key={q.id} type="button" className="chip" disabled={!has} onClick={() => openEffect(q.id)}>
            {t(q.label)}
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function HistoryPanel() {
  const t = useT();
  useAudioUI((s) => s.revision);
  const undo = audio.doc.undoLabels;
  const redo = audio.doc.redoLabels;
  return (
    <Panel title={t('History')} defaultOpen={false}>
      <div className="list au-history">
        <div className={`list-item ${undo.length === 0 ? 'selected' : ''}`} onClick={() => audio.doc.jumpTo(0)}>
          <span className="faint">{t('Opened')}</span>
        </div>
        {undo.map((label, i) => (
          <div key={`u${i}`} className={`list-item ${i === undo.length - 1 ? 'selected' : ''}`} onClick={() => audio.doc.jumpTo(i + 1)}>
            {label}
          </div>
        ))}
        {redo.map((label, i) => (
          <div key={`r${i}`} className="list-item au-history-redo" onClick={() => audio.doc.jumpTo(undo.length + i + 1)}>
            {label}
          </div>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        {t('Undo memory: {size} (max 100 steps)', { size: formatBytes(audio.doc.historyBytes) })}
      </div>
    </Panel>
  );
}
