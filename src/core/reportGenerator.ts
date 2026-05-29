import { LatestRunData } from './runResults';
import { classifyFailure } from './failureAnalyzer';

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildRunReport(runData: LatestRunData): string[] {
  const lines: string[] = [
    'QA Agents - Run Report',
    '',
    'Target repo:',
    runData.targetRepo,
    '',
    'Execution:',
    `- Mode: ${runData.mode}`,
    `- Environment: ${runData.environment ?? '(none)'}`,
    `- Target: ${runData.target ?? '(none)'}`,
    `- Command: ${runData.command}`,
    `- Status: ${runData.status}`,
    `- Duration: ${formatDuration(runData.durationMs)}`,
  ];

  const s = runData.summary;
  lines.push(
    '',
    'Summary:',
    `- Total: ${s?.total ?? 'N/A'}`,
    `- Passed: ${s?.passed ?? 'N/A'}`,
    `- Failed: ${s?.failed ?? 'N/A'}`,
    `- Skipped: ${s?.skipped ?? 'N/A'}`,
    `- Not run: ${s?.notRun ?? 'N/A'}`,
  );

  const retry = runData.retry;
  const failures = runData.failedTests ?? [];

  lines.push('', 'Result:');

  if (retry?.isRetry) {
    lines.push('- Retry was executed.');
    if (runData.status === 'passed') {
      lines.push(
        '- Failed tests passed on retry.',
        '- Classification: Flaky or intermittent.',
      );
    } else {
      lines.push(
        '- Failed tests failed again.',
        '- Classification: Persistent failure.',
      );
    }
  } else if (runData.status === 'passed' || failures.length === 0) {
    lines.push('- Suite passed.');
  } else {
    const uniqueCategories = [...new Set(failures.map(f => classifyFailure(f).category))];
    const classification = uniqueCategories.length === 1
      ? uniqueCategories[0]
      : 'Multiple failure types';

    lines.push(
      '- Suite failed.',
      `- Failed tests: ${failures.length}`,
      `- Classification: ${classification}`,
    );
  }

  // Failure overview — omit when a retry run fully passed
  const showOverview = failures.length > 0 && !(retry?.isRetry && runData.status === 'passed');
  if (showOverview) {
    lines.push('', 'Failure overview:');
    failures.forEach((f, i) => {
      const category = classifyFailure(f).category;
      lines.push(
        `${i + 1}. ${f.title ?? '(unknown title)'}`,
        `   - File: ${f.file ?? 'N/A'}`,
        `   - Error type: ${f.errorType ?? 'N/A'}`,
        `   - Category: ${category}`,
      );
    });
  }

  return lines;
}
