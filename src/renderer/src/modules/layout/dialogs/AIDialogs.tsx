import { useEffect, useRef, useState } from 'react';
import { Languages, Minimize2, Briefcase, Megaphone, SpellCheck, Maximize2, Sparkles, Square } from 'lucide-react';
import { describeAIError, runAI, runAIJson } from '../../../core/ai/client';
import { useT } from '../../../core/i18n';
import { Button, Field, Modal, Select, Spinner, TextArea, TextInput, Toggle, toast } from '../../../components/ui';
import { copyToFrames, resolveThemeRefs, validatePageSpec } from '../ai';
import { BRIEF_SYSTEM, COPY_SYSTEM, REWRITE_SYSTEM, briefPrompt, cleanAIText, copyPrompt, rewritePrompt, validateCopy, type CopyResult, type RewriteMode } from '../aiText';
import { createDoc, createPage } from '../model';
import { addPage as addPageOp, locateFrame, storyText } from '../ops';
import { paletteToTheme, resolveColor } from '../styles';
import { MASTER_ID, type LayoutDoc } from '../types';
import { PAGE_PRESETS, getPreset, presetSizePx } from '../units';
import type { LayoutEditor } from '../useLayoutEditor';

function useAIRun() {
  const [busy, setBusy] = useState(false);
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const start = () => {
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(true);
    setChars(0);
    setError(null);
    return ctrl.current.signal;
  };
  return {
    busy,
    chars,
    error,
    setChars,
    start,
    stop: () => ctrl.current?.abort(),
    fail: (e: unknown) => setError(describeAIError(e)),
    done: () => setBusy(false),
  };
}

function Progress({ busy, chars, onStop }: { busy: boolean; chars: number; onStop: () => void }) {
  const t = useT();
  if (!busy) return null;
  return (
    <div className="row ly-ai-progress">
      <Spinner size={14} />
      <span className="muted grow">{chars ? t('Writing… {n} characters', { n: chars }) : t('Thinking…')}</span>
      <Button size="sm" icon={Square} onClick={onStop}>
        {t('Stop')}
      </Button>
    </div>
  );
}

/* ---------------------------- Design from a brief ---------------------------- */

type Target = 'new-page' | 'replace' | 'new-doc';

export function DesignBriefDialog({ ed, onClose }: { ed: LayoutEditor; onClose: () => void }) {
  const t = useT();
  const ai = useAIRun();
  const [brief, setBrief] = useState('');
  const [size, setSize] = useState<string>('auto');
  const [target, setTarget] = useState<Target>('new-page');
  const [useTheme, setUseTheme] = useState(false);
  const page = ed.pageId === MASTER_ID ? ed.doc.pages[0] : ed.page;

  const generate = async () => {
    const signal = ai.start();
    try {
      const preset = size === 'auto' ? null : size === 'current' ? null : getPreset(size);
      const hint = size === 'current' ? `${Math.round(page.width)}x${Math.round(page.height)} px` : preset ? `${preset.id} (${preset.w} × ${preset.h} ${preset.unit})` : null;
      const { data } = await runAIJson<unknown>({ system: BRIEF_SYSTEM, prompt: briefPrompt(brief, hint), signal, onText: (s) => ai.setChars(s.length) });
      const fallback = size === 'current' || size === 'auto' ? { width: page.width, height: page.height, preset: page.preset } : { ...sizeOf(size), preset: size };
      const spec = validatePageSpec(data, fallback, ed.doc.styles);
      if (size === 'current') Object.assign(spec, fallback);
      else if (preset) Object.assign(spec, sizeOf(size), { preset: size });
      if (!spec.frames.length) throw new Error(t('The AI did not return any page elements. Try a more detailed brief.'));
      const aiTheme = spec.swatches ? paletteOrRoles(spec.swatches, ed.doc.swatches) : null;
      const d = ed.current();
      if (target === 'new-doc') {
        const base = createDoc({ width: spec.width, height: spec.height, unit: getPreset(spec.preset)?.unit });
        const doc: LayoutDoc = {
          ...base,
          name: brief.trim().split(/\s+/).slice(0, 5).join(' ').slice(0, 60) || 'AI design',
          swatches: aiTheme ?? base.swatches,
          pages: [{ ...base.pages[0], background: spec.background, gradient: spec.gradient, frames: spec.frames, preset: spec.preset }],
        };
        ed.replaceDocument(doc, 'Design from brief');
      } else {
        const theme = aiTheme ?? d.swatches;
        const applyTheme = useTheme && aiTheme;
        const frames = applyTheme ? spec.frames : resolveThemeRefs(spec.frames, theme);
        const background = applyTheme ? spec.background : spec.background ? resolveColor(spec.background, theme, '#ffffff') : '';
        const gradient = spec.gradient && !applyTheme ? { ...spec.gradient, stops: spec.gradient.stops.map((s) => ({ ...s, color: resolveColor(s.color, theme, '#ffffff') })) } : spec.gradient;
        const base = applyTheme ? { ...d, swatches: aiTheme } : d;
        const newPage = createPage(spec.width, spec.height, spec.preset, { background, gradient, frames, margins: page.margins });
        if (target === 'replace' && ed.pageIndex >= 0) {
          const pages = base.pages.map((p) => (p.id === ed.pageId ? { ...newPage, id: p.id, guides: p.guides, applyMaster: p.applyMaster } : p));
          ed.set({ ...base, pages }, 'Design from brief');
          ed.setSelection([]);
        } else {
          const at = Math.max(0, ed.pageIndex) + 1;
          const next = addPageOp(base, at, newPage);
          ed.set(next, 'Design from brief');
          ed.goToPage(newPage.id);
        }
      }
      toast.success(t('Design created'), spec.warnings.length ? t('Some elements were skipped: {list}', { list: spec.warnings.slice(0, 3).join(', ') }) : undefined);
      onClose();
    } catch (error) {
      if (!signal.aborted) ai.fail(error);
    } finally {
      ai.done();
    }
  };

  return (
    <Modal
      title={t('Design from a brief')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" icon={Sparkles} disabled={!brief.trim() || ai.busy} onClick={() => void generate()}>
            {t('Generate design')}
          </Button>
        </>
      }
    >
      <Field label={t('Describe what you need')}>
        <TextArea
          rows={5}
          autoFocus
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={t('e.g. Flyer for a coffee shop grand opening on Oct 20, warm colors, 20% off all drinks, address 12 Main St')}
        />
      </Field>
      <div className="row">
        <Field label={t('Size')}>
          <Select<string>
            value={size}
            onChange={setSize}
            options={[
              { value: 'auto', label: t('Let the AI choose') },
              { value: 'current', label: t('Same as the current page') },
              ...PAGE_PRESETS.map((p) => ({ value: p.id, label: t(p.name) })),
            ]}
          />
        </Field>
        <Field label={t('Put it')}>
          <Select<Target>
            value={target}
            onChange={setTarget}
            options={[
              { value: 'new-page', label: t('On a new page') },
              { value: 'replace', label: t('Replace the current page') },
              { value: 'new-doc', label: t('In a new document') },
            ]}
          />
        </Field>
      </div>
      {target !== 'new-doc' && <Toggle checked={useTheme} onChange={setUseTheme} label={t('Use the AI’s colors as the document theme')} />}
      <Progress busy={ai.busy} chars={ai.chars} onStop={ai.stop} />
      {ai.error && <div className="ly-error selectable">{ai.error}</div>}
    </Modal>
  );
}

