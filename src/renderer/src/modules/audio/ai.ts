/**
 * AI assistant integration for the Audio Editor: instructions (every action and its
 * fields), the document context (no image: file info, selection, stats, silence,
 * loudness per second, markers, transcript) and the validated action executor that
 * applies one reply as ONE undo step.
 */
import type { AIAction, AIContext } from '../../components/ai/AIAssistantPanel';
import { t } from '../../core/i18n';
import { audio } from './controller';
import { mt } from './mt';
import { ui } from './state';
import { EFFECTS, resolveEffectId } from './dsp/effects';
import { FADE_CURVES, gainToDb, type FadeCurve } from './dsp/basic';
import { WAVEFORMS, type Waveform } from './dsp/generate';
import { analyze, applyEffect, findSilence, generate, removeSilence } from './ops';

export const AUDIO_AI_INSTRUCTIONS = `You edit audio in the Ultima Audio Editor (like Adobe Audition).
All times are in SECONDS from the start of the file (decimals allowed). Levels are in dB / dBFS.
The CURRENT DOCUMENT section gives the duration, selection, cursor, statistics, silent ranges, a coarse loudness-per-second summary, markers and the transcript (when available).

ACTIONS
- {"type":"select","start":s,"end":s} — select a range (start < end). Following actions without start/end apply to it.
- {"type":"effect","name":NAME,"params":{...},"start"?:s,"end"?:s} — apply an effect to start..end; without them to the current selection, or the whole file when nothing is selected. NAME and params (unit, range):
  amplify {"gainDb": -48..48}
  normalize {"mode":"peak"|"loudness","peakDb": -30..0 (default -1),"lufs": -40..-5 (default -16),"perChannel": bool,"limit": bool}
  fadeIn / fadeOut {"curve":"linear"|"log"|"exp"|"scurve"}
  reverse {} · invert {}
  speed {"factor": 0.25..4} — tape style: duration AND pitch change
  pitch {"semitones": -12..12,"cents": -100..100} — keeps the duration
  eq {"bands":[{"type":"peaking"|"lowshelf"|"highshelf"|"lowpass"|"highpass"|"bandpass"|"notch","freq": 20..20000 Hz,"gain": -24..24 dB,"q": 0.1..18}]} — max 6 bands
  highpass {"freq": 20..5000 Hz,"order":"2"|"4"|"8"} · lowpass {"freq": 200..20000 Hz,"order":"2"|"4"|"8"}
  compressor {"thresholdDb": -60..0,"ratio": 1..20,"attackMs": 0.1..200,"releaseMs": 10..2000,"kneeDb": 0..24,"makeupDb": -12..24,"autoMakeup": bool}
  limiter {"ceilingDb": -12..0,"inputGainDb": 0..24,"releaseMs": 1..1000,"lookaheadMs": 0.5..20}
  gate {"thresholdDb": -80..0,"attackMs": 0.1..50,"holdMs": 0..500,"releaseMs": 5..1000,"rangeDb": 0..80}
  reverb {"roomSize": 0..1,"decay": 0.2..10 s,"damping": 0..1,"preDelayMs": 0..200,"mix": 0..1}
  echo {"delayMs": 10..2000,"feedback": 0..0.95,"mix": 0..1,"pingPong": bool}
  distortion {"type":"soft"|"hard"|"fuzz","driveDb": 0..48,"toneHz": 500..16000,"mix": 0..1,"outputDb": -24..6}
  stereoToMono {} · monoToStereo {} · swapChannels {} · dcOffset {} — channel conversions always apply to the whole file
  noiseReduction {"reductionDb": 0..48 (default 18),"sensitivity": 0..10 (default 5)} — uses the captured noise print, otherwise estimates the noise from the quietest parts
  autoClean {} — high-pass 80 Hz + noise reduction + compressor + normalize to -1 dBFS (best one-step voice cleanup)
  removeSilence {"thresholdDb": -80..-10 (default -45),"minDuration": 0.1..5 s (default 0.6),"padding": 0..1 s (default 0.15)}
- {"type":"trim","start":s,"end":s} — keep ONLY start..end and delete everything else (crop).
- {"type":"delete","start":s,"end":s} — delete a range; later audio moves earlier.
- {"type":"fade","kind":"in"|"out","start":s,"end":s,"curve":"linear"|"log"|"exp"|"scurve"}
- {"type":"normalize","target":dB,"mode"?:"peak"|"loudness"} — peak target in dBFS (e.g. -1), or integrated loudness target in LUFS with mode "loudness" (e.g. -16 for podcasts, -14 for streaming).
- {"type":"generateTone","waveform":"sine"|"square"|"sawtooth"|"triangle","frequency": 20..20000 Hz,"amplitudeDb": -60..0,"duration": 0.01..600 s,"at"?: s} — inserts a tone at "at" (default: the cursor).
- {"type":"addMarker","time":s,"label":"text"}
- {"type":"autoClean"} — same as the autoClean effect (on the selection or whole file).

RULES
- Actions run in order. delete/trim/removeSilence/speed change the timeline: when deleting several ranges, list them from the END of the file towards the start.
- Use the transcript times to find spoken words or sentences, and the silent ranges for pauses.
- Never invent times beyond the duration. If a request is impossible (e.g. no audio), explain and return [].

EXAMPLES
User: "remove the long pauses and make it louder" →
{"message":"Removed the long pauses and normalized to -1 dBFS.","actions":[{"type":"effect","name":"removeSilence","params":{"thresholdDb":-45,"minDuration":0.8,"padding":0.2}},{"type":"normalize","target":-1}]}
User: "fade out the last 3 seconds" (duration 62.5) →
{"message":"Added a 3-second fade-out.","actions":[{"type":"fade","kind":"out","start":59.5,"end":62.5,"curve":"log"}]}`;

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-∞');

