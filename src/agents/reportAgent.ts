import { LatestRunData, readLatestRunResultSafe } from '../core/runResults';
import { buildRunReport } from '../core/reportGenerator';

/**
 * Use-case orchestration for the `report` command.
 *
 * core/reportGenerator.ts holds the reusable, retry-aware report formatting
 * (buildRunReport). This agent loads the latest run result safely and wires it
 * to the formatter. cli/ only parses the target path, calls this agent, and
 * prints the output.
 */

export type ReportAgentOptions = {
  targetRepo: string;
};

export type ReportAgentResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  runData: LatestRunData | null;
};

export function runReportAgent(options: ReportAgentOptions): ReportAgentResult {
  const read = readLatestRunResultSafe(options.targetRepo);

  if (!read.ok) {
    return {
      ok: false,
      exitCode: 1,
      errors: [read.reason === 'missing'
        ? 'No latest run result found. Run tests first.'
        : 'Could not read latest run result.'],
      runData: null,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    runData: read.data!,
  };
}

/**
 * Formats the structured report result into stdout report lines.
 * Returns an empty array when there is no run data (the CLI handles errors and
 * the exit code separately).
 */
export function buildReportAgentOutput(result: ReportAgentResult): string[] {
  if (!result.runData) return [];
  return buildRunReport(result.runData);
}
