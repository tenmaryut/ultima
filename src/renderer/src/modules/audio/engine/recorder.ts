/**
 * Microphone recording as raw PCM (AudioWorklet, with a ScriptProcessor fallback),
 * with live input levels. Echo cancellation / noise suppression / AGC are disabled so
 * the recording is clean.
 */
import workletUrl from './recorder.worklet.ts?worker&url';

export interface InputDevice {
  id: string;
  label: string;
}

export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export interface RecorderLevels {
  peak: number[];
  rms: number[];
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[][] = [];
  private recording = false;
  private frames = 0;
  private last: RecorderLevels = { peak: [0], rms: [0] };
  private hold: number[] = [0];
  sampleRate = 48000;
  channelCount = 1;

  /** Opens the input (starts metering, not recording). */
  async open(deviceId: string | undefined, channels: 1 | 2): Promise<void> {
    this.close();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this environment.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: channels },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.sampleRate = ctx.sampleRate;
    this.sourceNode = ctx.createMediaStreamSource(this.stream);
    const trackChannels = this.stream.getAudioTracks()[0]?.getSettings().channelCount ?? channels;
    this.channelCount = Math.max(1, Math.min(channels, trackChannels || channels));
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    const onData = (channelsData: Float32Array[]) => this.handle(channelsData);
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'ultima-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: this.channelCount,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent) => {
        if (event.data?.type === 'data') onData(event.data.channels as Float32Array[]);
      };
      this.node = node;
    } catch {
      // ScriptProcessor fallback (deprecated but universally available)
      const proc = ctx.createScriptProcessor(4096, this.channelCount, this.channelCount);
      proc.onaudioprocess = (e) => {
        const data: Float32Array[] = [];
        for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) data.push(e.inputBuffer.getChannelData(c).slice());
        onData(data);
      };
      this.node = proc;
    }
    this.sourceNode.connect(this.node);
    this.node.connect(this.sink);
    this.hold = new Array(this.channelCount).fill(0);
  }

  private handle(data: Float32Array[]): void {
    const count = this.channelCount;
    const peak: number[] = [];
    const rms: number[] = [];
    for (let c = 0; c < count; c++) {
      const d = data[Math.min(c, data.length - 1)];
      let p = 0;
      let s = 0;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > p) p = v;
        s += d[i] * d[i];
      }
      peak.push(p);
      rms.push(Math.sqrt(s / Math.max(1, d.length)));
      this.hold[c] = Math.max(p, (this.hold[c] ?? 0) * 0.92);
    }
    this.last = { peak: this.hold.slice(), rms };
    if (this.recording) {
      const frame = Array.from({ length: count }, (_, c) => data[Math.min(c, data.length - 1)]);
      this.chunks.push(frame);
      this.frames += frame[0].length;
    }
  }

  get isOpen(): boolean {
    return Boolean(this.stream);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  levels(): RecorderLevels {
    return this.last;
  }

  /** Seconds recorded so far. */
  elapsed(): number {
    return this.frames / this.sampleRate;
  }

  start(): void {
    if (!this.stream) throw new Error('The microphone is not open');
    this.chunks = [];
    this.frames = 0;
    this.recording = true;
  }

  /** Stops recording and returns the audio (the input stays open for metering). */
  stop(): { channels: Float32Array[]; sampleRate: number } {
    this.recording = false;
    const count = this.channelCount;
    const out = Array.from({ length: count }, () => new Float32Array(this.frames));
    let pos = 0;
    for (const chunk of this.chunks) {
      for (let c = 0; c < count; c++) out[c].set(chunk[c], pos);
      pos += chunk[0].length;
    }
    this.chunks = [];
    this.frames = 0;
    return { channels: out, sampleRate: this.sampleRate };
  }

  close(): void {
    this.recording = false;
    try {
      this.sourceNode?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      // ignore
    }
    if (this.node && 'port' in this.node) this.node.port.postMessage('stop');
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.sourceNode = null;
    this.sink = null;
  }
}
