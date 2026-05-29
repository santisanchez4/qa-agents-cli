import { LatestRunData } from '../core/runResults';
import {
  FindingSeverity,
  ReviewFinding,
  checkStability,
  checkSelectors,
  checkAssertions,
  checkTestData,
  checkMaintainability,
  checkFailureContext,
} from '../core/reviewRules';

export type { FindingSeverity, ReviewFinding };
export type { FindingCategory } from '../core/reviewRules';

export type ReviewContext = {
  targetRepo: string;
  relativeFilePath: string;
  fileContent: string;
  framework: string;
  testCommand: string;
  repoRules: string | null;
  executionConfig: string | null;
  latestRun: LatestRunData | null;
};

export type ReviewResult = {
  findings: ReviewFinding[];
  riskLevel: FindingSeverity;
  recommendedAction: string;
};

export function runAiReview(context: ReviewContext): ReviewResult {
  const findings: ReviewFinding[] = [];
  const { fileContent, relativeFilePath, framework, latestRun } = context;
  const lineCount = fileContent.split('\n').length;
  const isPlaywright = framework.toLowerCase().includes('playwright');

  checkStability(fileContent, findings);
  checkSelectors(fileContent, isPlaywright, findings);
  checkAssertions(fileContent, findings);
  checkTestData(fileContent, findings);
  checkMaintainability(fileContent, lineCount, findings);
  if (latestRun) checkFailureContext(relativeFilePath, latestRun, findings);

  const hasHigh = findings.some(f => f.severity === 'High');
  const hasMedium = findings.some(f => f.severity === 'Medium');

  let riskLevel: FindingSeverity;
  let recommendedAction: string;

  if (hasHigh) {
    riskLevel = 'High';
    recommendedAction = 'Address high-severity findings before next run. Do not merge until resolved.';
  } else if (hasMedium) {
    riskLevel = 'Medium';
    recommendedAction = 'Review medium-severity findings. Prioritize selector and stability improvements.';
  } else if (findings.length > 0) {
    riskLevel = 'Low';
    recommendedAction = 'Low-risk findings only. Address when time allows.';
  } else {
    riskLevel = 'Low';
    recommendedAction = 'No significant issues found. Test looks healthy.';
  }

  return { findings, riskLevel, recommendedAction };
}

export function buildAiReviewReport(context: ReviewContext, result: ReviewResult): string[] {
  const { targetRepo, relativeFilePath, framework, testCommand, latestRun } = context;
  const { findings, riskLevel, recommendedAction } = result;

  const lines: string[] = [
    'QA Agents - AI Automation Review',
    '',
    'Target repo:',
    targetRepo,
    '',
    'Test file:',
    relativeFilePath,
    '',
    'Review mode:',
    '- AI provider: not connected yet',
    '- Engine: deterministic static review',
    '',
    'Project context:',
    `- Framework: ${framework}`,
    `- Test command: ${testCommand}`,
    `- Environment from latest run: ${latestRun?.environment ?? 'N/A'}`,
    `- Target from latest run: ${latestRun?.target ?? 'N/A'}`,
    `- Latest run status: ${latestRun?.status ?? 'N/A'}`,
    '',
    'Review summary:',
    `- Risk level: ${riskLevel}`,
    `- Findings: ${findings.length}`,
    `- Recommended next action: ${recommendedAction}`,
  ];

  if (findings.length === 0) {
    lines.push('', 'No significant issues found. Test appears healthy.');
    return lines;
  }

  lines.push('', 'Findings:');
  findings.forEach((f, i) => {
    lines.push(
      '',
      `${i + 1}. [${f.category}] ${f.title}`,
      `   Severity: ${f.severity}`,
      `   Evidence:`,
      `   ${f.evidence}`,
      '',
      `   Why it matters: ${f.whyItMatters}`,
      `   Recommendation: ${f.recommendation}`,
    );
  });

  return lines;
}
