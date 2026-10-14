import { describe, expect, it } from 'vitest';
import type { SpeechVoice } from '@shared/ai-types';
import { fitSvg, imageProviderInfo, preferredVoice, sortVoices, speechFileName, speechProblem, svgImagePrompt } from './media';

const voices: SpeechVoice[] = [
  { id: 'Alex', name: 'Alex', language: 'en_US' },
  { id: 'Damayanti', name: 'Damayanti', language: 'id_ID' },
  { id: 'Anna', name: 'Anna', language: 'de-DE' },
  { id: 'Ava', name: 'Ava', language: 'en-US' },
];

describe('speech helpers', () => {
  it('picks a voice in the UI language', () => {
    expect(preferredVoice(voices, 'id')).toBe('Damayanti');
    expect(preferredVoice(voices, 'en')).toBe('Alex');
    expect(preferredVoice(voices, 'fr')).toBe('');
  });

  it('lists voices in the UI language first, then by name', () => {
    expect(sortVoices(voices, 'en').map((v) => v.id)).toEqual(['Alex', 'Ava', 'Anna', 'Damayanti']);
    expect(sortVoices(voices, 'id')[0].id).toBe('Damayanti');
  });

  it('names audio files after the text', () => {
    expect(speechFileName('Halo, selamat datang di Ultima!')).toBe('speech-halo-selamat-datang-di-ultima.wav');
    expect(speechFileName('Café crème', 'audio/mpeg')).toBe('speech-cafe-creme.mp3');
    expect(speechFileName('…', 'audio/ogg')).toBe('speech-clip.ogg');
  });

  it('explains why an engine cannot be used', () => {
    const t = (key: string) => key;
    expect(speechProblem(t, { id: 'system', available: true, voices: [] })).toBeNull();
    expect(speechProblem(t, { id: 'piper', available: false, detail: 'no-model', voices: [] })).toMatch(/Choose a Piper voice/);
    expect(speechProblem(t, { id: 'piper', available: false, detail: 'not-installed', voices: [] })).toMatch(/pip install piper-tts/);
    expect(speechProblem(t, { id: 'custom', available: false, detail: 'not-configured', voices: [] })).toMatch(/Set up the custom command/);
  });
});

describe('image providers', () => {
  it('only Stable Diffusion and ComfyUI take negative prompts, steps and seeds', () => {
    expect(imageProviderInfo('sd-webui').advanced).toBe(true);
    expect(imageProviderInfo('comfyui').advanced).toBe(true);
    expect(imageProviderInfo('local-openai').advanced).toBe(false);
    expect(imageProviderInfo('codex').advanced).toBe(false);
    expect(imageProviderInfo('antigravity').advanced).toBe(false);
  });

  it('only SVG drawings work without the desktop app', () => {
    expect(imageProviderInfo('svg').desktopOnly).toBe(false);
    expect(imageProviderInfo('antigravity').desktopOnly).toBe(true);
  });
});

describe('SVG drawings', () => {
  it('asks for the canvas as a viewBox', () => {
    expect(svgImagePrompt('  a lighthouse at night ', 1600, 900)).toBe('Draw this as a polished, detailed illustration:\na lighthouse at night\n\nCanvas: viewBox="0 0 1600 900".');
  });

  it('sizes the root element and adds what an image needs', () => {
    expect(fitSvg('<svg viewBox="0 0 100 50"><rect stroke-width="2" width="10" height="10"/></svg>', 800, 400)).toBe(
      '<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect stroke-width="2" width="10" height="10"/></svg>',
    );
    expect(fitSvg('<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="150"><circle r="5"/></svg>', 600, 300)).toBe(
      '<svg width="600" height="300" viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
    );
    expect(fitSvg('<svg><path d="M0 0"/></svg>', 1024, 1024)).toBe('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0"/></svg>');
  });
});
