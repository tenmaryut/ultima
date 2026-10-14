/**
 * Promise based dialogs specific to PDF Studio (password prompt, how to open several
 * files). Rendered by <PdfDialogHost/>.
 */
import { create } from 'zustand';

export type OpenChoice = 'new' | 'combine' | 'insert-end' | 'insert-after' | 'first';

export type DialogRequest =
  | { id: number; kind: 'password'; fileName: string; incorrect: boolean; resolve: (value: string | null) => void }
  | { id: number; kind: 'open'; fileNames: string[]; hasDocument: boolean; resolve: (value: OpenChoice | null) => void };

let nextId = 1;

export const usePdfDialogs = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }));

function push(req: DialogRequest) {
  usePdfDialogs.setState((s) => ({ queue: [...s.queue, req] }));
}

export function closeDialog(req: DialogRequest) {
  usePdfDialogs.setState((s) => ({ queue: s.queue.filter((r) => r !== req) }));
}

export function askPassword(fileName: string, incorrect: boolean): Promise<string | null> {
  return new Promise((resolve) => push({ id: nextId++, kind: 'password', fileName, incorrect, resolve }));
}

export function askOpenChoice(fileNames: string[], hasDocument: boolean): Promise<OpenChoice | null> {
  return new Promise((resolve) => push({ id: nextId++, kind: 'open', fileNames, hasDocument, resolve }));
}
