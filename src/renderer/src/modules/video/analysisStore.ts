import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { analyzeAudio, busiest, frameDifference, monoMix, sceneCuts, type AudioAnalysis } from './analysis';
import { readPcm } from './audioSource';
import type { MediaLibrary } from './media';
import type { MediaRef } from './types';

/* Runs the content analysis for media in the background and keeps the results (runtime only). */

export interface SceneAnalysis {
  cuts: number[];
  /** Times with the most movement in the picture. */
  busiest: number[];
}

export interface MediaAnalysis {
  audio: AudioAnalysis | null;
  scenes: SceneAnalysis | null;
  /** Only this many seconds from the start were analysed (very long media). */
  analysedSeconds: number;
}

/** Longest stretch analysed per media item. */
const MAX_SECONDS = 600;
/** Most frames compared for scene changes. */
const MAX_FRAMES = 600;

async function analyseAudio(media: MediaRef, file: File): Promise<AudioAnalysis | null> {
  if (!media.hasAudio || media.duration <= 0) return null;
  const until = Math.min(media.duration, MAX_SECONDS);
  // read in one-minute pieces so very long files never sit in memory twice
  const parts: Float32Array[] = [];
  let rate = 0;
  for (let from = 0; from < until; from += 60) {
    const pcm = await readPcm(media, file, from, Math.min(until, from + 60));
    if (!pcm) return null;
    rate = pcm.sampleRate;
    parts.push(monoMix(pcm.channels));
    await new Promise((r) => setTimeout(r, 0));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const mono = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    mono.set(p, off);
    off += p.length;
  }
  return analyzeAudio([mono], rate);
}

async function analyseScenes(media: MediaRef, file: File): Promise<SceneAnalysis | null> {
  if (media.kind !== 'video' || media.duration < 1) return null;
  const until = Math.min(media.duration, MAX_SECONDS);
  const step = Math.max(0.5, until / MAX_FRAMES);
  const times: number[] = [];
  for (let t = 0; t < until - 0.05; t += step) times.push(+t.toFixed(3));
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { width: 64, height: 36, fit: 'fill' });
    const diffs: number[] = [];
    const used: number[] = [];
    let prev: Uint8ClampedArray | null = null;
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      const t = times[i++];
      if (!wc) continue;
      const ctx = (wc.canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) continue;
      const data = ctx.getImageData(0, 0, 64, 36).data;
      if (prev) diffs.push(frameDifference(prev, data));
      prev = data;
      used.push(t);
      if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    if (used.length < 3) return null;
    // place each cut on the right frame: a second, finer look between the two samples around it
    const rough = sceneCuts(diffs, used);
    const cuts: number[] = [];
    for (const c of rough) {
      const fine: number[] = [];
      for (let t = Math.max(0, c - step / 2 - 0.05); t <= Math.min(until, c + step / 2 + 0.05); t += 1 / 15) fine.push(+t.toFixed(3));
      let best = { d: -1, t: c };
      let last: Uint8ClampedArray | null = null;
      let k = 0;
      for await (const wc of sink.canvasesAtTimestamps(fine)) {
        const t = fine[k++];
        const ctx = wc ? ((wc.canvas as HTMLCanvasElement | OffscreenCanvas).getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null) : null;
        if (!ctx) continue;
        const data = ctx.getImageData(0, 0, 64, 36).data;
        if (last) {
          const d = frameDifference(last, data);
          if (d > best.d) best = { d, t };
        }
        last = data;
      }
      cuts.push(Math.round(best.t * 100) / 100);
    }
    // movement inside shots: leave the cuts themselves out
    const cutSet = new Set(rough);
    const inShot = diffs.map((d, i) => (cutSet.has(Math.round(((used[i] + used[i + 1]) / 2) * 100) / 100) ? 0 : d));
    return { cuts, busiest: busiest(inShot, used, 5) };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

export class AnalysisStore {
  private results = new Map<string, MediaAnalysis | null>();
  private running = new Map<string, Promise<MediaAnalysis | null>>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private lib: MediaLibrary) {}

  /** Result for a media item, 'pending' while it runs, null when there is nothing to analyse. */
  get(id: string): MediaAnalysis | 'pending' | null {
    if (this.running.has(id)) return 'pending';
    return this.results.get(id) ?? null;
  }

  /** Starts the analysis of a media item (one at a time, in the background). */
  ensure(media: MediaRef): Promise<MediaAnalysis | null> {
    const key = media.id;
    if (this.results.has(key)) return Promise.resolve(this.results.get(key) ?? null);
    const busy = this.running.get(key);
    if (busy) return busy;
    if (media.kind === 'image') return Promise.resolve(null);
    const job = this.chain.then(async () => {
      const file = this.lib.file(media.id);
      if (!file) return null;
      const [audio, scenes] = [await analyseAudio(media, file).catch(() => null), await analyseScenes(media, file).catch(() => null)];
      return audio || scenes ? { audio, scenes, analysedSeconds: Math.min(media.duration, MAX_SECONDS) } : null;
    });
    this.chain = job.catch(() => null);
    const tracked = job
      .then((r) => {
        this.results.set(key, r);
        return r;
      })
      .catch(() => {
        this.results.set(key, null);
        return null;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, tracked);
    return tracked;
  }

  /** Waits (at most `ms`) for the analysis of these media items. */
  async waitFor(media: MediaRef[], ms: number): Promise<void> {
    const jobs = media.map((m) => this.ensure(m));
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, ms))]);
  }

  /** Forgets a media item (removed or relinked). */
  forget(id: string): void {
    this.results.delete(id);
  }
}
