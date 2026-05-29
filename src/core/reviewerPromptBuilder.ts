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
    'Based only on the context provided above, structure your response exactly as follows:',
    '',
    '### Confirmed improvements',
    'For each deterministic finding where you can add useful, evidence-based context:',
    '1. <Finding title>',
    '   - Why: <evidence-based reason drawn from the provided context>',
    '   - Recommendation: <specific, actionable step>',
    '',
    '### Needs confirmation',
    'Only include this section if there are genuine risks you cannot confirm from the provided context.',
    'Do not include it if there are no uncertain risks.',
    '1. <Possible risk — clearly labeled as unconfirmed>',
    '   - Why to check: <what to look for>',
    '   - How to verify: <specific verification step>',
    '',
    'Rules for your response:',
    '- Only reference what is explicitly present in the provided context.',
    '- Do not invent findings, selectors, helpers, or file names not mentioned above.',
    '- Do not use speculative language ("likely", "probably", "may contain").',
    '- Do not repeat findings already stated by the deterministic reviewer.',
    '- Never suggest modifying, creating, or deleting files automatically.',
    '- Keep the response concise.',
  );

  return sections.join('\n');
}
