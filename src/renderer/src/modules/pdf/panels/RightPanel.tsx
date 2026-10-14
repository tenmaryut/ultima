/**
 * Right panel with tabs: Edit, Forms, Document, AI.
 */
import { useT } from '../../../core/i18n';
import { Tabs } from '../../../components/ui';
import { usePdfUi, type RightTab } from '../store';
import { EditPanel } from './EditPanel';
import { FormsPanel } from './FormsPanel';
import { DocumentPanel } from './DocumentPanel';
import { AIToolsPanel } from './AIToolsPanel';

export function RightPanel() {
  const t = useT();
  const tab = usePdfUi((s) => s.rightTab);
  const fieldCount = usePdfUi((s) => s.docInfo?.fieldDefs.length ?? 0);
  return (
    <div className="pd-right">
      <Tabs<RightTab>
        value={tab}
        onChange={(v) => usePdfUi.getState().set({ rightTab: v })}
        tabs={[
          { value: 'edit', label: t('Edit') },
          { value: 'forms', label: fieldCount ? `${t('Forms')} (${fieldCount})` : t('Forms') },
          { value: 'document', label: t('Document') },
          { value: 'ai', label: t('AI') },
        ]}
      />
      <div className="pd-right-body">
        {tab === 'edit' && <EditPanel />}
        {tab === 'forms' && <FormsPanel />}
        {tab === 'document' && <DocumentPanel />}
        {tab === 'ai' && <AIToolsPanel />}
      </div>
    </div>
  );
}
