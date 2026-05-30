import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import { collectSpecFiles } from '../core/testGeneration';
import { classifyTestScript } from '../core/executionConfig';

/**
 * Use-case orchestration for the `inspect` command.
 *
 * core/ holds the reusable detection helpers (collectSpecFiles,
 * classifyTestScript). This agent loads the project profile and assembles the
 * suite-inspection overview (spec files grouped by folder, support folders,
 * execution modes from package scripts). cli/ only parses the path, calls this
 * agent, and prints the report.
 */

export type SuiteInspectorOptions = {
  targetRepo: string;
};

export type SuiteInspectorResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  profile: ProjectScanResult | null;
  targetRepo: string;
};

const INSPECT_SUPPORT_FOLDER_NAMES = new Set([
  'fixtures', 'helpers', 'setup', 'utils', 'data', 'mocks',
]);

function detectSupportFoldersInDir(testsDirAbs: string, testsDir: string): string[] {
  const found: string[] = [];

  const walk = (absDir: string, relDir: string, depth: number): void => {
    if (depth > 3 || !fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relPath = `${relDir}/${entry.name}`;
      const absPath = path.join(absDir, entry.name);
      if (INSPECT_SUPPORT_FOLDER_NAMES.has(entry.name.toLowerCase())) {
        found.push(relPath);
      } else {
        walk(absPath, relPath, depth + 1);
      }
    }
  };

  walk(testsDirAbs, testsDir, 0);
  return found;
}

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

export function runSuiteInspector(options: SuiteInspectorOptions): SuiteInspectorResult {
  const { targetRepo } = options;
  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    return {
      ok: false,
      exitCode: 1,
      errors: ['Missing project profile. Run analyze --save first.'],
      profile: null,
      targetRepo,
    };
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);

  return { ok: true, exitCode: 0, errors: [], profile, targetRepo };
}

/**
 * Formats the structured inspection result into stdout report lines.
 * Returns an empty array when there is no profile (the CLI handles errors and
 * the exit code separately).
 */
export function buildSuiteInspectorReport(result: SuiteInspectorResult): string[] {
  const profile = result.profile;
  if (!profile) return [];

  const targetPath = result.targetRepo;
  const frameworks = (profile.detectedFrameworks ?? []).join(', ') || '(none detected)';
  const pkgManager = profile.packageManager ?? '(unknown)';
  const testCmd = profile.testCommand ?? '(none)';
  const testsDir = profile.structure?.testsDir ?? '';
  const specCount = profile.structure?.specFilesCount ?? 0;
  const usesPom = profile.structure?.usesPom ?? false;

  const lines: string[] = [
    'QA Agents - Suite Inspector',
    '',
    'Target repo:',
    targetPath,
    '',
    'Project profile:',
    `- Framework: ${frameworks}`,
    `- Package manager: ${pkgManager}`,
    `- Test command: ${testCmd}`,
    `- Tests directory: ${testsDir || '(none detected)'}`,
    `- Spec files (from profile): ${specCount}`,
    `- Uses POM/components: ${usesPom}`,
  ];

  // Collect spec files and group by immediate parent folder
  const testsDirAbs = testsDir ? path.join(targetPath, testsDir) : '';
  const specFiles = testsDirAbs ? collectSpecFiles(testsDirAbs, Number.MAX_SAFE_INTEGER) : [];

  const grouped = new Map<string, string[]>();
  for (const filePath of specFiles) {
    const relPath = path.relative(targetPath, filePath).replace(/\\/g, '/');
    const folder = path.dirname(relPath).replace(/\\/g, '/');
    const group = grouped.get(folder) ?? [];
    group.push(path.basename(filePath));
    grouped.set(folder, group);
  }

  lines.push('', `Test suite found: ${specFiles.length} spec file${specFiles.length !== 1 ? 's' : ''}`);
  for (const [folder, files] of grouped) {
    lines.push('', `  ${folder} (${files.length} spec file${files.length !== 1 ? 's' : ''})`);
    for (const file of files) {
      lines.push(`    - ${file}`);
    }
  }

  // Support folders
  const supportFolders = testsDirAbs ? detectSupportFoldersInDir(testsDirAbs, testsDir) : [];
  lines.push('');
  if (supportFolders.length > 0) {
    lines.push('Support folders:');
    for (const f of supportFolders) {
      lines.push(`  - ${f}`);
    }
  } else {
    lines.push('Support folders: (none detected)');
  }

  // Classify package scripts into execution modes
  const scripts = profile.packageScripts ?? {};
  const MODE_ORDER = ['local', 'headed', 'ui', 'cloud', 'debug', 'report'];
  const modes = new Map<string, string[]>();

  for (const [name, value] of Object.entries(scripts)) {
    const mode = classifyTestScript(value);
    if (!mode) continue;
    const list = modes.get(mode) ?? [];
    list.push(`${pkgManager} run ${name}`);
    modes.set(mode, list);
  }

  lines.push('');
  if (modes.size > 0) {
    lines.push('Execution modes detected:');
    for (const mode of MODE_ORDER) {
      for (const cmd of modes.get(mode) ?? []) {
        lines.push(`- ${mode}: ${cmd}`);
      }
    }
  } else {
    lines.push('Execution modes detected: (none)');
  }

  lines.push(
    '',
    'Recommended next commands:',
    '- Run full suite:',
    `  npm run dev -- run ${targetPath} --suite`,
    '',
    '- Review suite quality:',
    `  npm run dev -- review ${targetPath} --suite`,
  );

  return lines;
}
