#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { scanProject, ProjectScanResult } from '../core/projectScanner';

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

function buildRunCommand(
  testCommand: string,
  relativeTestFile: string
): { cmd: string; spawnArgs: string[]; display: string } {
  const parts = testCommand.trim().split(/\s+/);
  const isNpmRun = parts.length >= 2 && parts[0] === 'npm' && parts[1] === 'run';
  const spawnArgs = isNpmRun
    ? [...parts.slice(1), '--', relativeTestFile]
    : [...parts.slice(1), relativeTestFile];
  const display = isNpmRun
    ? `${testCommand} -- ${relativeTestFile}`
    : `${testCommand} ${relativeTestFile}`;
  return { cmd: parts[0], spawnArgs, display };
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

  if (!relativeTestFile) {
    console.error('Missing --file argument.');
    process.exit(1);
  }

  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  const absoluteTestFile = path.join(targetPath, relativeTestFile);
  if (!fs.existsSync(absoluteTestFile)) {
    console.error(`Test file not found:\n${absoluteTestFile}`);
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const testCmd = profile.testCommand ?? 'npx playwright test';
  const { cmd, spawnArgs, display } = buildRunCommand(testCmd, relativeTestFile);

  console.log('\nQA Agents - Test Runner\n');
  console.log(`Target repo:\n${targetPath}\n`);
  console.log(`Test file:\n${relativeTestFile}\n`);
  console.log(`Command:\n${display}\n`);

  const result = spawnSync(cmd, spawnArgs, {
    cwd: targetPath,
    stdio: 'inherit',
    shell: true,
  });

  process.exit(result.status ?? 1);
} else {
  console.log(`
Available commands:

  analyze [path]                Analyze a local automation repository
  analyze [path] --save         Save analysis to .qa-agents/project-profile.json
  generate [path] --spec <file> Load a local test spec for future automation generation
  generate [path] --spec <file> --dry-run  Preview generated test without writing files
  generate [path] --spec <file> --write    Generate and write the test file
  generate [path] --spec <file> --write --force  Write even if related tests exist
  run [path] --file <file>      Run a specific test file using the detected project test command
`);
}
