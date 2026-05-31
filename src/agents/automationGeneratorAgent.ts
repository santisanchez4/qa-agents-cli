import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import {
  buildAutomationPlan,
  buildTestCode,
  buildDeterministicTestDraft,
} from '../core/testGeneration';
import { detectRelatedTests } from '../core/duplicateDetection';
import { normalizeId } from '../core/specNormalizer';
import { readLatestRunResultSafe } from '../core/runResults';
import { saveAiReviewReport } from '../core/reviewReportWriter';
import {
  ReviewContext,
  runAiReview,
  runAiLayer,
  buildAiReviewReport,
} from './automationReviewerAgent';

/**
 * Use-case orchestration for the `generate` command.
 *
 * core/ holds reusable helpers (plan building, code generation, duplicate
 * detection). This agent wires them together for the generate flow and
 * performs the controlled file write. cli/ only parses args, calls this
 * agent, and prints the report.
 */

export type AutomationGeneratorMode = 'plan' | 'dry-run' | 'write';

export type AutomationGeneratorOptions = {
  targetRepo: string;
  specArg?: string;
  /** Test Case id (e.g. 253628 / TC-253628 / tc_253628); resolves to a normalized spec. */
  tcId?: string;
  dryRun: boolean;
  write: boolean;
  force: boolean;
  /** Run the deterministic reviewer on the generated test after generation. */
  review?: boolean;
  /** Only with review: enable the optional AI layer (skipped if no provider). */
  ai?: boolean;
  /** Only with review: persist the review report via the review report writer. */
  saveReview?: boolean;
};

export type AutomationGeneratorWriteSuccess = {
  filePath: string;
  targetRepo: string;
  testCommand: string;
  suggestedFilePath: string;
};

export type AutomationGeneratorResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  mode: AutomationGeneratorMode;
  dryRunWriteConflict: boolean;
  plan: string | null;
  /** Related tests to surface as a dry-run duplicate warning (dry-run mode only). */
  relatedTests: string[];
  draft: string | null;
  forceNotice: boolean;
  writeSuccess: AutomationGeneratorWriteSuccess | null;
  /** Relative spec path resolved from --tc (null when --tc was not used). */
  resolvedTcSpec: string | null;
  /** Review report lines (when --review ran). */
  reviewReport?: string[];
  /** Path of the saved review report (when --review --save-review). */
  reviewSavedPath?: string;
  /** Why review was requested but not run (e.g. non-Playwright generation). */
  reviewSkippedReason?: string;
};

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

function extractFirstHeading(markdown: string): string {
  const match = markdown.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : '(no heading found)';
}

function emptyResult(mode: AutomationGeneratorMode): AutomationGeneratorResult {
  return {
    ok: false,
    exitCode: 1,
    errors: [],
    mode,
    dryRunWriteConflict: false,
    plan: null,
    relatedTests: [],
    draft: null,
    forceNotice: false,
    writeSuccess: null,
    resolvedTcSpec: null,
  };
}

