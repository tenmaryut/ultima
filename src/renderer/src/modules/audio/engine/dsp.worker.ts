/**
 * DSP worker: runs effects, resampling and analysis off the main thread so the editor
 * stays responsive on long files. Receives { id, job } and answers with progress,
 * done (transferring result buffers) or error messages.
 */
import { resultTransferables, runDspJob, type DspJob } from '../dsp/jobs';

interface JobMessage {
  type: 'job';
  id: number;
  job: DspJob;
}

const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as JobMessage | { type: 'ping' };
  if (msg.type === 'ping') {
    scope.postMessage({ type: 'pong' });
    return;
  }
  if (msg.type !== 'job') return;
  const { id, job } = msg;
  let last = 0;
  try {
    const result = runDspJob(job, (fraction) => {
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      scope.postMessage({ type: 'progress', id, value: fraction });
    });
    scope.postMessage({ type: 'done', id, result }, resultTransferables(result));
  } catch (error) {
    scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