/** Plain-text summary of the document for the AI. */
export async function buildAIContext(): Promise<AIContext> {
  const sr = audio.sampleRate;
  const len = audio.length;
  const lines: string[] = [];
  const s = ui();
  if (!len) {
    lines.push(`No audio is loaded (empty document, ${sr} Hz, ${audio.doc.channels.length || 2} channels). Only generateTone works.`);
  } else {
    const dur = len / sr;
    lines.push(`File: "${s.docName}" (${audio.sourceFormat || 'audio'}), duration ${f(dur, 3)} s, ${sr} Hz, ${audio.doc.channels.length === 1 ? 'mono' : `${audio.doc.channels.length} channels`}.`);
    lines.push(s.selection ? `Selection: ${f(s.selection.start / sr, 3)}–${f(s.selection.end / sr, 3)} s (${f((s.selection.end - s.selection.start) / sr, 3)} s).` : 'Selection: none (effects apply to the whole file).');
    lines.push(`Cursor: ${f(s.cursor / sr, 3)} s. Noise print: ${audio.noiseProfile ? 'captured' : 'none (automatic estimation)'}.`);
    const stats = await analyze('all');
    if (stats) {
      lines.push(`Statistics (whole file): peak ${f(gainToDb(stats.peak), 1)} dBFS, RMS ${f(gainToDb(stats.rms), 1)} dB, integrated loudness ${f(stats.loudness, 1)} LUFS, clipped samples ${stats.clipped}.`);
      const per = stats.perSecond;
      if (per.length) {
        const bucket = Math.max(1, Math.ceil(per.length / 120));
        const values: string[] = [];
        for (let i = 0; i < per.length; i += bucket) values.push(Math.round(Math.max(...per.slice(i, i + bucket))).toString());
        lines.push(`Loudness per ${bucket === 1 ? 'second' : `${bucket} seconds (max of each block)`} in LUFS (-70 = silence): ${values.join(' ')}`);
      }
    }
    try {
      const silences = await findSilence({ thresholdDb: -45, minDuration: 0.5 }, { start: 0, end: len });
      const shown = silences.slice(0, 40).map((r) => `${f(r.start / sr)}–${f(r.end / sr)}`);
      lines.push(silences.length ? `Silent ranges below -45 dBFS, at least 0.5 s (${silences.length}${silences.length > 40 ? ', first 40' : ''}): ${shown.join(', ')}` : 'Silent ranges: none longer than 0.5 s below -45 dBFS.');
    } catch {
      // ignore
    }
    if (audio.doc.markers.length) {
      lines.push(`Markers: ${audio.doc.markers.slice(0, 60).map((m) => `${f(m.pos / sr)} s "${m.label}"`).join('; ')}`);
    }
    if (audio.doc.transcript.length) {
      let text = '';
      for (const seg of audio.doc.transcript) {
        const line = `[${f(seg.start / sr)}–${f(seg.end / sr)}] ${seg.text.replace(/\s+/g, ' ').trim()}\n`;
        if (text.length + line.length > 8000) {
          text += '[…transcript truncated…]\n';
          break;
        }
        text += line;
      }
      lines.push(`Transcript:\n${text}`);
    }
  }
  if (mt.session.tracks.length) {
    lines.push(`Multitrack session (not editable by actions): ${mt.session.tracks.map((tr) => `"${tr.name}" (${tr.clips.length} clips${tr.mute ? ', muted' : ''})`).join(', ')}.`);
  }
  return { summary: lines.join('\n') };
}

/* --------------------------------- executor --------------------------------- */

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Validates a [start, end] pair in seconds → samples within the file, or null. */
function rangeOf(a: AIAction): { start: number; end: number } | null {
  const s = num(a.start);
  const e = num(a.end);
  if (s === null || e === null) return null;
  const sr = audio.sampleRate;
  const len = audio.length;
  const start = Math.max(0, Math.min(len, Math.round(Math.min(s, e) * sr)));
  const end = Math.max(0, Math.min(len, Math.round(Math.max(s, e) * sr)));
  return end - start >= 1 ? { start, end } : null;
}

