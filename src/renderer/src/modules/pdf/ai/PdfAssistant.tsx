/**
 * The module's AI assistant (chat that can edit the document through validated actions).
 */
import { useT } from '../../../core/i18n';
import { AIAssistantPanel } from '../../../components/ai/AIAssistantPanel';
import { useDoc } from '../context';
import { applyAIActions, buildAIContext, PDF_AI_INSTRUCTIONS } from './aiActions';

export function PdfAssistant() {
  const t = useT();
  const history = useDoc();
  return (
    <AIAssistantPanel
      moduleId="pdf"
      moduleName="PDF Studio"
      instructions={PDF_AI_INSTRUCTIONS}
      getContext={() => buildAIContext(history.present)}
      onActions={(actions) => applyAIActions(actions, history)}
      suggestions={[t('What is this page about?'), t('Highlight all dates'), t('Rotate this page'), t('Fill the form with my details')]}
      placeholder={t('Ask about this page or tell the AI what to change…')}
    />
  );
}
