/** Audio helpers shared by Audio, Video and Motion. */

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') sharedContext = new AudioContext();
  return sharedContext;
}

export async function decodeAudio(data: ArrayBuffer | Blob): Promise<AudioBuffer> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  // decodeAudioData detaches the buffer, so pass a copy.
  return getAudioContext().decodeAudioData(buffer.slice(0));
}

/** Encodes an AudioBuffer (or channel arrays) as a PCM WAV file. */
export function encodeWav(
  input: AudioBuffer | { sampleRate: number; channels: Float32Array[] },
  bitDepth: 16 | 24 | 32 = 16,
): Blob {
  // Duck-typed so it also works where AudioBuffer doesn't exist (workers, unit tests).
  const channels =
    'getChannelData' in input
      ? Array.from({ length: input.numberOfChannels }, (_, i) => input.getChannelData(i))
      : input.channels;
  const sampleRate = input.sampleRate;
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      } else if (bitDepth === 24) {
        const v = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
      } else {
        view.setFloat32(offset, sample, true);
      }
      offset += bytesPerSample;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Mixes down and resamples to 16 kHz mono — the format local speech-to-text tools expect. */
export async function toSpeechWav(buffer: AudioBuffer): Promise<Blob> {
  const targetRate = 16000;
  const length = Math.ceil(buffer.duration * targetRate);
  const offline = new OfflineAudioContext(1, Math.max(1, length), targetRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered, 16);
}

/** Peak data for drawing waveforms: returns [min,max] pairs per bucket for one channel. */
export function computePeaks(data: Float32Array, buckets: number, start = 0, end = data.length): Float32Array {
  const peaks = new Float32Array(buckets * 2);
  const span = Math.max(1, (end - start) / buckets);
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor(start + i * span);
    const to = Math.min(end, Math.floor(start + (i + 1) * span));
    let min = 1;
    let max = -1;
    for (let j = from; j < to; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (from >= to) {
      min = 0;
      max = 0;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}