export async function applyAIActions(actions: AIAction[]): Promise<string> {
  if (audio.busy) throw new Error(t('Please wait for the current operation to finish'));
  if (!audio.length && !actions.some((a) => a?.type === 'generateTone')) throw new Error(t('Open or record some audio first'));
  const done: string[] = [];
  let skipped = 0;
  audio.doc.begin(t('AI edit'), audio.selection());
  try {
    for (const a of actions.slice(0, 40)) {
      if (!a || typeof a.type !== 'string') {
        skipped++;
        continue;
      }
      switch (a.type) {
        case 'select': {
          const r = rangeOf(a);
          if (!r) {
            skipped++;
            break;
          }
          audio.setSelection(r);
          done.push(t('selected'));
          break;
        }
        case 'effect': {
          const id = resolveEffectId(a.name);
          if (id === null && String(a.name).toLowerCase().replace(/[^a-z]/g, '') === 'removesilence') {
            const p = (a.params ?? {}) as Record<string, unknown>;
            const res = await removeSilence(
              {
                thresholdDb: Math.min(-10, Math.max(-80, num(p.thresholdDb) ?? -45)),
                minDuration: Math.min(5, Math.max(0.1, num(p.minDuration) ?? 0.6)),
                padding: Math.min(1, Math.max(0, num(p.padding) ?? 0.15)),
              },
              rangeOf(a),
            );
            if (res) done.push(t('removed {count} pauses', { count: res.count }));
            break;
          }
          if (!id || !EFFECTS.some((e) => e.id === id)) {
            skipped++;
            break;
          }
          const ok = await applyEffect(id, (a.params ?? {}) as Record<string, unknown>, { range: rangeOf(a), quiet: true });
          if (ok) done.push(t(EFFECTS.find((e) => e.id === id)!.name));
          else skipped++;
          break;
        }
        case 'trim': {
          const r = rangeOf(a);
          if (!r) {
            skipped++;
            break;
          }
          audio.doc.replaceRange(r.end, audio.length, null, t('Crop'));
          audio.doc.replaceRange(0, r.start, null, t('Crop'));
          audio.setSelection(null);
          audio.setCursor(0);
          done.push(t('trimmed'));
          break;
        }
        case 'delete': {
          const r = rangeOf(a);
          if (!r) {
            skipped++;
            break;
          }
          audio.doc.replaceRange(r.start, r.end, null, t('Delete'));
          audio.setSelection(null);
          audio.setCursor(r.start);
          done.push(t('deleted {s} s', { s: ((r.end - r.start) / audio.sampleRate).toFixed(2) }));
          break;
        }
        case 'fade': {
          const r = rangeOf(a);
          const curve = FADE_CURVES.includes(a.curve as FadeCurve) ? (a.curve as FadeCurve) : 'linear';
          if (!r) {
            skipped++;
            break;
          }
          const ok = await applyEffect(a.kind === 'in' ? 'fadeIn' : 'fadeOut', { curve }, { range: r, quiet: true });
          if (ok) done.push(a.kind === 'in' ? t('fade in') : t('fade out'));
          break;
        }
        case 'normalize': {
          const target = num(a.target) ?? -1;
          const loud = a.mode === 'loudness' || target < -9;
          const ok = await applyEffect('normalize', loud ? { mode: 'loudness', lufs: Math.min(-5, Math.max(-40, target)), limit: true } : { mode: 'peak', peakDb: Math.min(0, Math.max(-30, target)) }, {
            range: rangeOf(a),
            quiet: true,
          });
          if (ok) done.push(loud ? t('normalized to {v} LUFS', { v: target }) : t('normalized to {v} dBFS', { v: target }));
          break;
        }
        case 'generateTone': {
          const at = num(a.at);
          if (at !== null) audio.setCursor(Math.round(Math.max(0, at) * audio.sampleRate));
          audio.setSelection(null);
          const waveform = WAVEFORMS.includes(a.waveform as Waveform) ? (a.waveform as Waveform) : 'sine';
          const r = generate({
            kind: 'tone',
            waveform,
            frequency: Math.min(20000, Math.max(20, num(a.frequency) ?? 440)),
            amplitudeDb: Math.min(0, Math.max(-60, num(a.amplitudeDb) ?? -6)),
            duration: Math.min(600, Math.max(0.01, num(a.duration) ?? 1)),
          });
          if (r) done.push(t('tone'));
          break;
        }
        case 'addMarker': {
          const time = num(a.time);
          if (time === null) {
            skipped++;
            break;
          }
          const label = typeof a.label === 'string' ? a.label.replace(/[\r\n]+/g, ' ').slice(0, 120) : '';
          if (audio.addMarker(Math.round(Math.max(0, time) * audio.sampleRate), label)) done.push(t('marker'));
          break;
        }
        case 'autoClean': {
          const ok = await applyEffect('autoClean', {}, { range: rangeOf(a), quiet: true });
          if (ok) done.push(t('Auto Clean Voice'));
          break;
        }
        default:
          skipped++;
      }
    }
    audio.doc.commit(audio.selection());
  } catch (error) {
    audio.doc.rollback();
    throw error;
  }
  const summary = done.length ? done.join(', ') : t('No changes');
  return skipped ? `${summary} · ${t('{count} action(s) skipped', { count: skipped })}` : summary;
}
