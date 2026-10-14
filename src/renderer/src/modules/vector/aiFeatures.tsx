import { useMemo, useRef, useState } from 'react';
import { Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button, ColorPicker, Field, IconButton, Modal, Select, Spinner, TextArea, TextInput, toast } from '../../components/ui';
import { describeAIError, runAI, runAIJson } from '../../core/ai/client';
import { extractSvg, sanitizeSvg, stripHtml } from '../../core/ai/sanitize';
import { t as tr, useT } from '../../core/i18n';
import { collectColors, normalizeColor, recolorWithMapping } from './colors';
import type { EditorCore } from './editor';
import type { FileActions } from './fileActions';
import { getFrame, mapTree } from './ops';
import { walkObjects } from './model';

const STYLES = ['Flat', 'Minimal line art', 'Geometric', 'Isometric', 'Hand-drawn', 'Retro', 'Gradient', 'Bold mascot', 'Monoline icon'];

const SVG_RULES = `Output rules:
- Reply with ONE complete, valid standalone SVG document only: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H">…</svg>
- Use only basic elements: path, rect, circle, ellipse, line, polyline, polygon, g, text, linearGradient, radialGradient, stop, defs.
- No scripts, no external images or fonts, no foreignObject, no CSS animations, no comments, no markdown fences.
- Prefer clean geometry, few nodes and solid fills; give important parts an id that describes them.`;

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function allSvgs(text: string): string[] {
  return (text.match(/<svg[\s\S]*?<\/svg>/gi) ?? []).map((s) => sanitizeSvg(s)).filter(Boolean);
}

function ColorRow({ colors, onChange }: { colors: string[]; onChange: (c: string[]) => void }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {colors.map((c, i) => (
        <span key={i} className="row" style={{ gap: 2 }}>
          <ColorPicker value={c} alpha={false} onChange={(v) => onChange(colors.map((x, k) => (k === i ? v : x)))} />
          <IconButton icon={Trash2} size="sm" label={t('Remove')} onClick={() => onChange(colors.filter((_, k) => k !== i))} />
        </span>
      ))}
      {colors.length < 6 && (
        <button type="button" className="btn sm" onClick={() => onChange([...colors, '#888888'])}>
          + {t('Color')}
        </button>
      )}
    </div>
  );
}

