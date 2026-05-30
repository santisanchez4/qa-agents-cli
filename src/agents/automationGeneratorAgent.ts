import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import {
  buildAutomationPlan,
  buildTestCode,
  buildDeterministicTestDraft,
} from '../core/testGeneration';
import { detectRelatedTests } from '../core/duplicateDetection';

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
  dryRun: boolean;
  write: boolean;
  force: boolean;
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
  };
}

export function runAutomationGenerator(
  options: AutomationGeneratorOptions
): AutomationGeneratorResult {
  const { targetRepo, specArg, dryRun, write, force } = options;
  const mode: AutomationGeneratorMode = dryRun ? 'dry-run' : write ? 'write' : 'plan';

  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const rulesPath = path.join(targetRepo, '.qa-agents', 'repo-rules.md');
  const specPath = specArg
    ? path.isAbsolute(specArg) ? specArg : path.join(targetRepo, specArg)
    : undefined;

  const profileRaw = readFileIfExists(profilePath);
  const specRaw = specPath ? readFileIfExists(specPath) : null;
  const rulesRawResolved = readFileIfExists(rulesPath);

  const result = emptyResult(mode);

  if (!profileRaw) {
    result.errors.push('Missing project profile. Run analyze --save first.');
  }
  if (!rulesRawResolved) {
    result.errors.push('Missing repo rules file.');
  }
  if (!specArg) {
    result.errors.push('Missing --spec argument.');
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

  if (dryRun) {
    result.relatedTests = relatedTests;

    const draft = buildDeterministicTestDraft(profile, specTitle, suggestedFilePath, patterns);
    if (draft) {
      result.draft = draft;
    } else {
      result.errors.push('Dry-run requested, but no draft could be generated.');
    }
    return result;
  }

  if (write) {
    const frameworks = profile.detectedFrameworks ?? [];
    if (!frameworks.includes('Playwright')) {
      result.errors.push('Write mode currently supports Playwright only.');
      result.exitCode = 1;
      return result;
    }

    const absoluteFilePath = path.resolve(targetRepo, suggestedFilePath);
    const code = buildTestCode(specTitle, suggestedFilePath, patterns);

    // 1. Related-test guard — must run before any filesystem writes
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

    // 2. Overwrite guard
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
    return result;
  }

  // Plan-only mode
  return result;
}

/**
 * Formats the structured generator result into stdout report lines.
 * Validation errors and the exit code live on the result and are handled
 * by the CLI separately (stderr + process exit).
 */
export function buildAutomationGeneratorReport(result: AutomationGeneratorResult): string[] {
  if (!result.ok || result.plan === null) return [];

  const lines: string[] = ['', 'QA Agents - Generate Test', '', result.plan];

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

  return lines;
}
