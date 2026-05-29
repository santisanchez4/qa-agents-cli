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
import { resolveAiProvider } from '../core/aiProviderResolver';
import { buildReviewerPrompt } from '../core/reviewerPromptBuilder';

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
  aiEnabled: boolean;
};

export type ReviewResult = {
  findings: ReviewFinding[];
  riskLevel: FindingSeverity;
  recommendedAction: string;
};

export type AiLayerStatus = 'completed' | 'skipped' | 'error' | 'not-implemented';

export type AiLayerResult = {
  status: AiLayerStatus;
  reason: string;
  provider?: string;
  model?: string;
  content?: string;
  additionalFindings: ReviewFinding[];
};

// ─── Deterministic review (always runs) ──────────────────────────────────────

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

// ─── Optional AI-assisted layer ───────────────────────────────────────────────

export async function runAiLayer(
  context: ReviewContext,
  result: ReviewResult
): Promise<AiLayerResult | null> {
  if (!context.aiEnabled) return null;

  const provider = resolveAiProvider();

  if (!provider.isConfigured()) {
    return {
      status: 'skipped',
      reason: 'AI provider is not configured.',
      additionalFindings: [],
    };
  }

  // Provider is configured — build prompt and call the provider.
  const prompt = buildReviewerPrompt({
    targetRepo: context.targetRepo,
    relativeFilePath: context.relativeFilePath,
    framework: context.framework,
    testCommand: context.testCommand,
    repoRules: context.repoRules,
    latestRunStatus: context.latestRun?.status ?? null,
    latestRunEnvironment: context.latestRun?.environment ?? null,
  }, result);

  const response = await provider.review({
    prompt,
    relativeFilePath: context.relativeFilePath,
    framework: context.framework,
  });

  return {
    status: response.status,
    reason: response.message,
    provider: response.provider,
    model: response.model,
    content: response.content,
    additionalFindings: response.additionalFindings,
  };
}

// ─── Report builder ───────────────────────────────────────────────────────────

export function buildAiReviewReport(
  context: ReviewContext,
  result: ReviewResult,
  aiLayer: AiLayerResult | null = null
): string[] {
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
  ];

  // Review mode — reflects the active layer combination
  if (!context.aiEnabled) {
    lines.push(
      'Review mode:',
      '- AI provider: not connected yet',
      '- Engine: deterministic static review',
    );
  } else if (aiLayer?.status === 'completed') {
    lines.push(
      'Review mode:',
      `- AI provider: ${aiLayer.provider ?? 'unknown'}`,
      '- Engine: deterministic static review + AI-assisted layer',
    );
  } else if (aiLayer?.status === 'error') {
    lines.push(
      'Review mode:',
      `- AI provider: ${aiLayer.provider ?? 'unknown'} (error)`,
      '- Engine: deterministic static review',
      '- AI-assisted layer: requested but failed',
    );
  } else {
    lines.push(
      'Review mode:',
      '- AI provider: disabled or not configured',
      '- Engine: deterministic static review',
      '- AI-assisted layer: requested',
    );
  }

  lines.push(
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
  );

  if (findings.length === 0) {
    lines.push('', 'No significant issues found. Test appears healthy.');
  } else {
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
  }

  // AI-assisted review section (only when --ai was requested)
  if (aiLayer !== null) {
    if (aiLayer.status === 'completed') {
      lines.push(
        '',
        'AI-assisted review:',
        '- Status: completed',
        `- Provider: ${aiLayer.provider ?? 'unknown'}`,
        `- Model: ${aiLayer.model ?? 'unknown'}`,
      );
      if (aiLayer.content) {
        lines.push('', aiLayer.content);
      }
    } else if (aiLayer.status === 'error') {
      lines.push(
        '',
        'AI-assisted review:',
        '- Status: error',
        `- Reason: ${aiLayer.reason}`,
        '- Deterministic review completed successfully.',
      );
    } else {
      const statusDisplay = aiLayer.status === 'not-implemented' ? 'not implemented' : aiLayer.status;
      lines.push(
        '',
        'AI-assisted review:',
        `- Status: ${statusDisplay}`,
        `- Reason: ${aiLayer.reason}`,
        '- Deterministic review completed successfully.',
      );
    }
  }

  return lines;
}
