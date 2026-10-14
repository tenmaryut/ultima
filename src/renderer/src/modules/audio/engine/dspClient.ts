/**
 * Runs DSP jobs in a Web Worker with progress and cancellation. Falls back to the
 * main thread when workers are unavailable (the worker answers a ping first, so no
 * job buffers are ever transferred to a worker that failed to start).
 */
import DspWorker from './dsp.worker.ts?worker';
import { runDspJob, type DspJob, type DspResult } from '../dsp/jobs';

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

interface Pending {
  resolve: (r: DspResult) => void;
  reject: (e: unknown) => void;
  onProgress?: (f: number) => void;
}

function jobTransferables(job: DspJob): ArrayBuffer[] {
  const list = new Set<ArrayBuffer>();
  for (const c of job.channels) if (c.buffer instanceof ArrayBuffer && c.byteOffset === 0 && c.byteLength === c.buffer.byteLength) list.add(c.buffer);
  return [...list];
}

export class DspClient {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private disabled = false;

  private start(): Promise<boolean> {
    if (this.disabled) return Promise.resolve(false);
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) {
          this.disabled = true;
          this.worker?.terminate();
          this.worker = null;
          this.ready = null;
        }
        resolve(ok);
      };
      try {
        const worker = new DspWorker({ name: 'ultima-audio-dsp' });
        this.worker = worker;
        worker.onmessage = (event: MessageEvent) => {
          const msg = event.data as { type: string; id?: number; value?: number; result?: DspResult; message?: string };
          if (msg.type === 'pong') return done(true);
          const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
          if (!p) return;
          if (msg.type === 'progress') p.onProgress?.(msg.value ?? 0);
          else if (msg.type === 'done') {
            this.pending.delete(msg.id!);
            p.resolve(msg.result ?? {});
          } else if (msg.type === 'error') {
            this.pending.delete(msg.id!);
            p.reject(new Error(msg.message || 'Processing failed'));
          }
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          if (!settled) return done(false);
          const error = new Error(event.message || 'The audio processor crashed');
          for (const p of this.pending.values()) p.reject(error);
          this.pending.clear();
          this.worker?.terminate();
          this.worker = null;
          this.ready = null;
        };
        worker.postMessage({ type: 'ping' });
        setTimeout(() => done(false), 4000);
      } catch {
        done(false);
      }
    });
    return this.ready;
  }

  /**
   * Runs a job. With `transfer: true` the job's channel buffers are moved to the worker
   * (zero-copy) — only pass copies you no longer need; otherwise they are cloned.
   */
  async run(job: DspJob, options: { onProgress?: (f: number) => void; signal?: AbortSignal; transfer?: boolean } = {}): Promise<DspResult> {
    if (options.signal?.aborted) throw new CancelledError();
    const ok = await this.start();
    if (!ok || !this.worker) {
      // main-thread fallback: give the UI a moment to paint the progress dialog first
      await new Promise((r) => setTimeout(r, 40));
      if (options.signal?.aborted) throw new CancelledError();
      return runDspJob(job, options.onProgress);
    }
    const id = this.nextId++;
    const worker = this.worker;
    return new Promise<DspResult>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new CancelledError());
        // the only way to stop a running job is to restart the worker
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.ready = null;
        }
        for (const p of this.pending.values()) p.reject(new CancelledError());
        this.pending.clear();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (r) => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve(r);
        },
        reject: (e) => {
          options.signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
        onProgress: options.onProgress,
      });
      try {
        worker.postMessage({ type: 'job', id, job }, options.transfer ? jobTransferables(job) : []);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new CancelledError());
    this.pending.clear();
  }
}
