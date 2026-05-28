import fs from 'fs';
import path from 'path';

export type ProjectScanResult = {
  rootPath: string;
  detectedLanguage: string[];
  detectedFrameworks: string[];
  importantFiles: string[];
  packageManager?: string;
  testCommand?: string;
  packageScripts?: Record<string, string>;
  structure?: {
    testsDir?: string;
    pagesDir?: string;
    locatorsDir?: string;
    fixturesDir?: string;
    utilsDir?: string;
    servicesDir?: string;
    specFilesCount: number;
    usesPom: boolean;
  };
};

function findFirstExistingDir(rootPath: string, candidates: string[]): string | undefined {
  return candidates.find((candidate) =>
    fs.existsSync(path.join(rootPath, candidate)) &&
    fs.statSync(path.join(rootPath, candidate)).isDirectory()
  );
}

function countSpecFiles(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countSpecFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      count++;
    }
  }
  return count;
}

function detectStructure(rootPath: string): ProjectScanResult['structure'] {
  const testsDir = findFirstExistingDir(rootPath, ['tests', 'test', 'e2e']);
  const pagesDir = findFirstExistingDir(rootPath, ['pages', 'src/pages', 'PageObjects', 'pageObjects', 'src/apps', 'src/components', 'apps', 'components']);
  const locatorsDir = findFirstExistingDir(rootPath, ['locators', 'src/locators', 'selectors', 'src/selectors', 'src/views', 'views', 'src/elements', 'elements']);
  const fixturesDir = findFirstExistingDir(rootPath, ['fixtures', 'src/fixtures', 'test-data', 'data']);
  const utilsDir = findFirstExistingDir(rootPath, ['utils', 'src/utils', 'helpers', 'src/helpers']);
  const servicesDir = findFirstExistingDir(rootPath, ['services', 'src/services', 'api', 'src/api']);

  const specFilesCount = testsDir ? countSpecFiles(path.join(rootPath, testsDir)) : 0;
  const hasAppsOrComponents = !!(
    findFirstExistingDir(rootPath, ['src/apps', 'src/components'])
  );
  const usesPom = !!(pagesDir || locatorsDir || hasAppsOrComponents);

  return {
    ...(testsDir && { testsDir }),
    ...(pagesDir && { pagesDir }),
    ...(locatorsDir && { locatorsDir }),
    ...(fixturesDir && { fixturesDir }),
    ...(utilsDir && { utilsDir }),
    ...(servicesDir && { servicesDir }),
    specFilesCount,
    usesPom,
  };
}

function readPackageJson(rootPath: string): any | null {
  const packageJsonPath = path.join(rootPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const rawContent = fs.readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(rawContent);
}

export function scanProject(rootPath: string): ProjectScanResult {
  const files = fs.readdirSync(rootPath);

  const importantFiles: string[] = [];
  const detectedLanguage: string[] = [];
  const detectedFrameworks: string[] = [];

  const hasFile = (fileName: string) => files.includes(fileName);

  const packageJson = readPackageJson(rootPath);
  const packageScripts = packageJson?.scripts || undefined;
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  if (hasFile('package.json')) {
    importantFiles.push('package.json');
    detectedLanguage.push('JavaScript/TypeScript');
  }

  if (hasFile('tsconfig.json')) {
    importantFiles.push('tsconfig.json');
    detectedLanguage.push('TypeScript');
  }

  if (
    hasFile('playwright.config.ts') ||
    hasFile('playwright.config.js') ||
    dependencies?.['@playwright/test']
  ) {
    importantFiles.push('playwright.config');
    detectedFrameworks.push('Playwright');
  }

  if (
    hasFile('cypress.config.ts') ||
    hasFile('cypress.config.js') ||
    dependencies?.['cypress']
  ) {
    importantFiles.push('cypress.config');
    detectedFrameworks.push('Cypress');
  }

  if (hasFile('pom.xml')) {
    importantFiles.push('pom.xml');
    detectedLanguage.push('Java');
  }

  if (hasFile('package-lock.json')) {
    importantFiles.push('package-lock.json');
  }

  if (hasFile('yarn.lock')) {
    importantFiles.push('yarn.lock');
  }

  if (hasFile('pnpm-lock.yaml')) {
    importantFiles.push('pnpm-lock.yaml');
  }

  let packageManager: string | undefined;

  if (hasFile('pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (hasFile('yarn.lock')) packageManager = 'yarn';
  else if (hasFile('package-lock.json')) packageManager = 'npm';

  let testCommand: string | undefined;

    const testLikeScript = packageScripts
    ? Object.keys(packageScripts).find((scriptName) =>
        scriptName.toLowerCase().startsWith('test')
        )
    : undefined;

    if (packageScripts?.test) {
    testCommand = `${packageManager || 'npm'} run test`;
    } else if (testLikeScript) {
    testCommand = `${packageManager || 'npm'} run ${testLikeScript}`;
    } else if (detectedFrameworks.includes('Playwright')) {
    testCommand = 'npx playwright test';
    } else if (detectedFrameworks.includes('Cypress')) {
    testCommand = 'npx cypress run';
    }

  const structure = detectStructure(rootPath);

  return {
    rootPath,
    detectedLanguage: [...new Set(detectedLanguage)],
    detectedFrameworks: [...new Set(detectedFrameworks)],
    importantFiles: [...new Set(importantFiles)],
    packageManager,
    testCommand,
    packageScripts,
    structure,
  };
}