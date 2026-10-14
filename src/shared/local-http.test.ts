import { describe, expect, it } from 'vitest';
import { validateLocalBaseUrl } from './local-http';

describe('validateLocalBaseUrl', () => {
  it('accepts local and private network servers', () => {
    for (const url of [
      'http://127.0.0.1:11434',
      'http://localhost:1234/v1',
      'http://[::1]:8080/v1',
      'http://192.168.1.20:11434',
      'http://10.0.0.5:7860',
      'http://172.20.1.2:1234',
      'http://100.101.102.103:11434',
      'http://my-pc.local:11434',
      'https://gpu-box.tail1234.ts.net',
    ]) {
      expect(() => validateLocalBaseUrl(url)).not.toThrow();
    }
  });

  it('rejects public (possibly paid) API endpoints', () => {
    for (const url of ['https://api.openai.com/v1', 'https://api.anthropic.com', 'http://8.8.8.8:80', 'https://example.com']) {
      expect(() => validateLocalBaseUrl(url)).toThrow(/local network/);
    }
  });

  it('rejects non-http schemes and garbage', () => {
    expect(() => validateLocalBaseUrl('file:///etc/passwd')).toThrow();
    expect(() => validateLocalBaseUrl('not a url')).toThrow();
  });
});
