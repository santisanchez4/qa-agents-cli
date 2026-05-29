import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from './projectScanner';

// ─── Utilities ────────────────────────────────────────────────────────────────

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

export function collectSpecFiles(dirPath: string, max: number): string[] {
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

export function normalizeSpecTitle(title: string): string {
  return title.replace(/^(?:test\s+spec|spec|test)\s*:\s*/i, '').trim();
}

// ─── Folder matching ──────────────────────────────────────────────────────────

const SUPPORT_FOLDERS = new Set([
  'fixtures', 'helpers', 'setup', 'support', 'utils', 'data', 'types', 'mocks',
]);

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

// ─── Pattern detection ────────────────────────────────────────────────────────

export type ExistingPatterns = {
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

export function detectExistingPatterns(
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

// ─── Automation plan ──────────────────────────────────────────────────────────

export type AutomationPlanResult = {
  plan: string;
  suggestedFilePath: string;
  targetFolder: string;
  e2eBase: string | null;
  testsDir: string;
  patterns: ExistingPatterns;
};

export function buildAutomationPlan(
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

// ─── Test code generation ─────────────────────────────────────────────────────

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

export function buildTestCode(
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

export function buildDeterministicTestDraft(
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
