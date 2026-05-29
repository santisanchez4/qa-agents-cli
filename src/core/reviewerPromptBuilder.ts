import { ReviewFinding } from './reviewRules';

// These are structural subsets of ReviewContext and ReviewResult from the agent.
// TypeScript structural typing ensures those types are assignable here without
// creating a core → agents dependency.

type PromptContext = {
  targetRepo: string;
  relativeFilePath: string;
  framework: string;
  testCommand: string;
  repoRules: string | null;
  latestRunStatus: string | null;
  latestRunEnvironment: string | null;
};

type PromptResult = {
  findings: ReviewFinding[];
  riskLevel: string;
};

// Step 32: this prompt will be sent to the configured AI provider.
// The provider receives it via AiReviewRequest.prompt and returns
// AiReviewResponse.additionalFindings to enrich the deterministic output.

export function buildReviewerPrompt(context: PromptContext, result: PromptResult): string {
  const {
    targetRepo,
    relativeFilePath,
    framework,
    testCommand,
    repoRules,
    latestRunStatus,
    latestRunEnvironment,
  } = context;
  const { findings, riskLevel } = result;

  const sections: string[] = [
    'You are a QA automation expert reviewing a test file.',
    'Your role is to enhance the findings produced by a deterministic static reviewer.',
    'You must only provide recommendations. Do not modify any files.',
    'Do not generate code changes. Do not self-heal tests.',
    '',
    '## Target',
    `Repo: ${targetRepo}`,
    `File: ${relativeFilePath}`,
    `Framework: ${framework}`,
    `Test command: ${testCommand}`,
  ];

  if (latestRunEnvironment || latestRunStatus) {
    sections.push('', '## Latest run context');
    if (latestRunEnvironment) sections.push(`Environment: ${latestRunEnvironment}`);
    if (latestRunStatus)      sections.push(`Status: ${latestRunStatus}`);
  }

  if (repoRules) {
    sections.push('', '## Project rules', repoRules.trim());
  }

  sections.push(
    '',
    '## Deterministic review summary',
    `Risk level: ${riskLevel}`,
    `Findings: ${findings.length}`,
  );

  if (findings.length > 0) {
    sections.push('', '## Findings from deterministic reviewer');
    findings.forEach((f, i) => {
      sections.push(
        '',
        `### Finding ${i + 1}: [${f.category}] ${f.title}`,
        `Severity: ${f.severity}`,
        `Evidence: ${f.evidence}`,
        `Why it matters: ${f.whyItMatters}`,
        `Current recommendation: ${f.recommendation}`,
      );
    });
  }

  sections.push(
    '',
    '## Your task',
    'Based on the file content, project rules, run history, and deterministic findings above:',
    '1. Identify any additional risks not already covered by the deterministic findings.',
    '2. Suggest concrete, actionable improvements.',
    '3. Do not repeat findings already identified above.',
    '4. Respond in structured markdown with clear sections.',
    '5. Never suggest modifying, creating, or deleting files automatically.',
  );

  return sections.join('\n');
}
