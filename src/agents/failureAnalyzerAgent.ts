import fs from 'fs';
import path from 'path';
import { FailedTest, LatestRunData } from '../core/runResults';
import { cleanMojibake, classifyFailure, buildRetryContextLines } from '../core/failureAnalyzer';

/**
 * Use-case orchestration for the `analyze-failures` command.
 *
 * core/failureAnalyzer.ts holds the reusable classification helpers
 * (cleanMojibake, classifyFailure, buildRetryContextLines). This agent loads
 * the latest run result and assembles the retry-aware failure report. cli/ only
 * parses the target path, calls this agent, and prints the report.
 */

export type FailureAnalyzerOptions = {
  targetRepo: string;
};

export type FailureAnalyzerResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  runData: LatestRunData | null;
};

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

export function runFailureAnalyzer(options: FailureAnalyzerOptions): FailureAnalyzerResult {
  const { targetRepo } = options;
  const runResultPath = path.join(targetRepo, '.qa-agents', 'runs', 'latest-run.json');
  const runResultRaw = readFileIfExists(runResultPath);

  if (!runResultRaw) {
    return {
      ok: false,
      exitCode: 1,
      errors: ['No latest run result found. Run tests first with qa-agents run.'],
      runData: null,
    };
  }

  const runData = JSON.parse(runResultRaw) as LatestRunData;

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    runData,
  };
}

/**
 * Formats the structured failure-analysis result into stdout report lines.
 * Returns an empty array when there is no run data to report (the CLI handles
 * errors and the exit code separately).
 */
export function buildFailureAnalyzerReport(result: FailureAnalyzerResult): string[] {
  const runData = result.runData;
  if (!runData) return [];

  const clean = (s: string | null | undefined): string =>
    s != null ? cleanMojibake(s) : 'N/A';

  const lines: string[] = [
    'QA Agents - Failure Analysis',
    '',
    'Target repo:',
    runData.targetRepo,
    '',
    'Run status:',
    runData.status,
    '',
    'Environment:',
    runData.environment ?? '(none)',
    '',
    'Execution target:',
    runData.target ?? '(none)',
    '',
    'Summary:',
    `- Total: ${runData.summary?.total ?? 'N/A'}`,
    `- Passed: ${runData.summary?.passed ?? 'N/A'}`,
    `- Failed: ${runData.summary?.failed ?? 'N/A'}`,
    `- Skipped: ${runData.summary?.skipped ?? 'N/A'}`,
    `- Not run: ${runData.summary?.notRun ?? 'N/A'}`,
  ];

  lines.push(...buildRetryContextLines(runData));

  const failures: FailedTest[] = runData.failedTests ?? [];

  if (runData.status === 'passed' || failures.length === 0) {
    if (runData.retry?.isRetry) {
      lines.push('', 'No failures found in retry run.', 'Original failed tests passed on retry.');
    } else {
      lines.push('', 'No failures found in latest run.');
    }
  } else {
    for (let i = 0; i < failures.length; i++) {
      const f = failures[i];
      const classification = classifyFailure(f);

      lines.push(
        '',
        `Failure ${i + 1}:`,
        `File: ${clean(f.file)}`,
        `Title: ${clean(f.title)}`,
        `Error type: ${f.errorType ?? 'N/A'}`,
        `Message: ${clean(f.message)}`,
        `Trace: ${f.trace ?? 'none'}`,
        `Screenshot: ${f.screenshot ?? 'none'}`,
        `Video: ${f.video ?? 'none'}`,
        '',
        'Classification:',
        `- Category: ${classification.category}`,
        `- Likely cause: ${classification.likelyCause}`,
        '- Suggested actions:',
        ...classification.suggestedActions.map((a, idx) => `  ${idx + 1}. ${a}`),
      );
    }
  }

  return lines;
}
