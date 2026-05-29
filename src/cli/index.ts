#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { scanProject, ProjectScanResult } from '../core/projectScanner';
import { printHelp } from './help';
import { parseEnvFile, loadEnvOverlay, isVarSet } from '../core/envLoader';
import { ExecutionTarget, ExecutionEnvironment, ExecutionConfig, classifyTestScript, buildExecutionConfig } from '../core/executionConfig';
import { RunSummary, FailedTest, LatestRunData, RetrySourceRun, RetryMetadata, parsePlaywrightSummary, parseFailedTests, saveLatestRun } from '../core/runResults';
import { FailureClassification, cleanMojibake, classifyFailure } from '../core/failureAnalyzer';
import { buildRunCommand } from '../core/testRunner';

function saveProjectProfile(rootPath: string, analysis: ProjectScanResult): void {
  const qaDir = path.join(rootPath, '.qa-agents');
  if (!fs.existsSync(qaDir)) {
    fs.mkdirSync(qaDir);
  }
  const profilePath = path.join(qaDir, 'project-profile.json');
  fs.writeFileSync(profilePath, JSON.stringify(analysis, null, 2), 'utf-8');
  console.log(`\nProject profile saved at:\n${profilePath}`);
}

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}


function extractFirstHeading(markdown: string): string {
  const match = markdown.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : '(no heading found)';
}

function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getImmediateSubdirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

const SUPPORT_FOLDERS = new Set(['fixtures', 'helpers', 'setup', 'support', 'utils', 'data', 'types', 'mocks']);

const FOLDER_KEYWORDS: Array<{ keywords: string[]; candidates: string[] }> = [
  { keywords: ['login', 'sign-in', 'signin'], candidates: ['login', 'auth', 'authentication'] },
  { keywords: ['register', 'signup', 'sign-up'], candidates: ['register', 'registration', 'auth', 'authentication'] },
  { keywords: ['tournament'], candidates: ['tournament', 'tournaments'] },
  { keywords: ['team'], candidates: ['team', 'teams'] },
  { keywords: ['wallet'], candidates: ['wallet', 'wallets'] },
  { keywords: ['admin'], candidates: ['admin', 'administration'] },
  { keywords: ['support'], candidates: ['support'] },
];

function findMatchingFolder(
  needle: string,
  existingFolders: string[]
): { folder: string; reason: string } | null {
  const lowerNeedle = needle.toLowerCase();
  for (const rule of FOLDER_KEYWORDS) {
    const matchedKeyword = rule.keywords.find((kw) => lowerNeedle.includes(kw));
    if (!matchedKeyword) continue;
    const matched = existingFolders.find((f) =>
      rule.candidates.some((c) => f.toLowerCase().includes(c))
    );
    if (matched) {
      return {
        folder: matched,
        reason: `spec contains "${matchedKeyword}", and ${matched} is the closest existing area.`,
      };
    }
  }
  return null;
}

type ExistingPatterns = {
  searchPath: string;
  filesInspected: number;
  fallbackUsed: string | null;
  importsPlaywrightTest: boolean;
  usesTestDescribe: boolean;
  usesBeforeEach: boolean;
  usesFixtures: boolean;
  usesHelpers: boolean;
  usesPageObjects: boolean;
  hasTaggedTests: boolean;
  supportFoldersFound: string[];
};

const SUPPORT_FOLDER_CANDIDATES = [
  'tests/fixtures',
  'tests/helpers',
  'tests/setup',
  'src/fixtures',
  'src/helpers',
  'src/utils',
];

function collectSpecFiles(dirPath: string, max: number): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  function walk(dir: string): void {
    if (results.length >= max) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= max) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results;
}

const KEYWORD_STOP_WORDS = new Set(['spec', 'test', 'ts', 'e2e']);

function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().split(/[-_\s./]+/).filter(k => k.length >= 3 && !KEYWORD_STOP_WORDS.has(k))
  )];
}

function extractTcIds(text: string): string[] {
  const ids: string[] = [];
  const tcPattern = /(?:@)?TC[-_](\d+)/gi;
  const testCasePattern = /test\s+case\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tcPattern.exec(text)) !== null) ids.push(`TC-${m[1]}`);
  while ((m = testCasePattern.exec(text)) !== null) ids.push(`TC-${m[1]}`);
  return [...new Set(ids)];
}

function detectRelatedTests(
  rootPath: string,
  suggestedFilePath: string,
  targetFolder: string,
  e2eBase: string | null,
  testsDir: string,
  specTitle: string,
  specRaw: string
): string[] {
  let searchDir = path.join(rootPath, targetFolder);
  if (!fs.existsSync(searchDir)) {
    searchDir = e2eBase !== null ? path.join(rootPath, e2eBase) : '';
  }
  if (!searchDir || !fs.existsSync(searchDir)) {
    searchDir = testsDir ? path.join(rootPath, testsDir) : '';
  }
  if (!searchDir || !fs.existsSync(searchDir)) return [];

  const specFiles = collectSpecFiles(searchDir, 200);
  const suggestedAbsolute = path.resolve(rootPath, suggestedFilePath);

  const suggestedBasename = path.basename(suggestedFilePath, '.spec.ts');
  const rawTitle = specTitle !== '(no heading found)' ? specTitle : suggestedBasename;
  const keywords = [...new Set([
    ...extractKeywords(suggestedBasename),
    ...extractKeywords(normalizeSpecTitle(rawTitle)),
  ])];
  const tcIds = extractTcIds([specTitle, specRaw, suggestedBasename].join('\n'));

  const related: string[] = [];
  for (const filePath of specFiles) {
    if (path.resolve(filePath) === suggestedAbsolute) continue;

    const basename = path.basename(filePath, '.spec.ts');
    const basenameKeywords = extractKeywords(basename);
    const keywordMatch = keywords.some(k => basenameKeywords.includes(k));
    if (keywordMatch) {
      related.push(path.relative(rootPath, filePath).replace(/\\/g, '/'));
      continue;
    }
    if (tcIds.length > 0) {
      const fileText = basename + '\n' + fs.readFileSync(filePath, 'utf-8');
      const existingTcIds = extractTcIds(fileText);
      if (tcIds.some(id => existingTcIds.includes(id))) {
        related.push(path.relative(rootPath, filePath).replace(/\\/g, '/'));
      }
    }
  }
  return related;
}