function sizeOf(presetId: string): { width: number; height: number } {
  const p = getPreset(presetId);
  return p ? presetSizePx(p) : { width: 1080, height: 1080 };
}

/** The AI is asked for role-ordered colors; fall back to automatic roles when they look wrong. */
function paletteOrRoles(colors: string[], current: string[]): string[] {
  if (colors.length >= 6) return [...colors.slice(0, 6), ...current.slice(6)];
  return paletteToTheme(colors, current);
}

/* --------------------------------- Rewrite --------------------------------- */

export function RewriteDialog({ ed, frameId, onClose }: { ed: LayoutEditor; frameId: string; onClose: () => void }) {
  const t = useT();
  const ai = useAIRun();
  const loc = locateFrame(ed.doc, frameId);
  const original = loc?.pageId === MASTER_ID && loc.frame.type === 'text' ? loc.frame.text : storyText(ed.doc, frameId);
  const [result, setResult] = useState('');
  const [mode, setMode] = useState<RewriteMode | null>(null);

  const go = async (m: RewriteMode) => {
    setMode(m);
    setResult('');
    const signal = ai.start();
    try {
      const { text } = await runAI({
        system: REWRITE_SYSTEM,
        prompt: rewritePrompt(m, original),
        signal,
        onText: (s) => {
          ai.setChars(s.length);
          setResult(s);
        },
      });
      setResult(cleanAIText(text));
    } catch (error) {
      if (!signal.aborted) ai.fail(error);
    } finally {
      ai.done();
    }
  };

  const modes: { id: RewriteMode; label: string; icon: typeof Sparkles }[] = [
    { id: 'shorten', label: 'Shorten', icon: Minimize2 },
    { id: 'formal', label: 'More formal', icon: Briefcase },
    { id: 'catchy', label: 'Catchier', icon: Megaphone },
    { id: 'translate', label: 'Translate EN ↔ ID', icon: Languages },
    { id: 'grammar', label: 'Fix grammar', icon: SpellCheck },
    { id: 'expand', label: 'Expand', icon: Maximize2 },
  ];

  return (
    <Modal
      title={t('Rewrite text')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            disabled={!result.trim() || ai.busy}
            onClick={() => {
              ed.setText(frameId, result.trim());
              toast.success(t('Text replaced'), t('Undo restores the original.'));
              onClose();
            }}
          >
            {t('Replace text')}
          </Button>
        </>
      }
    >
      <div className="ly-rewrite-modes">
        {modes.map((m) => (
          <Button key={m.id} size="sm" icon={m.icon} variant={mode === m.id ? 'primary' : 'default'} disabled={ai.busy || !original.trim()} onClick={() => void go(m.id)}>
            {t(m.label)}
          </Button>
        ))}
      </div>
      <Field label={t('Original')}>
        <div className="ly-rewrite-original selectable">{original || t('(empty)')}</div>
      </Field>
      <Field label={t('Result')}>
        <TextArea rows={6} value={result} onChange={(e) => setResult(e.target.value)} placeholder={t('Pick a rewrite above.')} />
      </Field>
      <Progress busy={ai.busy} chars={ai.chars} onStop={ai.stop} />
      {ai.error && <div className="ly-error selectable">{ai.error}</div>}
    </Modal>
  );
}

