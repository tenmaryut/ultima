/**
 * Shows the dialog selected in the UI store (signature, split, images, export, AI tools).
 */
import { usePdfUi } from '../store';
import { SignatureDialog } from './SignatureDialog';
import { ExportImagesDialog, ImagesDialog, SplitDialog } from './PageDialogs';
import { ExtractDataDialog, FillFormDialog, TranslateDialog } from './AIDialogs';

export function DialogsHost() {
  const dialog = usePdfUi((s) => s.dialog);
  const close = () => usePdfUi.getState().set({ dialog: null });
  switch (dialog) {
    case 'signature':
      return <SignatureDialog onClose={close} />;
    case 'split':
      return <SplitDialog onClose={close} />;
    case 'images':
      return <ImagesDialog onClose={close} insert={false} />;
    case 'insert-images':
      return <ImagesDialog onClose={close} insert />;
    case 'export-images':
      return <ExportImagesDialog onClose={close} />;
    case 'translate':
      return <TranslateDialog onClose={close} />;
    case 'extract-data':
      return <ExtractDataDialog onClose={close} />;
    case 'fill-ai':
      return <FillFormDialog onClose={close} />;
    default:
      return null;
  }
}
