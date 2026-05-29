import { FailedTest } from './runResults';

export type FailureClassification = {
  category: string;
  likelyCause: string;
  suggestedActions: string[];
};

export function cleanMojibake(text: string): string {
  if (!text) return text;
  return text
    .replace(/â€º/g, '›')            // › single right angle quote
    .replace(/â€˜/g, '‘')       // ' left single quote
    .replace(/â€™/g, '’')       // ' right single quote
    .replace(/â€œ/g, '“')       // " left double quote
    .replace(/â€"/g, '—')       // — em dash (mojibake ends in right double quote)
    .replace(/â€"/g, '–')       // – en dash (mojibake ends in left double quote)
    .replace(/â€[]/g, '”')      // " right double quote (C1 control char variant)
    .replace(/â€/g, '”');       // " right double quote catch-all
}

export function classifyFailure(failure: FailedTest): FailureClassification {
  const msg = (failure.message ?? '').toLowerCase();
  const raw = failure.message ?? '';

  if (msg.includes('econnrefused')) {
    return {
      category: 'Environment / service unavailable',
      likelyCause: 'A required local or remote service is not reachable.',
      suggestedActions: [
        'Check whether the required backend/service is running.',
        'Verify the configured URL/port for this environment.',
        'If this is a staging run, confirm the test is not pointing to localhost by mistake.',
      ],
    };
  }

  if (msg.includes('timeouterror') && msg.includes('page.goto')) {
    return {
      category: 'Navigation timeout',
      likelyCause: 'Page navigation did not complete within the timeout.',
      suggestedActions: [
        'Check whether the target page is reachable.',
        'Avoid relying on waitUntil: networkidle for apps with long-running requests.',
        'Prefer waiting for a stable UI element instead of networkidle.',
      ],
    };
  }

  if (msg.includes('timeouterror') && msg.includes('locator')) {
    return {
      category: 'Locator timeout',
      likelyCause: 'Expected UI element was not visible or available in time.',
      suggestedActions: [
        'Verify selector/locator stability.',
        'Confirm the user/data state required by the test.',
        'Add a more specific assertion or wait for the correct UI state.',
      ],
    };
  }

  if (raw.includes('toHaveURL')) {
    return {
      category: 'URL assertion failed',
      likelyCause: 'App did not navigate to the expected route.',
      suggestedActions: [
        'Verify login/auth flow result.',
        'Check API response status for the action that should trigger navigation.',
        'Confirm the expected route is still correct.',
      ],
    };
  }

  if (msg.includes('401') || msg.includes('unauthorized')) {
    return {
      category: 'Authentication / authorization',
      likelyCause: 'Credentials or permissions are invalid for this environment.',
      suggestedActions: [
        'Verify user credentials for the selected environment.',
        'Check whether the user has the required role.',
        'Confirm secrets are loaded correctly.',
      ],
    };
  }

  return {
    category: 'Unknown',
    likelyCause: 'Not enough information to classify automatically.',
    suggestedActions: [
      'Open the Playwright trace if available.',
      'Review screenshot/video artifacts.',
      'Re-run the failed test individually.',
    ],
  };
}
