import { LatestRunData } from './runResults';

export type FindingSeverity = 'Low' | 'Medium' | 'High';

export type FindingCategory =
  | 'Stability'
  | 'Selector quality'
  | 'Assertion quality'
  | 'Test data / environment'
  | 'Maintainability'
  | 'Failure context';

export type ReviewFinding = {
  category: FindingCategory;
  title: string;
  severity: FindingSeverity;
  evidence: string;
  whyItMatters: string;
  recommendation: string;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

type LineMatch = { lineNum: number; text: string };

function matchingLines(content: string, pattern: string | RegExp): LineMatch[] {
  return content.split('\n').reduce<LineMatch[]>((acc, line, i) => {
    const hit = typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line);
    if (hit) acc.push({ lineNum: i + 1, text: line.trim() });
    return acc;
  }, []);
}

function formatEvidence(matches: LineMatch[], max = 3): string {
  const shown = matches.slice(0, max).map(m => `Line ${m.lineNum}: ${m.text}`).join('\n   ');
  const extra = matches.length > max ? `\n   ... and ${matches.length - max} more` : '';
  return shown + extra;
}

// ─── Deterministic check rules ────────────────────────────────────────────────

export function checkStability(content: string, findings: ReviewFinding[]): void {
  const hardWaits = matchingLines(content, 'waitForTimeout');
  if (hardWaits.length > 0) {
    findings.push({
      category: 'Stability',
      title: 'Hard wait detected (waitForTimeout)',
      severity: 'Medium',
      evidence: formatEvidence(hardWaits),
      whyItMatters: 'Fixed waits make tests slow and fragile. They pass on fast machines but fail under load or in CI.',
      recommendation: 'Replace with element-based waits such as expect(locator).toBeVisible() or page.waitForSelector().',
    });
  }

  const networkIdle = matchingLines(content, 'networkidle');
  if (networkIdle.length > 0) {
    findings.push({
      category: 'Stability',
      title: 'networkidle wait strategy detected',
      severity: 'Medium',
      evidence: formatEvidence(networkIdle),
      whyItMatters: 'waitUntil: networkidle hangs indefinitely on apps with polling or WebSockets and is slow by design.',
      recommendation: 'Wait for a specific UI element that signals the page is ready instead of relying on network quiescence.',
    });
  }

  const hasToHaveURL = content.includes('toHaveURL');
  const hasResponseCheck = content.includes('response') || content.includes('.status()') || content.includes('waitForResponse');
  if (hasToHaveURL && !hasResponseCheck) {
    findings.push({
      category: 'Stability',
      title: 'URL assertion without API response validation',
      severity: 'Medium',
      evidence: 'toHaveURL used without a nearby response/status check.',
      whyItMatters: 'A redirect can occur even when the underlying action fails. Asserting only the URL may mask API errors.',
      recommendation: 'Validate that the API response succeeded, or assert a UI element that only appears after a successful action.',
    });
  }
}

