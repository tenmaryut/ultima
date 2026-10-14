/**
 * Runs pixel operations in a Web Worker (inlined as a blob so it works from file:// in the
 * desktop app too), falling back to the main thread when workers are unavailable.
 */
import PixelWorker from './worker?worker&inline';
import { runPixelOp, type PixelOp } from './ops';

interface Pending {
  resolve: (data: Uint8ClampedArray) => void;
  reject: (error: Error) => void;
}

let workerPromise: Promise<Worker | null> | null = null;
const pending = new Map<number, Pending>();
let seq = 0;

function startWorker(): Promise<Worker | null> {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise<Worker | null>((resolve) => {
    let worker: Worker;
    try {
      worker = new PixelWorker();
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 4000);
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { pong?: boolean; id?: number; ok?: boolean; buffer?: ArrayBuffer; error?: string };
      if (msg.pong) {
        clearTimeout(timer);
        resolve(worker);
        return;
      }
      if (typeof msg.id !== 'number') return;
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.ok && msg.buffer) job.resolve(new Uint8ClampedArray(msg.buffer));
      else job.reject(new Error(msg.error || 'Processing failed'));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      clearTimeout(timer);
      for (const [id, job] of pending) {
        job.reject(new Error('The image processing worker stopped (out of memory?)'));
        pending.delete(id);
      }
      resolve(null);
      workerPromise = null;
    };
    worker.postMessage({ ping: true });
  });
  return workerPromise;
}

/**
 * Runs `op` on `data` (an RGBA buffer that is TRANSFERRED to the worker — pass a copy if you
 * still need it). Resolves with the processed buffer.
 */
export async function runPixelOpAsync(op: PixelOp, data: Uint8ClampedArray, w: number, h: number, params: unknown): Promise<Uint8ClampedArray> {
  const worker = await startWorker();
  if (!worker || data.length < 4096) return runPixelOp(op, data, w, h, params);
  const buffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer;
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, params, width: w, height: h, buffer }, [buffer as ArrayBuffer]);
  });
}

/**
 * Keeps at most one job in flight and only the newest waiting one — for live previews
 * while a slider is dragged.
 */
export class PreviewRunner {
  private busy = false;
  private next: { run: () => Promise<Uint8ClampedArray>; done: (out: Uint8ClampedArray) => void; fail: (e: Error) => void } | null = null;
  private generation = 0;
  onBusy?: (busy: boolean) => void;

  request(run: () => Promise<Uint8ClampedArray>, done: (out: Uint8ClampedArray) => void, fail: (e: Error) => void = () => undefined): void {
    this.next = { run, done, fail };
    if (!this.busy) void this.pump();
  }

  cancel(): void {
    this.next = null;
    this.generation++;
  }

  private async pump(): Promise<void> {
    this.busy = true;
    this.onBusy?.(true);
    while (this.next) {
      const job = this.next;
      this.next = null;
      const gen = this.generation;
      try {
        const out = await job.run();
        if (gen === this.generation) job.done(out);
      } catch (error) {
        if (gen === this.generation) job.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.busy = false;
    this.onBusy?.(false);
  }
}
