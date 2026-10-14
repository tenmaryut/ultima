/**
 * AudioWorklet processor that forwards microphone samples to the main thread in
 * batches of ~4096 frames (planar Float32 copies). Loaded via `?worker&url`.
 */

interface ProcessorInstance {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: ProcessorInstance; new (): ProcessorInstance };
declare function registerProcessor(name: string, ctor: unknown): void;

const BATCH = 4096;

class UltimaRecorderProcessor extends AudioWorkletProcessor {
  private buffers: Float32Array[] = [];
  private filled = 0;
  private active = true;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'stop') {
        this.flush();
        this.active = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  private flush(): void {
    if (!this.filled) return;
    const out = this.buffers.map((b) => b.slice(0, this.filled));
    this.port.postMessage({ type: 'data', channels: out }, out.map((c) => c.buffer));
    this.filled = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.active) return false;
    const input = inputs[0];
    if (!input || !input.length) return true;
    if (this.buffers.length !== input.length) {
      this.flush();
      this.buffers = input.map(() => new Float32Array(BATCH));
      this.filled = 0;
    }
    const frames = input[0].length;
    let offset = 0;
    while (offset < frames) {
      const n = Math.min(frames - offset, BATCH - this.filled);
      for (let c = 0; c < input.length; c++) this.buffers[c].set(input[c].subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled >= BATCH) this.flush();
    }
    return true;
  }
}

registerProcessor('ultima-recorder', UltimaRecorderProcessor);

export {};