/** "Generate artwork": prompt + style + colors → one clean SVG → inserted as a group. */
export function GenerateArtworkDialog({ core, files, onClose }: { core: EditorCore; files: FileActions; onClose: () => void }) {
  const t = useT();
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState(STYLES[0]);
  const [colors, setColors] = useState<string[]>(() => (core.doc.swatches.length ? core.doc.swatches.slice(0, 4) : []));
  const [busy, setBusy] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const ab = core.activeArtboard;

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setSvg(null);
    setChars(0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const size = Math.round(Math.min(1024, Math.max(256, Math.min(ab.width, ab.height))));
      const res = await runAI({
        system: `You are an expert vector illustrator who writes clean, hand-optimized SVG code.\n${SVG_RULES}`,
        prompt: `Create vector artwork: ${prompt.trim()}\nStyle: ${style}.\n${colors.length ? `Use this color palette: ${colors.join(', ')}.` : 'Choose a harmonious color palette.'}\nCanvas: viewBox="0 0 ${size} ${size}".`,
        signal: ctrl.signal,
        onText: (txt) => setChars(txt.length),
      });
      const found = extractSvg(res.text);
      const clean = found ? sanitizeSvg(found) : '';
      if (!clean) throw new Error(t('The AI did not return SVG artwork. Try rephrasing the request.'));
      setSvg(clean);
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Generation failed'), describeAIError(error));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <Modal
      title={t('Generate artwork')}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      width={620}
      footer={
        <>
          {busy ? (
            <Button onClick={() => abort.current?.abort()}>{t('Stop')}</Button>
          ) : (
            <Button icon={Sparkles} onClick={() => void generate()} disabled={!prompt.trim()}>
              {svg ? t('Try again') : t('Generate')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!svg || busy}
            onClick={() => {
              if (svg && files.importSvgMarkup(svg, 'place', stripHtml(prompt).slice(0, 40) || t('AI artwork'))) onClose();
            }}
          >
            {t('Insert')}
          </Button>
        </>
      }
    >
      <Field label={t('Describe the artwork')}>
        <TextArea rows={3} value={prompt} placeholder={t('e.g. a friendly fox mascot sitting, simple shapes')} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Field label={t('Style')}>
          <Select value={style} options={STYLES.map((s) => ({ value: s, label: t(s) }))} onChange={setStyle} />
        </Field>
        <Field label={t('Colors (optional)')}>
          <ColorRow colors={colors} onChange={setColors} />
        </Field>
      </div>
      <div className="vc-ai-preview checker">
        {busy ? (
          <div className="col" style={{ alignItems: 'center' }}>
            <Spinner size={22} />
            <span className="faint">{t('Drawing… {count} characters received', { count: chars })}</span>
          </div>
        ) : svg ? (
          <img src={svgDataUrl(svg)} alt="" />
        ) : (
          <span className="faint">{t('The preview appears here.')}</span>
        )}
      </div>
    </Modal>
  );
}

/** "Logo ideas": four SVG variations side by side; pick one to insert. */
export function LogoIdeasDialog({ core, files, onClose }: { core: EditorCore; files: FileActions; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(core.doc.name !== 'Untitled' ? core.doc.name : '');
  const [about, setAbout] = useState('');
  const [style, setStyle] = useState('Minimal');
  const [colors, setColors] = useState<string[]>(() => core.doc.swatches.slice(0, 3));
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [chars, setChars] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const generate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setIdeas([]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await runAI({
        system: `You are a senior brand designer who writes clean SVG logos.\nReply with exactly FOUR different logo concepts, each as one complete standalone SVG document (viewBox="0 0 512 512"), one after another and nothing else.\n${SVG_RULES.replace('Reply with ONE complete, valid standalone SVG document only', 'Each logo is a complete standalone SVG')}`,
        prompt: `Brand name: ${name.trim()}\n${about.trim() ? `About the brand: ${about.trim()}\n` : ''}Logo style: ${style}.\n${colors.length ? `Brand colors: ${colors.join(', ')}.` : ''}\nMake the four concepts clearly different (e.g. symbol + wordmark, monogram, emblem/badge, abstract mark). Text must use common fonts (Arial, Helvetica, Georgia, Verdana).`,
        signal: ctrl.signal,
        onText: (txt) => {
          setChars(txt.length);
          setIdeas(allSvgs(txt));
        },
      });
      const found = allSvgs(res.text).slice(0, 4);
      if (!found.length) throw new Error(t('The AI did not return SVG artwork. Try rephrasing the request.'));
      setIdeas(found);
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Generation failed'), describeAIError(error));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <Modal
      title={t('Logo ideas')}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      wide
      footer={
        busy ? (
          <Button onClick={() => abort.current?.abort()}>{t('Stop')}</Button>
        ) : (
          <Button variant="primary" icon={Sparkles} onClick={() => void generate()} disabled={!name.trim()}>
            {ideas.length ? t('Generate 4 more') : t('Generate 4 ideas')}
          </Button>
        )
      }
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Field label={t('Brand name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
        </Field>
        <Field label={t('Style')}>
          <Select value={style} options={['Minimal', 'Modern', 'Playful', 'Luxury', 'Vintage', 'Tech', 'Organic'].map((s) => ({ value: s, label: t(s) }))} onChange={setStyle} />
        </Field>
        <Field label={t('Colors (optional)')}>
          <ColorRow colors={colors} onChange={setColors} />
        </Field>
      </div>
      <Field label={t('What does the brand do? (optional)')}>
        <TextInput value={about} onChange={(e) => setAbout(e.target.value)} placeholder={t('e.g. a coffee roastery in the mountains')} />
      </Field>
      <div className="vc-logo-grid">
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            type="button"
            className="vc-logo-cell checker"
            disabled={!ideas[i] || busy}
            title={ideas[i] ? t('Insert this logo') : undefined}
            onClick={() => {
              if (ideas[i] && files.importSvgMarkup(ideas[i], 'place', `${name.trim() || 'Logo'} ${i + 1}`)) onClose();
            }}
          >
            {ideas[i] ? <img src={svgDataUrl(ideas[i])} alt={`${t('Logo idea')} ${i + 1}`} /> : busy ? <Spinner size={18} /> : <span className="faint">{i + 1}</span>}
          </button>
        ))}
      </div>
      {busy && <div className="faint">{t('Drawing… {count} characters received', { count: chars })}</div>}
    </Modal>
  );
}

interface PaletteIdea {
  name: string;
  mapping: Record<string, string>;
}

/** "Recolor artwork": AI proposes palettes for the colors in use; apply one as a mapping. */
export function RecolorDialog({ core, onClose }: { core: EditorCore; onClose: () => void }) {
  const t = useT();
  const colors = useMemo(() => collectColors(core.doc.objects).slice(0, 12), [core.doc.objects]);
  const [mood, setMood] = useState('');
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<PaletteIdea[]>([]);

  const ask = async () => {
    setBusy(true);
    try {
      const { data } = await runAIJson<{ palettes?: { name?: string; mapping?: Record<string, string> }[] }>({
        system: 'You are a color expert. Reply with JSON: {"palettes":[{"name":string,"mapping":{"<original hex>":"<new hex>"}}]}. Give 4 palettes; map EVERY original color; keep light/dark contrast relationships so text stays readable.',
        prompt: `Original colors (most used first): ${colors.join(', ')}\n${mood.trim() ? `Mood / direction: ${mood.trim()}` : 'Suggest 4 attractive, distinct alternatives.'}`,
      });
      const list = (data.palettes ?? [])
        .map((p) => {
          const mapping: Record<string, string> = {};
          for (const [k, v] of Object.entries(p.mapping ?? {})) {
            const from = normalizeColor(k);
            const to = normalizeColor(v);
            if (from && to) mapping[from] = to;
          }
          return { name: stripHtml(String(p.name ?? '')).slice(0, 40) || t('Palette'), mapping };
        })
        .filter((p) => Object.keys(p.mapping).length);
      if (!list.length) throw new Error(t('The AI did not return any palettes.'));
      setIdeas(list.slice(0, 6));
    } catch (error) {
      toast.error(t('Recolor failed'), describeAIError(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = (p: PaletteIdea) => {
    const r = recolorWithMapping(core.doc.objects, p.mapping);
    core.update((d) => ({ ...d, objects: r.objects }), 'Recolor');
    toast.success(t('Recolored ({count} colors changed)', { count: r.changed }));
  };

  return (
    <Modal
      title={t('Recolor artwork')}
      onClose={onClose}
      width={560}
      footer={
        <Button variant="primary" icon={Wand2} disabled={busy || !colors.length} onClick={() => void ask()}>
          {busy ? t('Thinking…') : ideas.length ? t('Suggest more') : t('Suggest palettes')}
        </Button>
      }
    >
      {!colors.length ? (
        <div className="faint">{t('The document has no colors yet.')}</div>
      ) : (
        <>
          <Field label={t('Colors in use')}>
            <div className="vc-palette-row">
              {colors.map((c) => (
                <span key={c} className="vc-chip" style={{ background: c }} title={c} />
              ))}
            </div>
          </Field>
          <Field label={t('Direction (optional)')}>
            <TextInput value={mood} onChange={(e) => setMood(e.target.value)} placeholder={t('e.g. warm autumn, pastel, high contrast, brand blue')} />
          </Field>
          {busy && <Spinner />}
          {ideas.map((p, i) => (
            <div key={i} className="vc-palette-idea">
              <strong className="grow">{p.name}</strong>
              <div className="vc-palette-row">
                {colors.map((c) => (
                  <span key={c} className="vc-chip" style={{ background: p.mapping[c] ?? c }} title={`${c} → ${p.mapping[c] ?? c}`} />
                ))}
              </div>
              <Button size="sm" onClick={() => apply(p)}>
                {t('Apply')}
              </Button>
            </div>
          ))}
          {core.doc.swatches.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{t('Tip: the AI assistant can also map your document swatches with “recolor using my swatches”.')}</div>}
        </>
      )}
    </Modal>
  );
}

/** "Name layers": the AI gives every object a descriptive name (one undo step). */
export async function nameLayersWithAI(core: EditorCore): Promise<void> {
  const items: string[] = [];
  const ab = core.activeArtboard;
  walkObjects(core.doc.objects, (o, parents) => {
    if (items.length >= 200) return;
    const f = getFrame(core.doc.objects, o.id);
    const fill = o.type !== 'group' && o.fill.type === 'solid' ? o.fill.color : o.fill.type;
    const text = o.type === 'text' ? ` text=${JSON.stringify(o.text.slice(0, 60))}` : '';
    const where = f ? ` x=${Math.round(f.x - ab.x)} y=${Math.round(f.y - ab.y)} w=${Math.round(f.w)} h=${Math.round(f.h)}` : '';
    const kids = o.type === 'group' ? ` children=${o.children.length}` : '';
    items.push(`${o.id}: ${o.type}${where} fill=${fill}${text}${kids}${parents.length ? ` in=${parents[parents.length - 1].id}` : ''} current="${o.name}"`);
  });
  if (!items.length) {
    toast.info(tr('Nothing to name yet'));
    return;
  }
  toast.info(tr('Naming layers…'));
  try {
    const { data } = await runAIJson<{ names?: Record<string, string> }>({
      system: 'You name the layers of a vector illustration. Reply with JSON {"names":{"<id>":"<short descriptive name>"}}. Names: 1-4 words, Title Case, describe what the object depicts (e.g. "Sun", "Left Mountain", "Headline", "Logo Mark"). Use the same language as the existing text in the design (English if unsure).',
      prompt: `Objects:\n${items.join('\n')}`,
    });
    const names = data.names ?? {};
    let count = 0;
    core.update((d) => ({
      ...d,
      objects: mapTree(d.objects, (o) => {
        const n = names[o.id];
        if (typeof n !== 'string') return o;
        const clean = stripHtml(n).trim().slice(0, 60);
        if (!clean || clean === o.name) return o;
        count++;
        return { ...o, name: clean };
      }),
    }), 'Name layers');
    toast.success(tr('{count} layer(s) renamed', { count }));
  } catch (error) {
    toast.error(tr('Naming failed'), describeAIError(error));
  }
}
