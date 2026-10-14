/**
 * Web Worker running heavy pixel operations off the UI thread.
 * Messages: { id, op, params, width, height, buffer } → { id, ok, buffer | error }.
 * A `{ ping: true }` message is answered with `{ pong: true }` (startup check).
 */
import { runPixelOp, type PixelOp } from './ops';

interface Job {
  id: number;
  op: PixelOp;
  params: unknown;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  ping?: boolean;
}

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  if (job.ping) {
    self.postMessage({ pong: true });
    return;
  }
  try {
    const out = runPixelOp(job.op, new Uint8ClampedArray(job.buffer), job.width, job.height, job.params);
    const buffer = out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? (out.buffer as ArrayBuffer) : out.slice().buffer;
    self.postMessage({ id: job.id, ok: true, buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