function detectExistingPatterns(
  rootPath: string,
  targetFolder: string,
  e2eBase: string | null,
  testsDir: string
): ExistingPatterns {
  const supportFoldersFound = SUPPORT_FOLDER_CANDIDATES.filter((f) => {
    const fullPath = path.join(rootPath, f);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  });

  let lastTriedPath = targetFolder;
  let fallbackUsed: string | null = null;
  let specFiles = collectSpecFiles(path.join(rootPath, targetFolder), 5);

  if (specFiles.length === 0 && e2eBase !== null && e2eBase !== lastTriedPath) {
    lastTriedPath = e2eBase;
    specFiles = collectSpecFiles(path.join(rootPath, e2eBase), 5);
    if (specFiles.length > 0) fallbackUsed = e2eBase;
  }

  if (specFiles.length === 0 && testsDir && testsDir !== lastTriedPath) {
    specFiles = collectSpecFiles(path.join(rootPath, testsDir), 5);
    if (specFiles.length > 0) fallbackUsed = testsDir;
  }

  let importsPlaywrightTest = false;
  let usesTestDescribe = false;
  let usesBeforeEach = false;
  let usesFixtures = false;
  let usesHelpers = false;
  let usesPageObjects = false;
  let hasTaggedTests = false;

  for (const filePath of specFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');

    if (!importsPlaywrightTest && /@playwright\/test/.test(content)) importsPlaywrightTest = true;
    if (!usesTestDescribe && /test\.describe/.test(content)) usesTestDescribe = true;
    if (!usesBeforeEach && /test\.beforeEach/.test(content)) usesBeforeEach = true;
    if (!usesFixtures && /from\s+['"][^'"]*\/fixtures['"/]/.test(content)) usesFixtures = true;
    if (!usesHelpers && /from\s+['"][^'"]*\/helpers['"/]/.test(content)) usesHelpers = true;
    if (!usesPageObjects && /from\s+['"][^'"]*(pages|pageObjects|apps|components|views|locators)['"/]/i.test(content)) usesPageObjects = true;
    if (!hasTaggedTests && /@(?:smoke|regression|critical|TC-)/.test(content)) hasTaggedTests = true;
  }

  return {
    searchPath: targetFolder,
    filesInspected: specFiles.length,
    fallbackUsed,
    importsPlaywrightTest,
    usesTestDescribe,
    usesBeforeEach,
    usesFixtures,
    usesHelpers,
    usesPageObjects,
    hasTaggedTests,
    supportFoldersFound,
  };
}

type AutomationPlanResult = {
  plan: string;
  suggestedFilePath: string;
  targetFolder: string;
  e2eBase: string | null;
  testsDir: string;
  patterns: ExistingPatterns;
};

