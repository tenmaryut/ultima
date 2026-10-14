import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { antigravityImagePrompt, aspectName, clampRate, codexImagePrompt, comfySeed, comfyWorkflow, fillSpeechArgs, imagePathsIn, jsonStrings, nearestAspectRatio, parseEspeakVoices, parseSapiVoices, parseSayVoices, piperVoiceFromFile, sapiRate, sniffAudioMime, sniffImageMime, socialVideoArgs, wordsPerMinute } from './media-utils';

const bytes = (s: string, extra: number[] = []) => new Uint8Array([...Array.from(s, (c) => c.charCodeAt(0)), ...extra]);

describe('format sniffing', () => {
  it('recognises image formats', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('recognises audio formats', () => {
    expect(sniffAudioMime(bytes('RIFF\0\0\0\0WAVEfmt '))).toBe('audio/wav');
    expect(sniffAudioMime(bytes('ID3\x04'))).toBe('audio/mpeg');
    expect(sniffAudioMime(new Uint8Array([0xff, 0xf3, 0x44, 0xc4]))).toBe('audio/mpeg');
    expect(sniffAudioMime(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffAudioMime(bytes('FORM\0\0\0\0AIFF'))).toBe('audio/aiff');
  });
});

describe('codex image prompt', () => {
  it('asks for one image with the right aspect', () => {
    expect(aspectName(1024, 1024)).toBe('square');
    expect(aspectName(1536, 1024)).toBe('landscape');
    expect(aspectName(768, 1344)).toBe('portrait');
    const p = codexImagePrompt('  a red fox in snow ', 1536, 1024);
    expect(p).toContain('Image description: a red fox in snow');
    expect(p).toContain('landscape');
    expect(p).toContain('exactly one image');
  });
});

describe('Antigravity image helpers', () => {
  it('picks the closest supported aspect ratio', () => {
    expect(nearestAspectRatio(1024, 1024)).toBe('1:1');
    expect(nearestAspectRatio(1920, 1080)).toBe('16:9');
    expect(nearestAspectRatio(1080, 1920)).toBe('9:16');
    expect(nearestAspectRatio(1200, 900)).toBe('4:3');
    expect(nearestAspectRatio(2560, 1080)).toBe('21:9');
  });

  it('asks for one named image and its path', () => {
    const p = antigravityImagePrompt(' a kite over rice fields ', 1536, 1024, 'ultima_abc');
    expect(p).toContain('Image name: ultima_abc');
    expect(p).toContain('Aspect ratio: 3:2');
    expect(p).toContain('Image description: a kite over rice fields');
    expect(p).toContain('generate_image');
  });

  it('finds image paths in answers and JSON', () => {
    expect(imagePathsIn('/home/ana/.gemini/antigravity-cli/brain/c1/ultima_abc_1760.png')).toEqual(['/home/ana/.gemini/antigravity-cli/brain/c1/ultima_abc_1760.png']);
    expect(imagePathsIn('`/Users/Ana Lee/.gemini/x/ultima_abc.png`')).toEqual(['/Users/Ana Lee/.gemini/x/ultima_abc.png']);
    expect(imagePathsIn('Saved to C:\\Users\\ana\\.gemini\\brain\\ultima_abc.webp.')).toEqual(['C:\\Users\\ana\\.gemini\\brain\\ultima_abc.webp']);
    // A file URL of this system (file:///C:/… on Windows) turns back into its local path.
    const spaced = join(tmpdir(), 'a b', 'ultima_x.jpg');
    expect(imagePathsIn(`see ${pathToFileURL(spaced).href} and /var/tmp/y.png`)).toEqual([spaced, '/var/tmp/y.png']);
    expect(imagePathsIn('no image here, https://example.com/pic.png')).toEqual([]);
    expect(jsonStrings({ a: ['x', { b: 'y' }], c: 1, d: null })).toEqual(['x', 'y']);
  });
});

describe('ComfyUI workflow', () => {
  it('wires checkpoint, prompts, sampler and save node', () => {
    const wf = comfyWorkflow({ checkpoint: 'sd15.safetensors', prompt: 'cat', negative: 'blurry', width: 512, height: 768, steps: 20, cfg: 7, seed: 42 });
    expect(wf['4'].inputs.ckpt_name).toBe('sd15.safetensors');
    expect(wf['6'].inputs.text).toBe('cat');
    expect(wf['7'].inputs.text).toBe('blurry');
    expect(wf['5'].inputs).toMatchObject({ width: 512, height: 768 });
    expect(wf['3'].inputs).toMatchObject({ seed: 42, steps: 20, cfg: 7, positive: ['6', 0], negative: ['7', 0] });
    expect(wf['9'].class_type).toBe('SaveImage');
  });
  it('turns -1 into a random non-negative seed', () => {
    expect(comfySeed(-1, () => 0.5)).toBe(2 ** 31);
    expect(comfySeed(123)).toBe(123);
  });
});

describe('speech helpers', () => {
  it('clamps and maps the speaking rate', () => {
    expect(clampRate(5)).toBe(2);
    expect(clampRate(undefined)).toBe(1);
    expect(wordsPerMinute(1)).toBe(175);
    expect(sapiRate(1)).toBe(0);
    expect(sapiRate(2)).toBe(10);
    expect(sapiRate(0.5)).toBe(-10);
  });
  it('parses macOS say voices', () => {
    const voices = parseSayVoices('Alex                en_US    # Most people recognize me by my voice.\nDamayanti           id_ID    # Halo, nama saya Damayanti.\n');
    expect(voices).toEqual([
      { id: 'Alex', name: 'Alex', language: 'en_US' },
      { id: 'Damayanti', name: 'Damayanti', language: 'id_ID' },
    ]);
  });
  it('parses espeak-ng voices', () => {
    const table =
      'Pty Language       Age/Gender VoiceName          File                 Other Languages\n' +
      ' 5  id              --/M      Indonesian         sit/id\n' +
      ' 7  id              --/M      indonesian-mbrola-1 mb/mb-id1\n' +
      ' 5  en-us           --/M      English_(America)  gmw/en-US            (en 2)\n';
    expect(parseEspeakVoices(table)).toEqual([
      { id: 'id', name: 'Indonesian (id)', language: 'id' },
      { id: 'en-us', name: 'English (America) (en-us)', language: 'en-us' },
    ]);
  });
  it('parses SAPI voices', () => {
    expect(parseSapiVoices('Microsoft Andika\tid-ID\r\nMicrosoft Zira Desktop\ten-US\r\n')).toEqual([
      { id: 'Microsoft Andika', name: 'Microsoft Andika', language: 'id-ID' },
      { id: 'Microsoft Zira Desktop', name: 'Microsoft Zira Desktop', language: 'en-US' },
    ]);
  });
  it('names Piper voices after their file', () => {
    expect(piperVoiceFromFile('/voices/id_ID-news_tts-medium.onnx')).toEqual({ id: '/voices/id_ID-news_tts-medium.onnx', name: 'id_ID-news_tts-medium', language: 'id_ID' });
  });
  it('fills custom command placeholders without splitting arguments', () => {
    expect(fillSpeechArgs(['--file', '{text_file}', '--voice={voice}', '--write-media', '{output}', '{rate}'], { textFile: '/t/a b.txt', output: '/t/out.wav', voice: 'id-ID-GadisNeural', rate: 1.25 })).toEqual([
      '--file',
      '/t/a b.txt',
      '--voice=id-ID-GadisNeural',
      '--write-media',
      '/t/out.wav',
      '1.25',
    ]);
  });
});

describe('social upload preset (FFmpeg)', () => {
  it('writes constant-rate H.264 High + AAC with room for the platform to re-encode', () => {
    const args = socialVideoArgs(60, 24_000_000).join(' ');
    expect(args).toContain('fps=60');
    expect(args).toContain('-c:v libx264 -preset medium -crf 16 -maxrate 24000k -bufsize 48000k -profile:v high -pix_fmt yuv420p -g 120');
    expect(args).toContain('-color_primaries bt709 -color_trc bt709 -colorspace bt709');
    expect(args).toContain('-c:a aac -b:a 320k -ar 48000');
    expect(args).toContain('-movflags +faststart');
  });

  it('defaults to 30 fps and keeps the bitrate in a sane range', () => {
    expect(socialVideoArgs(undefined, undefined).join(' ')).toContain('fps=30');
    expect(socialVideoArgs(undefined, undefined).join(' ')).toContain('-maxrate 16000k');
    expect(socialVideoArgs(25, 1_000_000_000).join(' ')).toContain('-maxrate 50000k');
  });
});