export async function runAutomationGenerator(
  options: AutomationGeneratorOptions
): Promise<AutomationGeneratorResult> {
  const { targetRepo, specArg, tcId, dryRun, write, force } = options;
  const mode: AutomationGeneratorMode = dryRun ? 'dry-run' : write ? 'write' : 'plan';

  const result = emptyResult(mode);

  // Review flag dependencies (AI must never be the default).
  if (options.ai && !options.review) {
    result.errors.push('The --ai flag requires --review.');
    return result;
  }
  if (options.saveReview && !options.review) {
    result.errors.push('The --save-review flag requires --review.');
    return result;
  }

  // Resolve --tc into a normalized spec path (mutually exclusive with --spec).
  // This only reads an already-normalized local spec; it never creates one.
  let effectiveSpecArg = specArg;
  if (tcId !== undefined) {
    if (specArg !== undefined) {
      result.errors.push('Both --spec and --tc were provided. Use only one.');
      return result;
    }
    if (!tcId.trim()) {
      result.errors.push('Missing value for --tc. Provide a Test Case id, e.g. --tc 253628.');
      return result;
    }
    const normalizedId = normalizeId(tcId);
    if (!normalizedId) {
      result.errors.push(`Invalid --tc id: ${tcId}. Expected a numeric id like 253628, TC-253628, or tc_253628.`);
      return result;
    }
    const relativeSpec = `.qa-agents/specs/${normalizedId}.md`;
    const absoluteSpec = path.join(targetRepo, '.qa-agents', 'specs', `${normalizedId}.md`);
    if (!fs.existsSync(absoluteSpec)) {
      const numericId = normalizedId.replace(/^TC-/, '');
      result.errors.push([
        `Normalized spec not found for ${normalizedId}:`,
        absoluteSpec,
        '',
        'Create it first with one of:',
        `  npm run dev -- import-spec ${targetRepo} --provider azure --id ${numericId}`,
        `  npm run dev -- normalize-spec ${targetRepo} --input <file> --id ${numericId}`,
      ].join('\n'));
      return result;
    }
    effectiveSpecArg = relativeSpec;
    result.resolvedTcSpec = relativeSpec;
  }

  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const rulesPath = path.join(targetRepo, '.qa-agents', 'repo-rules.md');
  const specPath = effectiveSpecArg
    ? path.isAbsolute(effectiveSpecArg) ? effectiveSpecArg : path.join(targetRepo, effectiveSpecArg)
    : undefined;

  const profileRaw = readFileIfExists(profilePath);
  const specRaw = specPath ? readFileIfExists(specPath) : null;
  const rulesRawResolved = readFileIfExists(rulesPath);

  if (!profileRaw) {
    result.errors.push('Missing project profile. Run analyze --save first.');
  }
  if (!rulesRawResolved) {
    result.errors.push('Missing repo rules file.');
  }
  if (!effectiveSpecArg) {
    result.errors.push('Missing --spec or --tc argument.');
  } else if (!specRaw) {
    result.errors.push('Missing spec file.');
  }

  if (result.errors.length > 0) {
    result.exitCode = 1;
    return result;
  }

  result.ok = true;
  result.exitCode = 0;

  const profile: ProjectScanResult = JSON.parse(profileRaw!);
  const specTitle = extractFirstHeading(specRaw!);
  const { plan, suggestedFilePath, targetFolder, e2eBase, testsDir, patterns } =
    buildAutomationPlan(profile, specTitle, specPath!, targetRepo);

  result.plan = plan;
  result.dryRunWriteConflict = dryRun && write;

  const relatedTests = (dryRun || write)
    ? detectRelatedTests(targetRepo, suggestedFilePath, targetFolder, e2eBase, testsDir, specTitle, specRaw!)
    : [];

  const isPlaywright = (profile.detectedFrameworks ?? []).includes('Playwright');

  if (dryRun) {
    result.relatedTests = relatedTests;

    const draft = buildDeterministicTestDraft(profile, specTitle, suggestedFilePath, patterns);
    if (!draft) {
      result.errors.push('Dry-run requested, but no draft could be generated.');
      return result;
    }
    result.draft = draft;
    // Fall through to the optional review step (in-memory; no file written).
  } else if (write) {
    const frameworks = profile.detectedFrameworks ?? [];
    if (!frameworks.includes('Playwright')) {
      result.errors.push('Write mode currently supports Playwright only.');
      result.exitCode = 1;
      return result;
    }

    const absoluteFilePath = path.resolve(targetRepo, suggestedFilePath);
    const code = buildTestCode(specTitle, suggestedFilePath, patterns);

    // 1. Related-test guard — must run before any filesystem writes (no review).
    if (relatedTests.length > 0 && !force) {
      result.errors.push([
        'Related existing test files found. Refusing to auto-create a possible duplicate.',
        '',
        'Related files:',
        ...relatedTests.map(f => `- ${f}`),
        '',
        'Suggested action:',
        'Review the existing test and decide whether to update it, add a new scenario, or create a separate test intentionally.',
      ].join('\n'));
      result.exitCode = 1;
      return result;
    }

    if (relatedTests.length > 0 && force) {
      result.forceNotice = true;
    }

    // 2. Overwrite guard (no review when the write is refused).
    if (fs.existsSync(absoluteFilePath)) {
      result.errors.push(`Target test file already exists. Refusing to overwrite:\n${absoluteFilePath}`);
      result.exitCode = 1;
      return result;
    }

    // 3. Write
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, code + '\n', 'utf-8');

    result.writeSuccess = {
      filePath: absoluteFilePath,
      targetRepo,
      testCommand: profile.testCommand ?? 'npx playwright test',
      suggestedFilePath,
    };
    // Fall through to the optional review step (reviews the written file).
  }

  // ── Optional review of the generated test (only after successful generation) ──
  if (options.review) {
    if (!isPlaywright) {
      result.reviewSkippedReason = 'Review supports Playwright-generated tests only.';
    } else {
      const fileContent = result.writeSuccess
        ? readFileIfExists(result.writeSuccess.filePath) ?? ''
        : buildTestCode(specTitle, suggestedFilePath, patterns);

      await runGeneratedReview({
        targetRepo,
        profile,
        repoRules: rulesRawResolved,
        relativeFilePath: suggestedFilePath,
        fileContent,
        ai: options.ai === true,
        saveReview: options.saveReview === true,
        result,
      });
    }
  }

  return result;
}

