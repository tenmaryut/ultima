import { FolderOpen, X } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton } from '../../../components/ui';
import { createDoc } from '../model';
import { buildTemplate } from '../templates';
import type { LayoutDoc } from '../types';
import { getPreset } from '../units';
import { TemplateGallery } from './NewDocDialog';

const QUICK = ['a4', 'letter', 'instagram-post', 'instagram-story', 'presentation', 'youtube-thumbnail', 'business-card', 'poster'];

/** First screen of the module: templates and quick blank formats. */
export function StartScreen({
  onTemplate,
  onBlank,
  onOpen,
  onClose,
}: {
  onTemplate: (doc: LayoutDoc) => void;
  onBlank: (doc: LayoutDoc) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="ly-start">
      <div className="ly-start-inner">
        <div className="row">
          <div className="grow">
            <h2>{t('What do you want to make?')}</h2>
            <div className="muted">{t('Start from a template, pick a blank format, or open a saved project.')}</div>
          </div>
          <Button icon={FolderOpen} onClick={onOpen}>
            {t('Open project…')}
          </Button>
          <IconButton icon={X} label={t('Close')} onClick={onClose} />
        </div>
        <div className="ly-quick">
          {QUICK.map((id) => {
            const p = getPreset(id)!;
            return (
              <button key={id} type="button" className="ly-quick-btn" onClick={() => onBlank(createDoc({ presetId: id }))}>
                <span className="ly-quick-name">{t(p.name)}</span>
                <span className="faint">
                  {p.w} × {p.h} {p.unit}
                </span>
              </button>
            );
          })}
        </div>
        <TemplateGallery compact onPick={(def) => onTemplate(buildTemplate(def))} />
      </div>
    </div>
  );
}
