import type { LayoutEditor } from '../useLayoutEditor';
import { CopyDialog, DesignBriefDialog, RewriteDialog } from './AIDialogs';

export type AIDialog = { kind: 'brief' } | { kind: 'rewrite'; frameId: string } | { kind: 'copy' };

export function AIDialogsHost({ dialog, ed, onClose }: { dialog: AIDialog; ed: LayoutEditor; onClose: () => void }) {
  if (dialog.kind === 'brief') return <DesignBriefDialog ed={ed} onClose={onClose} />;
  if (dialog.kind === 'rewrite') return <RewriteDialog ed={ed} frameId={dialog.frameId} onClose={onClose} />;
  return <CopyDialog ed={ed} onClose={onClose} />;
}