function buildAutomationPlan(
  profile: ProjectScanResult,
  specTitle: string,
  specPath: string,
  targetPath: string
): AutomationPlanResult {
  const framework = (profile.detectedFrameworks ?? []).join(', ') || '(none detected)';
  const testCmd = profile.testCommand ?? '(none)';
  const testsDir = profile.structure?.testsDir ?? '';
  const testsDirAbs = testsDir ? path.join(targetPath, testsDir) : '';

  const specFileName = path.basename(specPath, path.extname(specPath));
  const needle = `${specTitle} ${specFileName}`;
  const kebab = toKebabCase(specTitle !== '(no heading found)' ? specTitle : specFileName)
    .replace(/^(test-spec-|test-)/i, '');
  const suggestedFileName = `${kebab}.spec.ts`;

  let e2eBase: string | null = null;
  let targetFolder: string;
  let structureAnalysis: string;
  let e2eBaseLine = '';

  if (!testsDir) {
    targetFolder = 'tests';
    structureAnalysis =
      '- No tests directory detected in project profile.\n' +
      '- Defaulting to tests/ as suggested root.';
  } else {
    const topFolders = getImmediateSubdirs(testsDirAbs);
    const supportFolders = topFolders.filter((f) => SUPPORT_FOLDERS.has(f.toLowerCase()));
    const hasE2eFolder = topFolders.includes('e2e');

    if (hasE2eFolder) {
      e2eBase = `${testsDir}/e2e`;
      e2eBaseLine = e2eBase;
      const e2eFolders = getImmediateSubdirs(path.join(testsDirAbs, 'e2e'))
        .filter((f) => !SUPPORT_FOLDERS.has(f.toLowerCase()));

      const match = findMatchingFolder(needle, e2eFolders);

      const analysisParts: string[] = [];
      if (supportFolders.length > 0) {
        analysisParts.push(`- Found support folders under ${testsDir}: ${supportFolders.join(', ')}`);
      }
      analysisParts.push(`- Found E2E folder: e2e`);
      analysisParts.push(`- Inspecting feature folders under ${e2eBase}`);

      if (match) {
        analysisParts.push(`- Matching area: ${match.folder}`);
        analysisParts.push(`- Reason: ${match.reason}`);
        targetFolder = `${e2eBase}/${match.folder}`;
      } else {
        const featureFolder = toKebabCase(specFileName.replace(/\.spec$/, '').replace(/\.md$/, ''));
        analysisParts.push(`- No matching feature folder found under ${e2eBase}.`);
        analysisParts.push(`- Suggesting new folder: ${featureFolder}/`);
        targetFolder = `${e2eBase}/${featureFolder}`;
      }

      structureAnalysis = analysisParts.join('\n');
    } else if (topFolders.length === 0) {
      targetFolder = testsDir;
      structureAnalysis =
        `- No subfolders found under ${testsDir}/.\n` +
        `- Placing file directly under ${testsDir}/ since no better structure exists.`;
    } else {
      const featureFolders = topFolders.filter((f) => !SUPPORT_FOLDERS.has(f.toLowerCase()));
      const match = findMatchingFolder(needle, featureFolders);

      if (match) {
        targetFolder = `${testsDir}/${match.folder}`;
        structureAnalysis =
          `- Found test folders: ${topFolders.join(', ')}\n` +
          `- Matching folder found: ${match.folder}\n` +
          `- Reason: ${match.reason}`;
      } else {
        const featureFolder = toKebabCase(specFileName.replace(/\.spec$/, '').replace(/\.md$/, ''));
        targetFolder = `${testsDir}/${featureFolder}`;
        structureAnalysis =
          `- Found test folders: ${topFolders.join(', ')}\n` +
          `- No matching folder found for this spec.\n` +
          `- Suggesting new feature folder: ${featureFolder}/`;
      }
    }
  }

  const suggestedFilePath = `${targetFolder}/${suggestedFileName}`;
  const patterns = detectExistingPatterns(targetPath, targetFolder, e2eBase, testsDir);

  const lines: string[] = [
    'Automation Plan',
    '',
    `Spec title: ${specTitle}`,
    `Framework: ${framework}`,
    `Test command: ${testCmd}`,
    `Detected tests directory: ${testsDir || '(none detected)'}`,
  ];

  if (e2eBaseLine) {
    lines.push('', 'E2E base folder:', e2eBaseLine);
  }

  lines.push(
    '',
    'Existing test structure analysis:',
    ...structureAnalysis.split('\n'),
    '',
    'Suggested target folder:',
    targetFolder,
    '',
    'Suggested test file:',
    suggestedFilePath,
  );

  lines.push('', 'Existing patterns found:');
  lines.push(`- Pattern search path: ${patterns.searchPath}`);
  if (patterns.fallbackUsed !== null) {
    lines.push('- No spec files found under suggested target folder.');
    lines.push(`- Falling back to: ${patterns.fallbackUsed}`);
  }
  lines.push(
    `- Example test files inspected: ${patterns.filesInspected}`,
    `- imports @playwright/test: ${patterns.importsPlaywrightTest}`,
    `- uses test.describe: ${patterns.usesTestDescribe}`,
    `- uses test.beforeEach: ${patterns.usesBeforeEach}`,
    `- uses fixtures: ${patterns.usesFixtures}`,
    `- uses helpers: ${patterns.usesHelpers}`,
    `- uses page objects/components: ${patterns.usesPageObjects}`,
    `- has tagged tests: ${patterns.hasTaggedTests}`,
    `- Support folders found: ${patterns.supportFoldersFound.length > 0 ? patterns.supportFoldersFound.join(', ') : '(none)'}`,
  );

  lines.push(
    '',
    'Required actions before code generation:',
    '1. Inspect the example spec files listed above before generating code.',
    '2. Reuse the detected patterns above (fixtures, helpers, page objects as found).',
    '3. Inspect existing helper/page patterns.',
    '4. Reuse env variables defined in repo-rules or .env.',
    '5. Prefer user-facing Playwright locators.',
    '6. Add meaningful assertions after each action.',
    `7. Run ${testCmd} after generation.`,
  );

  return { plan: lines.join('\n'), suggestedFilePath, targetFolder, e2eBase, testsDir, patterns };
}

function deriveTagFromTitle(title: string): string | null {
  if (/smoke/i.test(title)) return '@smoke';
  if (/regression/i.test(title)) return '@regression';
  if (/critical/i.test(title)) return '@critical';
  return null;
}

function buildLoginTestBody(): string[] {
  return [
    'const email = process.env.E2E_EMAIL;',
    'const password = process.env.E2E_PASSWORD;',
    '',
    'if (!email || !password) {',
    "  throw new Error('Missing E2E_EMAIL or E2E_PASSWORD environment variables.');",
    '}',
    '',
    "await page.goto('/login');",
    '',
    '// TODO: adjust locators if the login form uses different labels or roles',
    "await page.getByRole('textbox', { name: /email/i }).fill(email);",
    "await page.getByRole('textbox', { name: /password/i }).fill(password);",
    "await page.getByRole('button', { name: /log in|login|sign in/i }).click();",
    '',
    'await expect(page).not.toHaveURL(/\\/login$/);',
  ];
}

function buildGenericTestBody(featureSlug: string): string[] {
  return [
    '// TODO: navigate to the correct starting URL for this feature',
    `await page.goto('/${featureSlug}');`,
    '',
    '// TODO: add test steps for this feature',
    '',
    '// TODO: adjust assertion to match expected post-action state',
    `await expect(page).not.toHaveURL(/\\/login$/);`,
  ];
}

function normalizeSpecTitle(title: string): string {
  return title.replace(/^(?:test\s+spec|spec|test)\s*:\s*/i, '').trim();
}