/* ------------------------------- Generate copy ------------------------------ */

export function CopyDialog({ ed, onClose }: { ed: LayoutEditor; onClose: () => void }) {
  const t = useT();
  const ai = useAIRun();
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('friendly');
  const [length, setLength] = useState('short');
  const [language, setLanguage] = useState('same as the topic');
  const [copy, setCopy] = useState<CopyResult | null>(null);
  const textTarget = ed.selected.find((f) => f.type === 'text');

  const generate = async () => {
    const signal = ai.start();
    try {
      const { data } = await runAIJson<unknown>({ system: COPY_SYSTEM, prompt: copyPrompt(topic, tone, length, language), signal, onText: (s) => ai.setChars(s.length) });
      const valid = validateCopy(data);
      if (!valid) throw new Error(t('The AI answer did not contain any copy. Try again.'));
      setCopy(valid);
    } catch (error) {
      if (!signal.aborted) ai.fail(error);
    } finally {
      ai.done();
    }
  };

  const field = (key: keyof CopyResult, label: string, rows = 1) => (
    <Field label={t(label)}>
      {rows > 1 ? (
        <TextArea rows={rows} value={copy?.[key] ?? ''} onChange={(e) => copy && setCopy({ ...copy, [key]: e.target.value })} />
      ) : (
        <TextInput value={copy?.[key] ?? ''} onChange={(e) => copy && setCopy({ ...copy, [key]: e.target.value })} />
      )}
    </Field>
  );

  return (
    <Modal
      title={t('Generate copy')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          {copy && textTarget && (
            <Button
              onClick={() => {
                ed.setText(textTarget.id, [copy.headline, copy.body].filter(Boolean).join('\n'));
                onClose();
              }}
            >
              {t('Put in selected frame')}
            </Button>
          )}
          {copy && (
            <Button
              variant="primary"
              onClick={() => {
                const page = ed.pageId === MASTER_ID ? ed.doc.pages[0] : ed.page;
                const frames = copyToFrames(copy, page, ed.doc.styles);
                ed.insertFrames(frames, ed.pageId === MASTER_ID ? ed.doc.pages[0].id : ed.pageId, 'Add copy');
                onClose();
              }}
            >
              {t('Add to page')}
            </Button>
          )}
        </>
      }
    >
      <Field label={t('Topic')}>
        <TextInput autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('e.g. Yoga classes in the park every Sunday morning')} onKeyDown={(e) => e.key === 'Enter' && topic.trim() && void generate()} />
      </Field>
      <div className="row">
        <Field label={t('Tone')}>
          <Select<string>
            value={tone}
            onChange={setTone}
            options={['friendly', 'professional', 'bold', 'elegant', 'playful', 'urgent'].map((v) => ({ value: v, label: t(v[0].toUpperCase() + v.slice(1)) }))}
          />
        </Field>
        <Field label={t('Length')}>
          <Select<string>
            value={length}
            onChange={setLength}
            options={[
              { value: 'short', label: t('Short') },
              { value: 'medium (2 short paragraphs)', label: t('Medium') },
              { value: 'long (3-4 paragraphs)', label: t('Long') },
            ]}
          />
        </Field>
        <Field label={t('Language')}>
          <Select<string>
            value={language}
            onChange={setLanguage}
            options={[
              { value: 'same as the topic', label: t('Same as the topic') },
              { value: 'English', label: 'English' },
              { value: 'Indonesian (Bahasa Indonesia)', label: 'Bahasa Indonesia' },
            ]}
          />
        </Field>
      </div>
      <Button icon={Sparkles} variant={copy ? 'default' : 'primary'} disabled={!topic.trim() || ai.busy} onClick={() => void generate()}>
        {copy ? t('Generate again') : t('Generate')}
      </Button>
      <Progress busy={ai.busy} chars={ai.chars} onStop={ai.stop} />
      {ai.error && <div className="ly-error selectable">{ai.error}</div>}
      {copy && (
        <div className="col" style={{ gap: 8 }}>
          {field('headline', 'Headline')}
          {field('subheadline', 'Subheadline')}
          {field('body', 'Body', 5)}
          {field('cta', 'Call to action')}
        </div>
      )}
    </Modal>
  );
}

