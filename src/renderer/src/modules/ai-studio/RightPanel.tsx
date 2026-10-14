import { useState } from 'react';
import { BookOpen, Pencil, Plus, Search } from 'lucide-react';
import { Button, Field, Panel, Select, Slider, TextInput } from '../../components/ui';
import { useT } from '../../core/i18n';
import { BUILTIN_PERSONAS, personaLabel } from './personas';
import { TEMPLATES, TEMPLATE_CATEGORIES, searchTemplates, type PromptTemplate } from './templates';
import { useStudio } from './store';
import type { Conversation, Persona } from './types';

const BUDGETS = [8_000, 16_000, 32_000, 64_000, 128_000, 256_000];

interface Props {
  conv: Conversation;
  persona: Persona;
  onPersona: (id: string) => void;
  onManagePersonas: (editId: string | null) => void;
  onTemplate: (tpl: PromptTemplate) => void;
}

/** Persona, context settings and the prompt library. */
export function RightPanel({ conv, persona, onPersona, onManagePersonas, onTemplate }: Props) {
  const t = useT();
  const custom = useStudio((s) => s.personas);
  const settings = useStudio((s) => s.settings);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const templates = searchTemplates(TEMPLATES, query, category, t);
  const isCustom = custom.some((p) => p.id === persona.id);

  return (
    <div className="as-right">
      <Panel title={t('Persona')}>
        <Select
          small
          value={conv.personaId}
          onChange={onPersona}
          options={[
            ...BUILTIN_PERSONAS.map((p) => ({ value: p.id, label: t(p.name) })),
            ...custom.map((p) => ({ value: p.id, label: `★ ${p.name}` })),
          ]}
          aria-label={t('Persona')}
        />
        <p className="muted as-persona-desc">{personaLabel(persona, persona.description, t) || t('Custom persona')}</p>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" icon={Plus} onClick={() => onManagePersonas(null)}>
            {t('New persona')}
          </Button>
          {isCustom && (
            <Button size="sm" icon={Pencil} onClick={() => onManagePersonas(persona.id)}>
              {t('Edit')}
            </Button>
          )}
        </div>
      </Panel>

      <Panel title={t('Memory')} defaultOpen={false}>
        <Slider
          label={t('Previous messages sent with each request')}
          value={settings.historyMessages}
          min={0}
          max={40}
          onChange={(v) => useStudio.getState().setSettings({ historyMessages: Math.round(v) })}
          format={(v) => (v ? String(v) : t('none'))}
        />
        <Field label={t('Maximum prompt size')}>
          <Select<number>
            small
            value={BUDGETS.includes(settings.charBudget) ? settings.charBudget : 32_000}
            onChange={(v) => useStudio.getState().setSettings({ charBudget: v })}
            options={BUDGETS.map((b) => ({ value: b, label: t('{count}k characters', { count: b / 1000 }) }))}
          />
        </Field>
        <p className="faint as-note">
          {t('The AI tools do not remember chats on their own, so Ultima sends the recent messages with every request. Older messages are left out when the limit is reached. Small local models work best with 8–16k.')}
        </p>
      </Panel>

      <Panel title={t('Prompt library')}>
        <div className="as-search">
          <Search size={13} />
          <TextInput small value={query} placeholder={t('Search templates…')} onChange={(e) => setQuery(e.target.value)} aria-label={t('Search templates')} />
        </div>
        <Select
          small
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: t('All categories') }, ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: t(c) }))]}
          aria-label={t('Category')}
        />
        <div className="as-template-list">
          {templates.map((tpl) => (
            <button key={tpl.id} type="button" className="as-template-row" onClick={() => onTemplate(tpl)} title={t(tpl.description)}>
              <BookOpen size={13} />
              <span className="grow">{t(tpl.title)}</span>
              <span className="faint as-template-cat-sm">{t(tpl.category)}</span>
            </button>
          ))}
          {!templates.length && <span className="faint">{t('No templates match your search.')}</span>}
        </div>
      </Panel>
    </div>
  );
}