function buildTestCode(
  specTitle: string,
  suggestedFilePath: string,
  patterns: ExistingPatterns
): string {
  const rawTitle = specTitle !== '(no heading found)' ? specTitle : '';
  const featureName = (rawTitle ? normalizeSpecTitle(rawTitle) : '').toLowerCase()
    || path.basename(suggestedFilePath, '.spec.ts').replace(/-/g, ' ');
  const isLoginSpec = /login|sign[\s-]?in/i.test(featureName);
  const isRegisterSpec = /register|sign[\s-]?up/i.test(featureName);

  let baseTestName: string;
  if (isLoginSpec) {
    baseTestName = 'allows an existing user to log in successfully';
  } else if (isRegisterSpec) {
    baseTestName = 'allows a new user to register successfully';
  } else {
    baseTestName = `completes the ${featureName} flow successfully`;
  }

  const tag = patterns.hasTaggedTests ? deriveTagFromTitle(featureName) : null;
  const testName = tag ? `${tag} ${baseTestName}` : baseTestName;

  const bodyLines = isLoginSpec
    ? buildLoginTestBody()
    : buildGenericTestBody(toKebabCase(featureName));

  const importLine = `import { test, expect } from '@playwright/test';`;
  const ind = '  ';

  let codeLines: string[];
  if (patterns.usesTestDescribe) {
    codeLines = [
      importLine,
      '',
      `test.describe('${featureName}', () => {`,
      `${ind}test('${testName}', async ({ page }) => {`,
      ...bodyLines.map(l => (l === '' ? '' : `${ind}${ind}${l}`)),
      `${ind}});`,
      `});`,
    ];
  } else {
    codeLines = [
      importLine,
      '',
      `test('${testName}', async ({ page }) => {`,
      ...bodyLines.map(l => (l === '' ? '' : `${ind}${l}`)),
      `});`,
    ];
  }

  return codeLines.join('\n');
}

function buildDeterministicTestDraft(
  profile: ProjectScanResult,
  specTitle: string,
  suggestedFilePath: string,
  patterns: ExistingPatterns
): string {
  const frameworks = profile.detectedFrameworks ?? [];

  if (!frameworks.includes('Playwright')) {
    return 'Dry-run generation currently supports Playwright only.';
  }

  const code = buildTestCode(specTitle, suggestedFilePath, patterns);

  return [
    'Generated Test Draft (dry-run only)',
    '',
    'Target file:',
    suggestedFilePath,
    '',
    '```ts',
    code,
    '```',
  ].join('\n');
}

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


function buildInspectReport(profile: ProjectScanResult, targetPath: string): string {
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

  return lines.join('\n');
}


const DISCOVER_ENV_KEYWORDS = [
  'local', 'dev', 'development', 'qa', 'uat', 'staging', 'production', 'prod',
];

// Ordered most-specific first so "production" matches before "prod"
const DISCOVER_URL_PATTERNS: Array<{ pattern: string; env: string }> = [
  { pattern: 'localhost',   env: 'local' },
  { pattern: 'staging',     env: 'staging' },
  { pattern: 'production',  env: 'production' },
  { pattern: 'uat',         env: 'uat' },
  { pattern: 'development', env: 'development' },
  { pattern: 'qa',          env: 'qa' },
  { pattern: 'dev',         env: 'dev' },
  { pattern: 'prod',        env: 'prod' },
];

function categorizeVar(key: string): string | null {
  const k = key.toUpperCase();
  if (/^(LT_USERNAME|LT_ACCESS_KEY|BROWSERSTACK_USERNAME|BROWSERSTACK_ACCESS_KEY)$/.test(k)) return 'Cloud execution';
  if (/^E2E_ADMIN_(EMAIL|PASSWORD)$/.test(k)) return 'Admin credentials';
  if (/^E2E_(EMAIL|PASSWORD)\d*$/.test(k)) return 'User credentials';
  if (/URL|HOST|BASE|ENDPOINT|BACKEND/.test(k)) return 'App/URL';
  if (/API_KEY|TOKEN|SECRET/.test(k)) return 'Secrets/API keys';
  return null;
}

