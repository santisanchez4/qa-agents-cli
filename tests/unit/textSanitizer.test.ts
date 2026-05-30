import { describe, it, expect } from 'vitest';
import { stripAnsi, cleanText, normalizeErrorType } from '../../src/core/textSanitizer';

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    const colored = '\x1b[31mred\x1b[0m \x1b[1mbold\x1b[22m';
    expect(stripAnsi(colored)).toBe('red bold');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});

describe('cleanText', () => {
  it('strips ANSI, collapses whitespace, and trims', () => {
    const input = '  \x1b[32mhello\x1b[0m   world\n\tagain  ';
    expect(cleanText(input)).toBe('hello world again');
  });
});

describe('normalizeErrorType', () => {
  it('maps toHaveURL to URLAssertionError', () => {
    expect(normalizeErrorType('AssertionError', 'expect(page).toHaveURL failed')).toBe('URLAssertionError');
  });

  it('maps timeout + locator to LocatorTimeoutError', () => {
    expect(normalizeErrorType('Error', 'Timeout 30000ms exceeded waiting for locator')).toBe('LocatorTimeoutError');
  });

  it('maps timeout + navigation to NavigationTimeoutError', () => {
    expect(normalizeErrorType('Error', 'Timeout exceeded during navigation to /home')).toBe('NavigationTimeoutError');
  });

  it('maps 401 to AuthorizationError', () => {
    expect(normalizeErrorType('Error', 'Request failed with status 401')).toBe('AuthorizationError');
  });

  it('maps 403 to AuthorizationError', () => {
    expect(normalizeErrorType('Error', 'Server responded 403 Forbidden')).toBe('AuthorizationError');
  });

  it('keeps the original error type when nothing matches', () => {
    expect(normalizeErrorType('SomethingElseError', 'a generic failure message')).toBe('SomethingElseError');
  });

  it('returns the original (possibly null) error type for an empty message', () => {
    expect(normalizeErrorType(null, null)).toBeNull();
  });
});
