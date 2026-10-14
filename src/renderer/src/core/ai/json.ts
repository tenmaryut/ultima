/**
 * Robustly pulls a JSON value out of an AI answer. Models sometimes wrap JSON in
 * ```json fences, add a sentence before/after it, or leave trailing commas.
 */
export function extractJson<T = unknown>(text: string): T {
  const candidates: string[] = [];
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1].trim());
  const balanced = findBalanced(text);
  if (balanced) candidates.push(balanced);
  candidates.push(text.trim());

  let lastError: unknown;
  for (const c of candidates) {
    for (const variant of [c, repairJson(c)]) {
      try {
        return JSON.parse(variant) as T;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new Error(`The AI did not return valid JSON (${lastError instanceof Error ? lastError.message : 'parse error'})`);
}

/** First balanced {...} or [...] block, respecting strings. */
export function findBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Fixes the most common model mistakes: trailing commas, smart quotes, // comments. */
export function repairJson(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

/**
 * Reads the (possibly incomplete) "message" string out of a JSON answer that is still
 * streaming in, so the UI can show the assistant's reply while it is being written.
 */
export function partialJsonMessage(text: string, key = 'message'): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`);
  const m = re.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1].replace(/\\$/, '')}"`) as string;
  } catch {
    return m[1];
  }
}