function buildDiscoverReport(targetPath: string, profile: ProjectScanResult | null): string {
  const lines: string[] = ['QA Agents - Environment Discovery', '', 'Target repo:', targetPath];

  // Collect env files from repo root
  let envFiles: string[] = [];
  try {
    envFiles = fs.readdirSync(targetPath)
      .filter(f => /^\.env($|\.)/.test(f))
      .filter(f => fs.statSync(path.join(targetPath, f)).isFile());
    envFiles.sort((a, b) => (a === '.env' ? -1 : b === '.env' ? 1 : a.localeCompare(b)));
  } catch { /* unreadable dir */ }

  lines.push('', 'Env files found:');
  if (envFiles.length > 0) {
    for (const f of envFiles) lines.push(`- ${f}`);
  } else {
    lines.push('(none)');
  }

  // Parse env files — track keys and values (values only used internally)
  const envEvidence = new Map<string, Set<string>>(); // env name -> deduplicated reasons
  const addEvidence = (env: string, reason: string) => {
    if (!envEvidence.has(env)) envEvidence.set(env, new Set());
    envEvidence.get(env)!.add(reason);
  };

  const allVarKeys = new Set<string>();
  const parsedFiles = new Map<string, Record<string, string>>();

  for (const fileName of envFiles) {
    try {
      const parsed = parseEnvFile(path.join(targetPath, fileName));
      parsedFiles.set(fileName, parsed);
      for (const key of Object.keys(parsed)) allVarKeys.add(key);
    } catch { /* skip unreadable */ }

    // Evidence from file name: .env.staging -> "staging"
    const m = fileName.match(/^\.env\.([a-zA-Z][a-zA-Z0-9]*)(?:\.local)?$/);
    if (m) addEvidence(m[1].toLowerCase(), `${fileName} file found`);
  }

  // Evidence from URL-like variable values (never print the value)
  const URL_LIKE_KEY = /URL|HOST|BASE|ENDPOINT|BACKEND/i;
  for (const [, parsed] of parsedFiles) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!URL_LIKE_KEY.test(key)) continue;
      const v = value.toLowerCase();
      for (const { pattern, env } of DISCOVER_URL_PATTERNS) {
        if (v.includes(pattern)) {
          const reason = pattern === 'localhost'
            ? `${key} points to localhost`
            : `${key} value contains "${pattern}"`;
          addEvidence(env, reason);
          break; // first matching pattern wins per variable
        }
      }
    }
  }

  // Evidence from variable name segments (split on _)
  for (const key of allVarKeys) {
    const segments = key.toLowerCase().split('_');
    for (const kw of DISCOVER_ENV_KEYWORDS) {
      if (segments.includes(kw)) {
        addEvidence(kw, `Variable ${key} suggests ${kw}`);
        break;
      }
    }
  }

  // Evidence from package script names (split on : - _)
  const packageScripts = profile?.packageScripts ?? {};
  for (const name of Object.keys(packageScripts)) {
    const segments = name.toLowerCase().split(/[:_-]/);
    for (const kw of DISCOVER_ENV_KEYWORDS) {
      if (segments.includes(kw)) {
        addEvidence(kw, `Script '${name}' detected`);
        break;
      }
    }
  }

  // Print possible environments
  lines.push('', 'Possible environments:');
  if (envEvidence.size > 0) {
    for (const [env, reasons] of envEvidence) {
      lines.push(`- ${env}`, '  Evidence:');
      for (const reason of reasons) lines.push(`  - ${reason}`);
    }
  } else {
    lines.push('(none detected)');
  }

  // Variable groups
  const varGroups: Record<string, string[]> = {};
  for (const key of allVarKeys) {
    const cat = categorizeVar(key);
    if (cat) (varGroups[cat] ??= []).push(key);
  }

  const GROUP_ORDER = ['App/URL', 'User credentials', 'Admin credentials', 'Cloud execution', 'Secrets/API keys'];
  lines.push('', 'Variable groups:');
  let firstGroup = true;
  for (const group of GROUP_ORDER) {
    const vars = varGroups[group];
    if (!vars?.length) continue;
    if (!firstGroup) lines.push('');
    firstGroup = false;
    lines.push(`${group}:`);
    for (const v of vars) lines.push(`- ${v}`);
  }
  if (firstGroup) lines.push('(no recognizable variable patterns found)');

  // Execution targets from package scripts
  const EXEC_MODE_ORDER = ['local', 'headed', 'ui', 'cloud', 'debug', 'report'];
  const execModes = new Map<string, string>(); // mode -> first script name found
  for (const [name, value] of Object.entries(packageScripts)) {
    const mode = classifyTestScript(value);
    if (mode && !execModes.has(mode)) execModes.set(mode, name);
  }

  lines.push('', 'Execution targets:');
  if (execModes.size > 0) {
    for (const mode of EXEC_MODE_ORDER) {
      const scriptName = execModes.get(mode);
      if (scriptName) lines.push(`- ${mode}: ${scriptName}`);
    }
  } else {
    lines.push('(none detected)');
  }

  lines.push(
    '',
    'Recommended next step:',
    'Review .qa-agents/execution-config.json and add/update environments based on this discovery.',
  );

  return lines.join('\n');
}



const args = process.argv.slice(2);
const command = args[0];
const targetPath = path.resolve(args[1] || process.cwd());
const shouldSave = args.includes('--save');