export function checkSelectors(content: string, isPlaywright: boolean, findings: ReviewFinding[]): void {
  const xpathMatches = matchingLines(content, /xpath=|locator\s*\(\s*['"`]\/\//);
  if (xpathMatches.length > 0) {
    findings.push({
      category: 'Selector quality',
      title: 'XPath selectors detected',
      severity: 'Medium',
      evidence: formatEvidence(xpathMatches),
      whyItMatters: 'XPath selectors are brittle, verbose, and tightly coupled to DOM structure. They break on minor layout changes.',
      recommendation: 'Use user-facing Playwright locators: getByRole(), getByLabel(), getByText(), getByTestId().',
    });
  }

  const nthChild = matchingLines(content, 'nth-child');
  if (nthChild.length > 0) {
    findings.push({
      category: 'Selector quality',
      title: 'nth-child CSS selectors detected',
      severity: 'Medium',
      evidence: formatEvidence(nthChild),
      whyItMatters: 'nth-child selectors depend on DOM element order and break when the UI layout changes.',
      recommendation: 'Target elements by their accessible role, label, or data-testid attribute.',
    });
  }

  if (isPlaywright) {
    const hasUserLocators =
      content.includes('getByRole') ||
      content.includes('getByLabel') ||
      content.includes('getByText') ||
      content.includes('getByTestId') ||
      content.includes('getByPlaceholder');
    const hasRawLocators = content.includes('locator(') || content.includes('page.$(');
    if (!hasUserLocators && hasRawLocators) {
      findings.push({
        category: 'Selector quality',
        title: 'No user-facing Playwright locators found',
        severity: 'Low',
        evidence: 'No getByRole/getByLabel/getByText/getByTestId calls detected.',
        whyItMatters: 'User-facing locators are more resilient to DOM changes and better reflect real user interactions.',
        recommendation: 'Prefer getByRole(), getByLabel(), getByText(), or getByTestId() over raw CSS or XPath selectors.',
      });
    }
  }
}

export function checkAssertions(content: string, findings: ReviewFinding[]): void {
  const testCount = (content.match(/\btest\s*\(/g) || []).length;
  const expectCount = (content.match(/\bexpect\s*\(/g) || []).length;

  if (testCount > 0 && expectCount === 0) {
    findings.push({
      category: 'Assertion quality',
      title: 'No assertions found in test file',
      severity: 'High',
      evidence: `${testCount} test block(s) found, 0 expect() calls detected.`,
      whyItMatters: 'Tests without assertions always pass regardless of application state. They provide no regression safety.',
      recommendation: 'Add meaningful assertions after each user action. At minimum, verify the expected UI state is reached.',
    });
  } else if (testCount > 0 && expectCount < testCount) {
    findings.push({
      category: 'Assertion quality',
      title: 'Fewer assertions than tests — some tests may be under-asserted',
      severity: 'Low',
      evidence: `${testCount} test block(s), ${expectCount} expect() call(s) detected.`,
      whyItMatters: 'Tests with too few assertions may silently miss regressions in untested states.',
      recommendation: 'Review each test block to ensure critical post-action states are verified.',
    });
  }
}

export function checkTestData(content: string, findings: ReviewFinding[]): void {
  const hardcodedUrls = matchingLines(content, /['"`]https?:\/\//)
    .filter(m => !m.text.trimStart().startsWith('//'));
  if (hardcodedUrls.length > 0) {
    findings.push({
      category: 'Test data / environment',
      title: 'Hardcoded URLs detected',
      severity: 'Medium',
      evidence: formatEvidence(hardcodedUrls),
      whyItMatters: 'Hardcoded URLs make the test environment-specific and break when the base URL changes.',
      recommendation: 'Use process.env.BASE_URL or the baseURL option in playwright.config.ts.',
    });
  }

  const localhostRefs = matchingLines(content, 'localhost')
    .filter(m => !m.text.trimStart().startsWith('//'));
  if (localhostRefs.length > 0) {
    findings.push({
      category: 'Test data / environment',
      title: 'localhost reference detected',
      severity: 'Medium',
      evidence: formatEvidence(localhostRefs),
      whyItMatters: 'localhost references fail when tests run in CI or against staging/QA environments.',
      recommendation: 'Replace localhost URLs with environment variable references.',
    });
  }

  const credPattern = /(?:password|passwd|secret)\s*[:=]\s*['"`][^'"`]{2,}['"`]/i;
  const credMatches = matchingLines(content, credPattern)
    .filter(m => !m.text.trimStart().startsWith('//'));
  if (credMatches.length > 0) {
    findings.push({
      category: 'Test data / environment',
      title: 'Possible hardcoded credentials detected',
      severity: 'High',
      evidence: `${credMatches.length} line(s) with suspicious credential assignments (values redacted).`,
      whyItMatters: 'Hardcoded credentials are a security risk and break when passwords are rotated.',
      recommendation: 'Use environment variables (E2E_EMAIL, E2E_PASSWORD) loaded from .env files. Never commit credentials to source control.',
    });
  }
}

export function checkMaintainability(content: string, lineCount: number, findings: ReviewFinding[]): void {
  if (lineCount > 300) {
    findings.push({
      category: 'Maintainability',
      title: 'Test file is very long',
      severity: 'Low',
      evidence: `File has ${lineCount} lines.`,
      whyItMatters: 'Very long test files are hard to navigate and often indicate too many responsibilities in one file.',
      recommendation: 'Consider splitting into focused spec files organized by feature or user journey.',
    });
  }

  const loginHelpers = matchingLines(content, /(?:async function|const)\s+\w*[Ll]ogin\w*\s*[=(]/)
    .filter(m => !m.text.trimStart().startsWith('//'));
  if (loginHelpers.length > 1) {
    findings.push({
      category: 'Maintainability',
      title: 'Repeated login helper definitions',
      severity: 'Low',
      evidence: formatEvidence(loginHelpers),
      whyItMatters: 'Duplicated login helpers create a maintenance burden and risk diverging behavior.',
      recommendation: 'Extract login logic into a shared helper or Playwright fixture reused across spec files.',
    });
  }
}

export function checkFailureContext(
  relativeFilePath: string,
  latestRun: LatestRunData,
  findings: ReviewFinding[]
): void {
  const normalized = relativeFilePath.replace(/\\/g, '/');
  const matchedFailures = (latestRun.failedTests ?? []).filter(f => {
    if (!f.file) return false;
    const nf = f.file.replace(/\\/g, '/');
    return nf === normalized || nf.endsWith('/' + normalized) || normalized.endsWith('/' + nf);
  });

  if (matchedFailures.length === 0) return;

  const retry = latestRun.retry;
  const isRetry = retry?.isRetry ?? false;
  const isPersistent = isRetry && latestRun.status === 'failed';
  const isFlaky = isRetry && latestRun.status === 'passed';

  const evidenceParts: string[] = [
    `Latest run status: ${latestRun.status}`,
    `Environment: ${latestRun.environment ?? 'N/A'}`,
  ];
  matchedFailures.slice(0, 2).forEach(f => {
    if (f.message)    evidenceParts.push(`Failure message: ${f.message}`);
    if (f.trace)      evidenceParts.push(`Trace: ${f.trace}`);
    if (f.screenshot) evidenceParts.push(`Screenshot: ${f.screenshot}`);
  });
  if (isPersistent) evidenceParts.push('Retry result: Failed again on retry (persistent failure)');
  if (isFlaky)      evidenceParts.push('Retry result: Passed on retry (flaky/intermittent behavior)');

  findings.push({
    category: 'Failure context',
    title: isPersistent
      ? 'This test file failed on retry — persistent failure'
      : isFlaky
      ? 'This test file failed then passed on retry — flaky behavior detected'
      : 'This test file appeared in the latest run failures',
    severity: isPersistent ? 'High' : 'Medium',
    evidence: evidenceParts.join('\n   '),
    whyItMatters: isPersistent
      ? 'A persistent failure means the defect is reproducible and needs immediate investigation.'
      : 'Flaky tests reduce confidence in the suite and can mask real failures over time.',
    recommendation: isPersistent
      ? 'Review the failure message and trace. Check environment configuration, data state, and selector stability.'
      : 'Investigate the root cause of intermittent behavior. Review waits, data dependencies, and external service calls.',
  });
}
