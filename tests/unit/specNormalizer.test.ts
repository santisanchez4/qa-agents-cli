import { describe, it, expect } from 'vitest';
import {
  normalizeId,
  extractTitle,
  extractSteps,
  extractExpectedResults,
  extractSummary,
} from '../../src/core/specNormalizer';

describe('normalizeId', () => {
  it('normalizes a plain number', () => {
    expect(normalizeId('12345')).toBe('TC-12345');
  });

  it('keeps an already-normalized TC id', () => {
    expect(normalizeId('TC-12345')).toBe('TC-12345');
  });

  it('normalizes tc_12345 (underscore, lowercase)', () => {
    expect(normalizeId('tc_12345')).toBe('TC-12345');
  });

  it('normalizes TC12345 (no separator)', () => {
    expect(normalizeId('TC12345')).toBe('TC-12345');
  });

  it('returns null for non-numeric ids', () => {
    expect(normalizeId('abc')).toBeNull();
    expect(normalizeId('TC-')).toBeNull();
    expect(normalizeId('12.34')).toBeNull();
    expect(normalizeId('')).toBeNull();
    expect(normalizeId(undefined)).toBeNull();
  });
});

describe('extractTitle', () => {
  it('prefers the first markdown heading', () => {
    expect(extractTitle('intro line\n# Real Title\nmore')).toBe('Real Title');
  });

  it('falls back to the first non-empty line', () => {
    expect(extractTitle('\n\nLogin smoke test\nstep 1')).toBe('Login smoke test');
  });

  it('falls back to "Untitled Spec" for empty content', () => {
    expect(extractTitle('   \n\n')).toBe('Untitled Spec');
  });
});

describe('extractSteps', () => {
  it('detects numbered steps', () => {
    const steps = extractSteps('1. Open the app\n2) Click login\nnot a step');
    expect(steps).toEqual(['Open the app', 'Click login']);
  });

  it('detects Step:/Action: lines', () => {
    const steps = extractSteps('Step: navigate to home\nAction: submit form');
    expect(steps).toEqual(['navigate to home', 'submit form']);
  });

  it('returns an empty array when no steps are found', () => {
    expect(extractSteps('just a paragraph of text')).toEqual([]);
  });
});

describe('extractExpectedResults', () => {
  it('detects Expected: and Expected Result: lines', () => {
    const results = extractExpectedResults('Expected: user is logged in\nExpected Result: dashboard shown');
    expect(results).toEqual(['user is logged in', 'dashboard shown']);
  });

  it('detects Then lines', () => {
    const results = extractExpectedResults('Then the page redirects to /home');
    expect(results).toEqual(['the page redirects to /home']);
  });

  it('returns an empty array when none are found', () => {
    expect(extractExpectedResults('1. do a thing')).toEqual([]);
  });
});

describe('extractSummary', () => {
  it('returns the first meaningful non-heading line', () => {
    expect(extractSummary('# Title\nThis is the summary.\n1. step')).toBe('This is the summary.');
  });

  it('falls back to TBD when only headings/steps exist', () => {
    expect(extractSummary('# Title\n1. step one\nExpected: ok')).toBe('TBD');
  });
});
