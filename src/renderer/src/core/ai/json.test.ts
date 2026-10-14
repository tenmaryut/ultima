import { describe, expect, it } from 'vitest';
import { extractJson, findBalanced, partialJsonMessage, repairJson } from './json';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON with surrounding text', () => {
    expect(extractJson('Sure!\n```json\n{"message":"ok","actions":[]}\n```\nEnjoy')).toEqual({ message: 'ok', actions: [] });
  });
  it('finds the first balanced object even with braces in strings', () => {
    const text = 'Result: {"message":"use {curly} braces","actions":[{"type":"x"}]} trailing';
    expect(extractJson<{ message: string }>(text).message).toBe('use {curly} braces');
  });
  it('repairs trailing commas and smart quotes', () => {
    expect(extractJson('{“a”: [1, 2,],}')).toEqual({ a: [1, 2] });
  });
  it('throws on non-JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/valid JSON/);
  });
});

describe('helpers', () => {
  it('findBalanced handles arrays', () => {
    expect(findBalanced('x [1,[2,3]] y')).toBe('[1,[2,3]]');
  });
  it('repairJson strips comment lines', () => {
    expect(JSON.parse(repairJson('{\n// note\n"a": 1\n}'))).toEqual({ a: 1 });
  });
  it('partialJsonMessage reads an unfinished message', () => {
    expect(partialJsonMessage('{"message": "Making it war')).toBe('Making it war');
    expect(partialJsonMessage('{"message": "Line\\nTwo", "actions": [')).toBe('Line\nTwo');
    expect(partialJsonMessage('{"actions": []')).toBeNull();
  });
});

import { extractSvg } from './sanitize';

describe('extractSvg', () => {
  it('returns the outer svg when svgs are nested', () => {
    const text = 'Here: <svg viewBox="0 0 10 10"><svg x="1"><rect/></svg><circle r="2"/></svg> done';
    expect(extractSvg(text)).toBe('<svg viewBox="0 0 10 10"><svg x="1"><rect/></svg><circle r="2"/></svg>');
  });
  it('returns null for unbalanced markup', () => {
    expect(extractSvg('<svg><g>')).toBeNull();
    expect(extractSvg('no svg')).toBeNull();
  });
});
