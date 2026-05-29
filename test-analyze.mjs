function classifyFailure(f) {
  const msg = (f.message ?? '').toLowerCase();
  const raw = f.message ?? '';
  if (msg.includes('econnrefused')) return { category: 'Environment / service unavailable', likelyCause: 'A required local or remote service is not reachable.', suggestedActions: ['Check whether the required backend/service is running.'] };
  if (msg.includes('timeouterror') && msg.includes('page.goto')) return { category: 'Navigation timeout', likelyCause: 'Page navigation did not complete within the timeout.', suggestedActions: ['Check whether the target page is reachable.'] };
  if (msg.includes('timeouterror') && msg.includes('locator')) return { category: 'Locator timeout', likelyCause: 'Expected UI element was not visible or available in time.', suggestedActions: ['Verify selector/locator stability.'] };
  if (raw.includes('toHaveURL')) return { category: 'URL assertion failed', likelyCause: 'App did not navigate to the expected route.', suggestedActions: ['Verify login/auth flow result.'] };
  if (msg.includes('401') || msg.includes('unauthorized')) return { category: 'Authentication / authorization', likelyCause: 'Credentials or permissions are invalid for this environment.', suggestedActions: ['Verify user credentials for the selected environment.'] };
  return { category: 'Unknown', likelyCause: 'Not enough information to classify automatically.', suggestedActions: ['Open the Playwright trace if available.'] };
}

function cleanMojibake(text) {
  if (!text) return text;
  return text
    .replace(/â€º/g, '›')
    .replace(/â€˜/g, '‘')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€”/g, '—')
    .replace(/â€“/g, '–')
    .replace(/â€/g, '”');
}

let ok = true;
const p = (l, c) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + l); if (!c) ok = false; };

// Classification
p('ECONNREFUSED', classifyFailure({ message: 'Error: ECONNREFUSED 127.0.0.1:3000' }).category === 'Environment / service unavailable');
p('page.goto timeout', classifyFailure({ message: 'TimeoutError: page.goto: Timeout 30000ms' }).category === 'Navigation timeout');
p('locator timeout', classifyFailure({ message: 'TimeoutError: locator.click: Timeout 5000ms' }).category === 'Locator timeout');
p('toHaveURL', classifyFailure({ message: 'expect(received).toHaveURL(expected)' }).category === 'URL assertion failed');
p('401', classifyFailure({ message: 'Error: 401 Unauthorized' }).category === 'Authentication / authorization');
p('unauthorized keyword', classifyFailure({ message: 'Error: unauthorized access denied' }).category === 'Authentication / authorization');
p('unknown default', classifyFailure({ message: 'Something random failed' }).category === 'Unknown');
p('null message', classifyFailure({ message: null }).category === 'Unknown');

// TimeoutError with page.goto takes priority over generic locator
p('page.goto > locator priority', classifyFailure({ message: 'TimeoutError: page.goto: locator timeout' }).category === 'Navigation timeout');

// Mojibake cleaning
p('arrow cleaned', cleanMojibake('test â€º file') === 'test › file');
p('right single quote', cleanMojibake("don’t") === "don’t"); // passthrough
p('left double quote cleaned', cleanMojibake('â€œhello') === '“hello');
p('no crash on empty', cleanMojibake('') === '');
p('no crash on null-ish', cleanMojibake(undefined) === undefined);

// Ensure 3 suggested actions for ECONNREFUSED
const r = classifyFailure({ message: 'ECONNREFUSED' });
p('3 suggested actions', r.suggestedActions.length === 3);

process.exit(ok ? 0 : 1);
