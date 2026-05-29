// Covers SGR and most other common ANSI/VT escape sequences
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '');
}

export function cleanText(value: string): string {
  return stripAnsi(value).replace(/\s+/g, ' ').trim();
}

export function normalizeErrorType(errorType: string | null, message: string | null): string | null {
  const raw = message ?? '';
  const msg = raw.toLowerCase();

  if (raw.includes('toHaveURL')) return 'URLAssertionError';
  if (msg.includes('timeout') && msg.includes('locator')) return 'LocatorTimeoutError';
  if (msg.includes('timeout') && msg.includes('navigation')) return 'NavigationTimeoutError';
  if (msg.includes('401') || msg.includes('403')) return 'AuthorizationError';

  return errorType;
}
