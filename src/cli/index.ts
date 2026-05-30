#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { scanProject, ProjectScanResult } from '../core/projectScanner';
import { printHelp } from './help';
import { parseEnvFile, loadEnvOverlay, isVarSet } from '../core/envLoader';
import { ExecutionTarget, ExecutionEnvironment, ExecutionConfig, classifyTestScript, buildExecutionConfig } from '../core/executionConfig';
import { buildRepoRulesTemplate } from '../core/repoRulesTemplate';
import { buildAiConfigReport } from '../core/aiConfigReport';
import { LatestRunData, readLatestRunResultSafe } from '../core/runResults';
import { runFailureAnalyzer, buildFailureAnalyzerReport } from '../agents/failureAnalyzerAgent';
import { runReportAgent, buildReportAgentOutput } from '../agents/reportAgent';
import { runTestRunnerAgent, buildTestRunnerAgentOutput } from '../agents/testRunnerAgent';
import { collectSpecFiles } from '../core/testGeneration';
import { runAutomationGenerator, buildAutomationGeneratorReport } from '../agents/automationGeneratorAgent';
import { ReviewContext, runAiReview, runAiLayer, buildAiReviewReport } from '../agents/automationReviewerAgent';
import { saveAiReviewReport } from '../core/reviewReportWriter';
import { buildReviewHistoryReport } from '../core/reviewHistory';

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
  const specFlagIndex = args.indexOf('--spec');
  const specArg = specFlagIndex !== -1 ? args[specFlagIndex + 1] : undefined;

  const result = runAutomationGenerator({
    targetRepo: targetPath,
    specArg,
    dryRun: isDryRun,
    write: args.includes('--write'),
    force: args.includes('--force'),
  });

  const reportLines = buildAutomationGeneratorReport(result);
  if (reportLines.length > 0) console.log(reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'run') {
  const fileFlagIndex = args.indexOf('--file');
  const relativeTestFile = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : undefined;
  const envFlagIdx = args.indexOf('--env');
  const selectedEnv = envFlagIdx !== -1 ? args[envFlagIdx + 1] : 'local';
  const targetFlagIdx = args.indexOf('--target');
  const selectedTarget = targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : 'local';
  const varsFlagIdx = args.indexOf('--vars-file');
  const varsFileArg = varsFlagIdx !== -1 ? args[varsFlagIdx + 1] : undefined;

  const result = runTestRunnerAgent({
    targetRepo: targetPath,
    fileFlagPresent: args.includes('--file'),
    relativeTestFile,
    isSuite: args.includes('--suite'),
    isFailed: args.includes('--failed'),
    selectedEnv,
    selectedTarget,
    varsFileArg,
  });

  for (const message of buildTestRunnerAgentOutput(result)) console.log(message);
  for (const errorLine of result.errors) console.error(errorLine);
  process.exit(result.exitCode);
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
} else if (command === 'init-rules') {
  const qaDir = path.join(targetPath, '.qa-agents');
  if (!fs.existsSync(qaDir)) {
    fs.mkdirSync(qaDir, { recursive: true });
  }

  const rulesPath = path.join(qaDir, 'repo-rules.md');

  if (fs.existsSync(rulesPath)) {
    console.log(`Repo rules file already exists:\n${rulesPath}`);
  } else {
    fs.writeFileSync(rulesPath, buildRepoRulesTemplate(), 'utf-8');
    console.log(`Created repo rules file:\n${rulesPath}`);
  }
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
  const result = runFailureAnalyzer({ targetRepo: targetPath });

  const reportLines = buildFailureAnalyzerReport(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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
} else if (command === 'report') {
  const result = runReportAgent({ targetRepo: targetPath });

  const reportLines = buildReportAgentOutput(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'ai-config') {
  const configLines = buildAiConfigReport();
  console.log('\n' + configLines.join('\n'));
} else if (command === 'reviews') {
  const historyLines = buildReviewHistoryReport(targetPath);
  console.log('\n' + historyLines.join('\n'));
} else if (command === 'ai-review') {
  const fileFlagIndex = args.indexOf('--file');
  const relativeTestFile = fileFlagIndex !== -1 ? args[fileFlagIndex + 1] : undefined;
  const useAi = args.includes('--ai');
  const saveReport = args.includes('--save-report');

  if (!relativeTestFile) {
    console.error('Missing --file argument. Provide a test file path relative to the target repo.');
    process.exit(1);
  }

  const absoluteTestFile = path.join(targetPath, relativeTestFile);
  if (!fs.existsSync(absoluteTestFile)) {
    console.error(`Test file not found:\n${absoluteTestFile}`);
    process.exit(1);
  }

  const profilePath = path.join(targetPath, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);
  if (!profileRaw) {
    console.error('Missing project profile. Run analyze --save first.');
    process.exit(1);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const repoRules = readFileIfExists(path.join(targetPath, '.qa-agents', 'repo-rules.md'));
  const executionConfig = readFileIfExists(path.join(targetPath, '.qa-agents', 'execution-config.json'));
  const fileContent = fs.readFileSync(absoluteTestFile, 'utf-8');

  // Best-effort: a missing or malformed latest-run.json must not fail ai-review.
  const latestRunRead = readLatestRunResultSafe(targetPath);
  const latestRun: LatestRunData | null = latestRunRead.ok ? latestRunRead.data! : null;

  const reviewContext: ReviewContext = {
    targetRepo: targetPath,
    relativeFilePath: relativeTestFile.replace(/\\/g, '/'),
    fileContent,
    framework: (profile.detectedFrameworks ?? []).join(', ') || '(none detected)',
    testCommand: profile.testCommand ?? '(none)',
    repoRules,
    executionConfig,
    latestRun,
    aiEnabled: useAi,
  };

  (async () => {
    const reviewResult = runAiReview(reviewContext);
    const aiLayer = await runAiLayer(reviewContext, reviewResult);
    const reviewLines = buildAiReviewReport(reviewContext, reviewResult, aiLayer);
    console.log('\n' + reviewLines.join('\n'));

    if (saveReport) {
      const { latestPath, timestampedPath } = saveAiReviewReport(targetPath, reviewLines);
      console.log('\nReview report saved:');
      console.log(latestPath);
      console.log('\nTimestamped copy:');
      console.log(timestampedPath);
    }
  })().catch(err => {
    console.error('ai-review failed unexpectedly:', (err as Error).message);
    process.exit(1);
  });
} else {
  printHelp();
}