type GeneratedReviewInput = {
  targetRepo: string;
  profile: ProjectScanResult;
  repoRules: string | null;
  relativeFilePath: string;
  fileContent: string;
  ai: boolean;
  saveReview: boolean;
  result: AutomationGeneratorResult;
};

// Reviews generated test content in memory using the existing deterministic
// reviewer (and optional AI layer). Reuses the review rules — no duplication.
async function runGeneratedReview(input: GeneratedReviewInput): Promise<void> {
  const { targetRepo, profile, repoRules, relativeFilePath, fileContent, ai, saveReview, result } = input;

  const executionConfig = readFileIfExists(path.join(targetRepo, '.qa-agents', 'execution-config.json'));
  const latestRunRead = readLatestRunResultSafe(targetRepo);
  const latestRun = latestRunRead.ok ? latestRunRead.data! : null;

  const context: ReviewContext = {
    targetRepo,
    relativeFilePath: relativeFilePath.replace(/\\/g, '/'),
    fileContent,
    framework: (profile.detectedFrameworks ?? []).join(', ') || '(none detected)',
    testCommand: profile.testCommand ?? '(none)',
    repoRules,
    executionConfig,
    latestRun,
    aiEnabled: ai,
  };

  const reviewResult = runAiReview(context);
  const aiLayer = await runAiLayer(context, reviewResult);
  result.reviewReport = buildAiReviewReport(context, reviewResult, aiLayer);

  if (saveReview) {
    const saved = saveAiReviewReport(targetRepo, result.reviewReport);
    result.reviewSavedPath = saved.latestPath;
  }
}

/**
 * Formats the structured generator result into stdout report lines.
 * Validation errors and the exit code live on the result and are handled
 * by the CLI separately (stderr + process exit).
 */
export function buildAutomationGeneratorReport(result: AutomationGeneratorResult): string[] {
  if (!result.ok || result.plan === null) return [];

  const lines: string[] = ['', 'QA Agents - Generate Test', ''];

  if (result.resolvedTcSpec) {
    lines.push('Resolved TC spec:', result.resolvedTcSpec, '');
  }

  lines.push(result.plan);

  if (result.dryRunWriteConflict) {
    lines.push('', 'Both --dry-run and --write were provided. Running in dry-run mode only.');
  }

  if (result.mode === 'dry-run') {
    if (result.relatedTests.length > 0) {
      lines.push(
        '',
        'Duplicate risk warning:',
        'Related existing test files found:',
        ...result.relatedTests.map(f => `- ${f}`),
      );
    }
    if (result.draft) {
      lines.push('', result.draft);
    }
  }

  if (result.forceNotice) {
    lines.push('', 'Force enabled. Creating file despite related tests.');
  }

  if (result.writeSuccess) {
    const { filePath, targetRepo, testCommand, suggestedFilePath } = result.writeSuccess;
    lines.push(
      '',
      'Generated test file created:',
      filePath,
      '',
      'Next step:',
      'Run:',
      `  cd ${targetRepo}`,
      `  ${testCommand} -- ${suggestedFilePath}`,
    );
  }

  // Optional review section (only present when --review ran).
  if (result.reviewSkippedReason) {
    lines.push('', 'Generated test review:', '', `Review skipped: ${result.reviewSkippedReason}`);
  } else if (result.reviewReport && result.reviewReport.length > 0) {
    lines.push('', 'Generated test review:', '', ...result.reviewReport);
    if (result.reviewSavedPath) {
      lines.push('', 'Review report saved:', result.reviewSavedPath);
    }
  }

  return lines;
}
