import fs from 'fs';
import path from 'path';
import { normalizeId, parseSpec } from '../core/specNormalizer';
import { buildSpecMarkdown } from '../core/specTemplate';
import { writeSpecFile } from '../core/specFileWriter';

/**
 * Use-case orchestration for the `normalize-spec` command.
 *
 * Converts a local input file (.md/.txt) into a standardized internal spec at
 * <target-repo>/.qa-agents/specs/TC-<id>.md. Local, deterministic, read-only on
 * the input: no AI, no network, no external connectors. Refuses to overwrite an
 * existing normalized spec.
 */

export type SpecNormalizerOptions = {
  targetRepo: string;
  inputFile?: string;
  id?: string;
};

export type SpecNormalizerResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  outputPath?: string;
  normalizedId?: string;
  title?: string;
  created?: boolean;
  targetRepo?: string;
};

const SUPPORTED_EXTENSIONS = ['.md', '.txt'];

function fail(errors: string[]): SpecNormalizerResult {
  return { ok: false, exitCode: 1, errors };
}

// Resolves the input file path, trying it as given (or relative to cwd) and
// then relative to the target repo. Returns null when it cannot be found.
function resolveInputPath(inputFile: string, targetRepo: string): string | null {
  const candidates = path.isAbsolute(inputFile)
    ? [inputFile]
    : [path.resolve(process.cwd(), inputFile), path.resolve(targetRepo, inputFile)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function runSpecNormalizerAgent(options: SpecNormalizerOptions): Promise<SpecNormalizerResult> {
  const { targetRepo, inputFile, id } = options;

  // --- Required args --------------------------------------------------------
  if (!targetRepo) {
    return fail(['Missing target repo. Usage: normalize-spec <target-repo> --input <file> --id <id>']);
  }
  if (!inputFile) {
    return fail(['Missing --input <file>.']);
  }
  if (!id) {
    return fail(['Missing --id <id>.']);
  }

  // --- ID normalization -----------------------------------------------------
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    return fail([`Invalid --id: ${id}. Expected a numeric id like 12345, TC-12345, or tc_12345.`]);
  }

  // --- Target repo ----------------------------------------------------------
  if (!fs.existsSync(targetRepo) || !fs.statSync(targetRepo).isDirectory()) {
    return fail([`Target repo path does not exist: ${targetRepo}`]);
  }

  // --- Input file -----------------------------------------------------------
  const ext = path.extname(inputFile).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return fail([`Unsupported file extension: ${ext || '(none)'}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`]);
  }

  const resolvedInput = resolveInputPath(inputFile, targetRepo);
  if (!resolvedInput) {
    return fail([`Input file not found: ${inputFile}`]);
  }

  let rawInput = fs.readFileSync(resolvedInput, 'utf-8');
  if (rawInput.charCodeAt(0) === 0xfeff) rawInput = rawInput.slice(1); // strip UTF-8 BOM

  // --- Parse + build --------------------------------------------------------
  const parsed = parseSpec(rawInput);
  const markdown = buildSpecMarkdown({
    id: normalizedId,
    title: parsed.title,
    sourceFile: inputFile,
    normalizedAt: new Date().toISOString(),
    summary: parsed.summary,
    steps: parsed.steps,
    expectedResults: parsed.expectedResults,
    rawInput,
  });

  // --- Write (refuse overwrite) ---------------------------------------------
  const write = writeSpecFile(targetRepo, `${normalizedId}.md`, markdown);
  if (write.alreadyExists) {
    return fail([`Normalized spec already exists. Refusing to overwrite:\n${write.outputPath}`]);
  }

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    outputPath: write.outputPath,
    normalizedId,
    title: parsed.title,
    created: true,
    targetRepo,
  };
}

export function buildSpecNormalizerReport(result: SpecNormalizerResult): string[] {
  if (!result.ok || !result.outputPath) return [];

  const relativeSpecPath = `.qa-agents/specs/${result.normalizedId}.md`;
  return [
    'QA Agents - Spec Normalizer',
    '',
    'Normalized spec created:',
    result.outputPath,
    '',
    'ID:',
    result.normalizedId ?? '',
    '',
    'Title:',
    result.title ?? '',
    '',
    'Next step:',
    `npm run dev -- generate ${result.targetRepo ?? ''} --spec ${relativeSpecPath} --dry-run`,
  ];
}
