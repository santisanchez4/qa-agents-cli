#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import { runRepoAnalyst, buildRepoAnalystReport } from '../agents/repoAnalystAgent';
import { printHelp } from './help';
import { classifyTestScript } from '../core/executionConfig';
import {
  runInitConfigAgent, buildInitConfigReport,
  runEnvCheckAgent, buildEnvCheckReport,
  runDiscoverEnvsAgent, buildDiscoverEnvsReport,
} from '../agents/executionConfigAgent';
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


const args = process.argv.slice(2);
const command = args[0];
const targetPath = path.resolve(args[1] || process.cwd());
const shouldSave = args.includes('--save');

if (command === 'analyze') {
  const result = runRepoAnalyst({ targetRepo: targetPath, save: shouldSave });

  const reportLines = buildRepoAnalystReport(result);
  if (reportLines.length > 0) console.log(reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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
  const result = runInitConfigAgent({ targetRepo: targetPath });

  const out = buildInitConfigReport(result);
  if (out.length > 0) console.log(out.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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

  const result = runEnvCheckAgent({
    targetRepo: targetPath,
    selectedEnv,
    selectedTarget,
    varsFileArg: envFileArg,
  });

  const out = buildEnvCheckReport(result);
  if (out.length > 0) console.log('\n' + out.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'analyze-failures') {
  const result = runFailureAnalyzer({ targetRepo: targetPath });

  const reportLines = buildFailureAnalyzerReport(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'discover-envs') {
  const result = runDiscoverEnvsAgent({ targetRepo: targetPath });

  const out = buildDiscoverEnvsReport(result);
  if (out.length > 0) console.log(out.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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
