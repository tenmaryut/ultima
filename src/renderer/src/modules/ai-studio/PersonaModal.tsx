import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, Modal, TextArea, TextInput, confirmDialog } from '../../components/ui';
import { uid } from '../../core/utils/id';
import { useT } from '../../core/i18n';
import { useStudio } from './store';
import type { Persona } from './types';

/** Create, edit and delete custom personas (saved on this computer). */
export function PersonaModal({ editId, onClose, onCreated }: { editId: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const personas = useStudio((s) => s.personas);
  const [current, setCurrent] = useState<string | null>(editId);
  const existing = personas.find((p) => p.id === current) ?? null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [instructions, setInstructions] = useState(existing?.system ?? '');

  const load = (p: Persona | null) => {
    setCurrent(p?.id ?? null);
    setName(p?.name ?? '');
    setDescription(p?.description ?? '');
    setInstructions(p?.system ?? '');
  };

  const save = () => {
    const p: Persona = { id: current ?? uid('persona'), name: name.trim().slice(0, 80), description: description.trim().slice(0, 300), system: instructions.trim().slice(0, 8000) };
    useStudio.getState().savePersona(p);
    if (!current) onCreated(p.id);
    onClose();
  };

  return (
    <Modal
      title={t('Custom personas')}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (await confirmDialog({ title: t('Delete “{name}”?', { name: existing.name }), confirmLabel: t('Delete'), danger: true })) {
                  useStudio.getState().deletePersona(existing.id);
                  load(null);
                }
              }}
            >
              {t('Delete')}
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!name.trim() || !instructions.trim()} onClick={save}>
            {current ? t('Save persona') : t('Create persona')}
          </Button>
        </>
      }
    >
      <div className="as-persona-editor">
        <div className="as-persona-list">
          <button type="button" className={`as-persona-item ${!current ? 'active' : ''}`} onClick={() => load(null)}>
            <Plus size={13} /> {t('New persona')}
          </button>
          {personas.map((p) => (
            <button key={p.id} type="button" className={`as-persona-item ${p.id === current ? 'active' : ''}`} onClick={() => load(p)}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <Field label={t('Name')}>
            <TextInput value={name} placeholder={t('e.g. Wedding photographer assistant')} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Short description')}>
            <TextInput value={description} placeholder={t('What is this persona good at?')} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t('Instructions (system prompt)')}>
            <TextArea
              rows={9}
              value={instructions}
              placeholder={t('e.g. You are a friendly assistant for my wedding photography business. You write warm, personal client emails and Instagram captions in a romantic tone…')}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
