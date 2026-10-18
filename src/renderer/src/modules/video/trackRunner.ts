import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaRef, MotionTrack } from './types';
import { PointTracker, toGray, type Gray } from './tracker';

/* Runs the point tracker over the frames of a video file (decoded with WebCodecs, at most 960 px wide). */

export interface TrackJob {
  file: File;
  media: MediaRef;
  /** Source seconds of the frame the box was drawn on. */
  at: number;
  /** Box centre and size as fractions of the source picture. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Source seconds to track (`from` ≤ `at` ≤ `to`). */
  from: number;
  to: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface TrackOutcome {
  points: MotionTrack['points'];
  /** Share of frames where the target was found. */
  found: number;
}

/** At most this many seconds per run (about 3600 frames at 60 fps). */
export const MAX_TRACK_SECONDS = 60;

const abortError = () => new DOMException('Tracking cancelled', 'AbortError');

export async function runTracker(job: TrackJob): Promise<TrackOutcome> {
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('This video cannot be decoded here.');
    const sw = job.media.width || track.displayWidth || 1280;
    const sh = job.media.height || track.displayHeight || 720;
    const k = Math.min(1, 960 / Math.max(sw, sh));
    const w = Math.max(32, Math.round(sw * k));
    const h = Math.max(32, Math.round(sh * k));
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
    const fps = Math.min(60, job.media.fps || 30);
    // whole frames: frame n is shown from n/fps; it is decoded from its middle (a time on its very edge can give the
    // frame before) and its point is kept at its start
    const frameOf = (t: number) => Math.floor(t * fps + 1e-3);
    const first = frameOf(Math.max(0, job.at));
    const last = frameOf(Math.min(job.to, job.at + MAX_TRACK_SECONDS) - 1e-3);
    const earliest = Math.max(0, frameOf(Math.max(job.from, job.at - MAX_TRACK_SECONDS) + 1e-3));
    const mid = (n: number) => (n + 0.5) / fps;
    const forward: number[] = [];
    for (let n = first + 1; n <= last; n++) forward.push(mid(n));
    const backward: number[] = [];
    for (let n = first - 1; n >= earliest; n--) backward.push(mid(n));
    const startOf = (t: number) => +(Math.floor(t * fps) / fps).toFixed(6);
    const total = forward.length + backward.length + 1;
    let done = 0;

    const gray = (c: HTMLCanvasElement | OffscreenCanvas): Gray => {
      const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
    };
    /** Frames at `times` (in any order), decoded forwards in one-second chunks so going backwards stays fast. */
    async function* frames(times: number[]): AsyncGenerator<{ t: number; g: Gray | null }> {
      const descending = times.length > 1 && times[1] < times[0];
      const chunk = Math.max(1, Math.round(fps));
      for (let i = 0; i < times.length; i += descending ? chunk : times.length) {
        const part = descending ? times.slice(i, i + chunk).reverse() : times;
        const got: { t: number; g: Gray | null }[] = [];
        let j = 0;
        for await (const wc of sink.canvasesAtTimestamps(part)) {
          if (job.signal?.aborted) throw abortError();
          const t = part[j++];
          const g = wc ? gray(wc.canvas as HTMLCanvasElement | OffscreenCanvas) : null;
          if (descending) got.push({ t, g });
          else yield { t, g };
        }
        for (const f of got.reverse()) yield f;
      }
    }

    const opening = frames([mid(first)]);
    const firstFrame = (await opening.next()).value?.g;
    await opening.return(undefined);
    if (!firstFrame) throw new Error('Could not read the frame to track.');
    const radius = Math.max(6, Math.min(48, Math.round((Math.min(job.w * w, job.h * h) || 24) / 2)));
    const start = { x: job.x * w, y: job.y * h };
    const run = async (times: number[]) => {
      const tracker = new PointTracker(firstFrame, start.x, start.y, { radius });
      if (!tracker.ok) throw new Error('There is not enough detail in the box to follow. Draw it around something with clear edges.');
      const out: MotionTrack['points'] = [];
      let n = 0;
      for await (const f of frames(times)) {
        if (!f.g) continue;
        const r = tracker.next(f.g);
        out.push({ t: startOf(f.t), x: r.x / w, y: r.y / h, s: r.lost ? 0 : +r.score.toFixed(3) });
        job.onProgress?.(++done / total);
        // keep the editor responsive
        if (++n % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return out;
    };
    const ahead = forward.length ? await run(forward) : [];
    const behind = backward.length ? await run(backward) : [];
    const points = [...behind.reverse(), { t: startOf(mid(first)), x: start.x / w, y: start.y / h, s: 1 }, ...ahead];
    job.onProgress?.(1);
    return { points, found: points.filter((q) => q.s > 0).length / points.length };
  } finally {
    input.dispose();
  }
}
