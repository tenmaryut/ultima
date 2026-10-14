/**
 * Builds the prompt sent to the (stateless) AI command-line tools: the recent part of the
 * conversation as a transcript plus the new message, trimmed to a character budget.
 * Pure — unit tested in transcript.test.ts.
 */

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

export interface TranscriptOptions {
  /** Include at most this many previous messages. */
  maxMessages?: number;
  /** Upper bound for the length of the whole prompt. */
  charBudget?: number;
}

export interface TranscriptResult {
  prompt: string;
  /** Previous messages included. */
  included: number;
  /** Previous messages left out (too old or over budget). */
  omitted: number;
  /** True when a message (or the request) had to be shortened. */
  truncated: boolean;
}

export const DEFAULT_HISTORY_MESSAGES = 12;
export const DEFAULT_CHAR_BUDGET = 32_000;
export const MIN_CHAR_BUDGET = 1_000;

export const TRANSCRIPT_HEADER = 'Here is our conversation so far, oldest message first. Continue it: reply only to my new message at the end.\n\n';
export const TRANSCRIPT_NEW = '\n\n---\nMy new message:\n';
const TRIM_MARK = '\n[… trimmed …]\n';

/** Shortens text to `max` characters keeping its beginning and its end. */
export function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= TRIM_MARK.length + 2) return text.slice(0, Math.max(0, max));
  const keep = max - TRIM_MARK.length;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return text.slice(0, head) + TRIM_MARK + (tail > 0 ? text.slice(text.length - tail) : '');
}

const label = (role: TranscriptEntry['role']) => (role === 'user' ? 'User' : 'Assistant');

export function buildTranscriptPrompt(history: TranscriptEntry[], request: string, options: TranscriptOptions = {}): TranscriptResult {
  const budget = Math.max(MIN_CHAR_BUDGET, Math.floor(options.charBudget ?? DEFAULT_CHAR_BUDGET));
  const maxMessages = Math.max(0, Math.floor(options.maxMessages ?? DEFAULT_HISTORY_MESSAGES));
  const usable = history.filter((m) => m.text.trim());
  const recent = maxMessages ? usable.slice(-maxMessages) : [];

  if (!recent.length) {
    const prompt = trimMiddle(request, budget);
    return { prompt, included: 0, omitted: usable.length, truncated: prompt !== request };
  }

  const overhead = TRANSCRIPT_HEADER.length + TRANSCRIPT_NEW.length;
  // the new message may use at most 70% of the budget so some context always fits
  const req = trimMiddle(request, Math.max(200, Math.floor((budget - overhead) * 0.7)));
  let truncated = req !== request;
  const noteReserve = 64;
  let remaining = budget - overhead - req.length - noteReserve;
  const lines: string[] = [];
  for (let i = recent.length - 1; i >= 0 && remaining > 0; i--) {
    const prefix = `${label(recent[i].role)}: `;
    const entry = prefix + recent[i].text.trim();
    const cost = entry.length + 2;
    if (cost <= remaining) {
      lines.unshift(entry);
      remaining -= cost;
      continue;
    }
    // the most recent message is too long on its own: keep a shortened copy of it
    if (!lines.length && remaining > 300) {
      lines.unshift(prefix + trimMiddle(recent[i].text.trim(), remaining - 2 - prefix.length));
      truncated = true;
    }
    break;
  }
  const included = lines.length;
  const omitted = usable.length - included;
  if (!included) {
    const prompt = trimMiddle(request, budget);
    return { prompt, included: 0, omitted, truncated: truncated || prompt !== request };
  }
  const note = omitted > 0 ? `[${omitted} earlier message${omitted === 1 ? '' : 's'} not shown]\n\n` : '';
  const prompt = TRANSCRIPT_HEADER + note + lines.join('\n\n') + TRANSCRIPT_NEW + req;
  return { prompt, included, omitted, truncated };
}

/* ------------------------------- Attachments ------------------------------- */

export interface InlineAttachment {
  kind: 'image' | 'text';
  name: string;
  text?: string;
}

export const ATTACHMENT_FILE_CAP = 30_000;
export const ATTACHMENT_TOTAL_CAP = 60_000;

/**
 * Adds attachments to the text of a message: text files are inlined (each capped, and
 * all together capped); images are mentioned (they travel separately when the AI can see
 * them, otherwise a note explains that it can't).
 */
export function withAttachments(
  text: string,
  attachments: InlineAttachment[] | undefined,
  options: { imagesSupported: boolean; fileCap?: number; totalCap?: number },
): string {
  if (!attachments?.length) return text;
  const fileCap = options.fileCap ?? ATTACHMENT_FILE_CAP;
  let total = options.totalCap ?? ATTACHMENT_TOTAL_CAP;
  const parts: string[] = [];
  for (const a of attachments) {
    if (a.kind === 'image') {
      parts.push(
        options.imagesSupported
          ? `[Attached image: ${a.name}]`
          : `[The user attached the image "${a.name}", but the selected AI cannot see images. Say so if the image matters for the answer.]`,
      );
      continue;
    }
    const body = a.text ?? '';
    if (total <= 0) {
      parts.push(`[Attached file "${a.name}" left out: too much attached text]`);
      continue;
    }
    const cap = Math.min(fileCap, total);
    const clipped = body.length > cap ? `${body.slice(0, cap)}\n[… file truncated, ${body.length - cap} more characters …]` : body;
    total -= Math.min(body.length, cap);
    parts.push(`Attached file "${a.name}":\n"""\n${clipped}\n"""`);
  }
  return [text.trim(), ...parts].filter(Boolean).join('\n\n');
}