if (command === 'analyze') {
  const result = scanProject(targetPath);

  console.log('\nQA Agents - Repo Analysis\n');
  console.log(JSON.stringify(result, null, 2));

  if (shouldSave) {
    saveProjectProfile(targetPath, result);
  }
} else if (command === 'generate') {
  // npm consumes --dry-run as its own flag and exposes it via env instead of argv
  const isDryRun = args.includes('--dry-run') || process.env['npm_config_dry_run'] === 'true';
  const isWrite = args.includes('--write');
  const isForce = args.includes('--force');
  const specFlagIndex = args.indexOf('--spec');
  const specArg = specFlagIndex !== -1 ? args[specFlagIndex + 1] : undefined;

  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const rulesPath = path.join(targetPath, '.qa-agents', 'repo-rules.md');
  const specPath = specArg
    ? path.isAbsolute(specArg) ? specArg : path.join(targetPath, specArg)
    : undefined;

  const profileRaw = readFileIfExists(profilePath);
  const rulesRaw = specPath ? readFileIfExists(rulesPath) : null;
  const specRaw = specPath ? readFileIfExists(specPath) : null;

  let hasError = false;

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    hasError = true;
  }

  const rulesRawResolved = readFileIfExists(rulesPath);
  if (!rulesRawResolved) {
    console.error('Missing repo rules file.');
    hasError = true;
  }

  if (!specArg) {
    console.error('Missing --spec argument.');
    hasError = true;
  } else if (!specRaw) {
    console.error('Missing spec file.');
    hasError = true;
  }

  if (hasError) process.exit(1);

  const profile: ProjectScanResult = JSON.parse(profileRaw!);
  const specTitle = extractFirstHeading(specRaw!);
  const { plan, suggestedFilePath, targetFolder, e2eBase, testsDir, patterns } =
    buildAutomationPlan(profile, specTitle, specPath!, targetPath);

  console.log('\nQA Agents - Generate Test\n');
  console.log(plan);

  if (isDryRun && isWrite) {
    console.log('\nBoth --dry-run and --write were provided. Running in dry-run mode only.');
  }

  const relatedTests = (isDryRun || isWrite)
    ? detectRelatedTests(targetPath, suggestedFilePath, targetFolder, e2eBase, testsDir, specTitle, specRaw!)
    : [];

  if (isDryRun) {
    if (relatedTests.length > 0) {
      console.log([
        '',
        'Duplicate risk warning:',
        'Related existing test files found:',
        ...relatedTests.map(f => `- ${f}`),
      ].join('\n'));
    }

    const draft = buildDeterministicTestDraft(profile, specTitle, suggestedFilePath, patterns);
    if (draft) {
      console.log('\n' + draft);
    } else {
      console.error('Dry-run requested, but no draft could be generated.');
    }
  } else if (isWrite) {
    const frameworks = profile.detectedFrameworks ?? [];
    if (!frameworks.includes('Playwright')) {
      console.error('Write mode currently supports Playwright only.');
      process.exit(1);
    }

    const absoluteFilePath = path.resolve(targetPath, suggestedFilePath);
    const code = buildTestCode(specTitle, suggestedFilePath, patterns);

    // 1. Related-test guard — must run before any filesystem writes
    if (relatedTests.length > 0 && !isForce) {
      console.error([
        'Related existing test files found. Refusing to auto-create a possible duplicate.',
        '',
        'Related files:',
        ...relatedTests.map(f => `- ${f}`),
        '',
        'Suggested action:',
        'Review the existing test and decide whether to update it, add a new scenario, or create a separate test intentionally.',
      ].join('\n'));
      process.exit(1);
    }

    if (relatedTests.length > 0 && isForce) {
      console.log('\nForce enabled. Creating file despite related tests.');
    }

    // 2. Overwrite guard
    if (fs.existsSync(absoluteFilePath)) {
      console.error(`Target test file already exists. Refusing to overwrite:\n${absoluteFilePath}`);
      process.exit(1);
    }

    // 3. Write
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, code + '\n', 'utf-8');

    const testCmd = profile.testCommand ?? 'npx playwright test';
    console.log(`\nGenerated test file created:\n${absoluteFilePath}`);
    console.log(`\nNext step:\nRun:\n  cd ${targetPath}\n  ${testCmd} -- ${suggestedFilePath}`);
  }
} else if (command === 'run') {
  const fileFlagIndex = args.indexOf('--file');
  const relativeTestFile = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : undefined;
  const isSuite = args.includes('--suite');
  const isFailed = args.includes('--failed');
  const envFlagIdx = args.indexOf('--env');
  const selectedEnv = envFlagIdx !== -1 ? args[envFlagIdx + 1] : 'local';
  const targetFlagIdx = args.indexOf('--target');
  const selectedTarget = targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : 'local';
  const varsFlagIdx = args.indexOf('--vars-file');
  const varsFileArg = varsFlagIdx !== -1 ? args[varsFlagIdx + 1] : undefined;

  const modeCount = (args.includes('--file') ? 1 : 0) + (isSuite ? 1 : 0) + (isFailed ? 1 : 0);
  if (modeCount > 1) {
    console.error('Please use only one run mode: --file, --suite, or --failed.');
    process.exit(1);
  }
  if (modeCount === 0) {
    console.error('Please provide one run mode: --file <file>, --suite, or --failed.');
    process.exit(1);
  }

  // --failed: load latest run and extract failed file paths before anything else
  let failedFiles: string[] = [];
  let retrySourceRun: RetrySourceRun | null = null;

  if (isFailed) {
    const runResultPath = path.join(targetPath, '.qa-agents', 'runs', 'latest-run.json');
    const runResultRaw = readFileIfExists(runResultPath);
    if (!runResultRaw) {
      console.error('No latest run result found. Run a suite or file first.');
      process.exit(1);
    }
    let latestRun: LatestRunData;
    try {
      latestRun = JSON.parse(runResultRaw) as LatestRunData;
    } catch {
      console.error('Could not read latest run result.');
      process.exit(1);
    }
    if (!latestRun.failedTests || latestRun.failedTests.length === 0) {
      console.log('No failed tests found in latest run.');
      process.exit(0);
    }
    failedFiles = [...new Set(
      latestRun.failedTests.map(t => t.file).filter((f): f is string => f !== null)
    )];
    if (failedFiles.length === 0) {
      console.log('No failed tests found in latest run.');
      process.exit(0);
    }
    retrySourceRun = {
      status: latestRun.status,
      mode: latestRun.mode,
      environment: latestRun.environment,
      target: latestRun.target,
      command: latestRun.command,
      startedAt: latestRun.startedAt,
      finishedAt: latestRun.finishedAt,
      summary: latestRun.summary,
    };
  }

  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const configPath = path.join(targetPath, '.qa-agents', 'execution-config.json');

  const profileRaw = readFileIfExists(profilePath);
  const configRaw = readFileIfExists(configPath);

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);

  // Validate test file exists on disk (--file mode only)
  if (relativeTestFile !== undefined && !isFailed) {
    const absoluteTestFile = path.join(targetPath, relativeTestFile);
    if (!fs.existsSync(absoluteTestFile)) {
      console.error(`Test file not found:\n${absoluteTestFile}`);
      process.exit(1);
    }
  }

  let finalCmd: string;
  let finalSpawnArgs: string[];
  let displayCmd: string;
  let envOverlay: Record<string, string> = {};
  let loadedFiles: string[] = [];
  const hasConfig = configRaw !== null;

  if (hasConfig) {
    const config: ExecutionConfig = JSON.parse(configRaw!);

    if (!config.environments[selectedEnv]) {
      console.error([
        `Environment not found: ${selectedEnv}`,
        '',
        'Available environments:',
        ...Object.keys(config.environments).map(e => `- ${e}`),
      ].join('\n'));
      process.exit(1);
    }

    if (!config.targets[selectedTarget]) {
      console.error([
        `Target not found: ${selectedTarget}`,
        '',
        'Available targets:',
        ...Object.keys(config.targets).map(t => `- ${t}`),
      ].join('\n'));
      process.exit(1);
    }

    const envLoadResult = loadEnvOverlay(targetPath, selectedEnv, varsFileArg);
    if (envLoadResult.error) {
      console.error(envLoadResult.error);
      process.exit(1);
    }
    envOverlay = envLoadResult.overlay;
    loadedFiles = envLoadResult.loadedFiles;

    const envConfig = config.environments[selectedEnv];
    const targetConfig = config.targets[selectedTarget];
    const requiredVars = [...new Set([
      ...(envConfig.requiredEnv ?? []),
      ...(targetConfig.requiredEnv ?? []),
    ])];

    const missingVars = requiredVars.filter(v => !isVarSet(v, envOverlay));
    if (missingVars.length > 0) {
      console.error([
        'NOT READY — missing required variables:',
        ...missingVars.map(v => `- ${v}`),
      ].join('\n'));
      process.exit(1);
    }

    const scriptName = targetConfig.script;
    const pkgManager = profile.packageManager ?? 'npm';
    const packageScripts = profile.packageScripts ?? {};

    if (!scriptName || !(scriptName in packageScripts)) {
      console.error(`Configured script not found in package.json: ${scriptName || '(empty)'}`);
      process.exit(1);
    }

    finalCmd = pkgManager;
    if (isSuite) {
      finalSpawnArgs = ['run', scriptName];
      displayCmd = `${pkgManager} run ${scriptName}`;
    } else if (isFailed) {
      finalSpawnArgs = ['run', scriptName, '--', ...failedFiles];
      displayCmd = `${pkgManager} run ${scriptName} -- ${failedFiles.join(' ')}`;
    } else {
      finalSpawnArgs = ['run', scriptName, '--', relativeTestFile!];
      displayCmd = `${pkgManager} run ${scriptName} -- ${relativeTestFile}`;
    }
  } else {
    // Legacy: no execution-config.json
    console.log('Execution config not found. Running with project profile testCommand.');
    const testCmd = profile.testCommand ?? 'npx playwright test';
    const parts = testCmd.trim().split(/\s+/);
    const isNpmRun = parts.length >= 2 && parts[0] === 'npm' && parts[1] === 'run';

    if (isSuite) {
      finalCmd = parts[0];
      finalSpawnArgs = parts.slice(1);
      displayCmd = testCmd;
    } else if (isFailed) {
      finalCmd = parts[0];
      finalSpawnArgs = isNpmRun
        ? [...parts.slice(1), '--', ...failedFiles]
        : [...parts.slice(1), ...failedFiles];
      displayCmd = isNpmRun
        ? `${testCmd} -- ${failedFiles.join(' ')}`
        : `${testCmd} ${failedFiles.join(' ')}`;
    } else {
      const r = buildRunCommand(testCmd, relativeTestFile!);
      finalCmd = r.cmd;
      finalSpawnArgs = r.spawnArgs;
      displayCmd = r.display;
    }
  }

  // Print header
  const header = isFailed
    ? 'QA Agents - Failed Tests Runner'
    : isSuite
    ? 'QA Agents - Suite Runner'
    : 'QA Agents - Test Runner';
  console.log(`\n${header}\n`);
  console.log(`Target repo:\n${targetPath}\n`);

  if (hasConfig) {
    console.log(`Environment:\n${selectedEnv}\n`);
    console.log(`Execution target:\n${selectedTarget}\n`);
    if (loadedFiles.length > 0) {
      console.log(`Loaded env files:\n${loadedFiles.map(f => `- ${f}`).join('\n')}\n`);
    } else {
      console.log('Loaded env files: (none)\n');
    }
  }

  if (isFailed) {
    console.log(`Failed test files:\n${failedFiles.map(f => `- ${f}`).join('\n')}\n`);
  } else if (relativeTestFile !== undefined) {
    console.log(`Test file:\n${relativeTestFile}\n`);
  }

  console.log(`Command:\n${displayCmd}\n`);

  const mergedEnv = { ...process.env, ...envOverlay } as NodeJS.ProcessEnv;
  const startedAt = new Date();

  const result = spawnSync(finalCmd, finalSpawnArgs, {
    cwd: targetPath,
    encoding: 'utf-8',
    shell: true,
    env: mergedEnv,
  });

  const finishedAt = new Date();

  // Print captured output (preserves ANSI codes, streams to the right handles)
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const output = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
  const exitCode = result.status ?? 1;

  const runMode: 'file' | 'suite' | 'failed' = isFailed ? 'failed' : isSuite ? 'suite' : 'file';

  const retry: RetryMetadata = {
    isRetry: isFailed,
    sourceRun: retrySourceRun,
    rerunFiles: isFailed ? failedFiles : [],
  };

  const runData: LatestRunData = {
    targetRepo: targetPath,
    mode: runMode,
    testFile: relativeTestFile ?? null,
    environment: hasConfig ? selectedEnv : null,
    target: hasConfig ? selectedTarget : null,
    varsFile: varsFileArg ?? null,
    loadedEnvFiles: loadedFiles,
    command: displayCmd,
    exitCode,
    status: exitCode === 0 ? 'passed' : 'failed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    summary: parsePlaywrightSummary(output),
    failedTests: parseFailedTests(output),
    retry,
  };

  saveLatestRun(targetPath, runData);
  if (isFailed) {
    console.log('Retry metadata saved in latest-run.json.');
  }
  process.exit(exitCode);
} else if (command === 'init-config') {
  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  const configPath = path.join(targetPath, '.qa-agents', 'execution-config.json');

  if (fs.existsSync(configPath)) {
    console.error(`execution-config.json already exists. Refusing to overwrite:\n${configPath}`);
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const config = buildExecutionConfig(profile);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Execution config created:\n${configPath}`);
} else if (command === 'env-check') {
  const envFlagIndex = args.indexOf('--env');
  const selectedEnv = envFlagIndex !== -1 ? args[envFlagIndex + 1] : 'local';

  const targetFlagIndex = args.indexOf('--target');
  const selectedTarget = targetFlagIndex !== -1 ? args[targetFlagIndex + 1] : 'local';

  const envFileFlagIndex = args.indexOf('--vars-file');
  const envFileArg = envFileFlagIndex !== -1 ? args[envFileFlagIndex + 1] : undefined;

  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const configPath = path.join(targetPath, '.qa-agents', 'execution-config.json');

  const profileRaw = readFileIfExists(profilePath);
  const configRaw = readFileIfExists(configPath);

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  if (!configRaw) {
    console.error('Missing execution config. Run init-config first.');
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const config: ExecutionConfig = JSON.parse(configRaw);

  if (!config.environments[selectedEnv]) {
    console.error([
      `Environment not found: ${selectedEnv}`,
      '',
      'Available environments:',
      ...Object.keys(config.environments).map(e => `- ${e}`),
    ].join('\n'));
    process.exit(1);
  }

  if (!config.targets[selectedTarget]) {
    console.error([
      `Target not found: ${selectedTarget}`,
      '',
      'Available targets:',
      ...Object.keys(config.targets).map(t => `- ${t}`),
    ].join('\n'));
    process.exit(1);
  }

  // Load env overlay (process.env wins; first file value wins)
  const envLoadResult = loadEnvOverlay(targetPath, selectedEnv, envFileArg);
  if (envLoadResult.error) {
    console.error(envLoadResult.error);
    process.exit(1);
  }
  const envOverlay = envLoadResult.overlay;
  const loadedFiles = envLoadResult.loadedFiles;

  const envConfig = config.environments[selectedEnv];
  const targetConfig = config.targets[selectedTarget];
  const scriptName = targetConfig.script;
  const pkgManager = profile.packageManager ?? 'npm';
  const packageScripts = profile.packageScripts ?? {};

  const scriptExists = Boolean(scriptName) && scriptName in packageScripts;

  const requiredVars = [...new Set([
    ...(envConfig.requiredEnv ?? []),
    ...(targetConfig.requiredEnv ?? []),
  ])];

  const varStatuses = requiredVars.map(v => ({ name: v, set: isVarSet(v, envOverlay) }));
  const isReady = varStatuses.every(s => s.set) && scriptExists;

  const lines: string[] = [
    'QA Agents - Environment Check',
    '',
    'Target repo:',
    targetPath,
    '',
    'Environment:',
    selectedEnv,
    '',
    'Execution target:',
    selectedTarget,
    '',
    'Target script:',
    scriptName ? `${pkgManager} run ${scriptName}` : '(none configured)',
  ];

  if (!scriptExists) {
    lines.push('', `Configured script not found in package.json: ${scriptName || '(empty)'}`);
  }

  if (loadedFiles.length > 0) {
    lines.push('', 'Loaded env files:');
    for (const f of loadedFiles) lines.push(`- ${f}`);
  } else {
    lines.push('', 'Loaded env files: (none)');
  }

  if (requiredVars.length > 0) {
    lines.push('', 'Required variables:');
    for (const { name, set } of varStatuses) {
      lines.push(`- ${name}: ${set ? 'SET' : 'MISSING'}`);
    }
  } else {
    lines.push('', 'Required variables: (none)');
  }

  lines.push('', 'Status:', isReady ? 'READY' : 'NOT READY');

  lines.push(
    '',
    'Recommended run command:',
    `npm run dev -- run ${targetPath} --suite --env ${selectedEnv} --target ${selectedTarget}`,
  );

  console.log('\n' + lines.join('\n'));
  process.exit(isReady ? 0 : 1);
} else if (command === 'analyze-failures') {
  const runResultPath = path.join(targetPath, '.qa-agents', 'runs', 'latest-run.json');
  const runResultRaw = readFileIfExists(runResultPath);

  if (!runResultRaw) {
    console.error('No latest run result found. Run tests first with qa-agents run.');
    process.exit(1);
  }

  const runData = JSON.parse(runResultRaw) as LatestRunData;
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

  const failures: FailedTest[] = runData.failedTests ?? [];

  if (runData.status === 'passed' || failures.length === 0) {
    lines.push('', 'No failures found in latest run.');
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

  console.log('\n' + lines.join('\n'));
} else if (command === 'discover-envs') {
  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    console.log('Project profile not found. Run analyze --save for better results.');
  }

  const profile: ProjectScanResult | null = profileRaw ? JSON.parse(profileRaw) : null;
  const report = buildDiscoverReport(targetPath, profile);
  console.log('\n' + report);
} else if (command === 'inspect') {
  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const report = buildInspectReport(profile, targetPath);
  console.log('\n' + report);
} else {
  printHelp();
}
