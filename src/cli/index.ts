#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import { runRepoAnalyst, buildRepoAnalystReport } from '../agents/repoAnalystAgent';
import { printHelp } from './help';
import {
  runInitConfigAgent, buildInitConfigReport,
  runEnvCheckAgent, buildEnvCheckReport,
  runDiscoverEnvsAgent, buildDiscoverEnvsReport,
} from '../agents/executionConfigAgent';
import { runRepoRulesAgent, buildRepoRulesReport } from '../agents/repoRulesAgent';
import { buildAiConfigReport } from '../core/aiConfigReport';
import { LatestRunData, readLatestRunResultSafe } from '../core/runResults';
import { runFailureAnalyzer, buildFailureAnalyzerReport } from '../agents/failureAnalyzerAgent';
import { runReportAgent, buildReportAgentOutput } from '../agents/reportAgent';
import { runTestRunnerAgent, buildTestRunnerAgentOutput } from '../agents/testRunnerAgent';
import { runSuiteInspector, buildSuiteInspectorReport } from '../agents/suiteInspectorAgent';
import { runDoctorAgent, buildDoctorReport } from '../agents/doctorAgent';
import { runCapabilitiesAgent, buildCapabilitiesReport } from '../agents/capabilitiesAgent';
import { runCapabilityCheckAgent, buildCapabilityCheckReport } from '../agents/capabilityCheckAgent';
import { runSpecNormalizerAgent, buildSpecNormalizerReport } from '../agents/specNormalizerAgent';
import { runImportSpecAgent, buildImportSpecReport } from '../agents/importSpecAgent';
import { runAutomationGenerator, buildAutomationGeneratorReport } from '../agents/automationGeneratorAgent';
import { ReviewContext, runAiReview, runAiLayer, buildAiReviewReport } from '../agents/automationReviewerAgent';
import { saveAiReviewReport } from '../core/reviewReportWriter';
import { buildReviewHistoryReport } from '../core/reviewHistory';

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
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

  // --tc <id> resolves to .qa-agents/specs/TC-<id>.md. A present-but-valueless
  // flag is passed as '' so the agent can report a friendly "missing value".
  const tcFlagIndex = args.indexOf('--tc');
  let tcId: string | undefined;
  if (tcFlagIndex !== -1) {
    const tcValue = args[tcFlagIndex + 1];
    tcId = tcValue && !tcValue.startsWith('--') ? tcValue : '';
  }

  const result = runAutomationGenerator({
    targetRepo: targetPath,
    specArg,
    tcId,
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
  const result = runRepoRulesAgent({ targetRepo: targetPath });

  const out = buildRepoRulesReport(result);
  if (out.length > 0) console.log(out.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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
  const result = runSuiteInspector({ targetRepo: targetPath });

  const out = buildSuiteInspectorReport(result);
  if (out.length > 0) console.log('\n' + out.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
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
} else if (command === 'doctor') {
  const result = runDoctorAgent({ targetRepo: targetPath });

  const reportLines = buildDoctorReport(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'capabilities') {
  const result = runCapabilitiesAgent({ targetRepo: targetPath });

  const reportLines = buildCapabilitiesReport(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'capability-check') {
  const scriptFlagIndex = args.indexOf('--script');
  const scriptName = scriptFlagIndex !== -1 ? args[scriptFlagIndex + 1] : undefined;

  const result = runCapabilityCheckAgent({ targetRepo: targetPath, scriptName });

  const reportLines = buildCapabilityCheckReport(result);
  if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
  for (const errorLine of result.errors) console.error(errorLine);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} else if (command === 'normalize-spec') {
  const inputFlagIndex = args.indexOf('--input');
  const inputFile = inputFlagIndex !== -1 ? args[inputFlagIndex + 1] : undefined;
  const idFlagIndex = args.indexOf('--id');
  const id = idFlagIndex !== -1 ? args[idFlagIndex + 1] : undefined;
  // The repo is the first positional arg; treat a leading flag as "not provided".
  const repoProvided = args[1] !== undefined && !args[1].startsWith('--');

  (async () => {
    const result = await runSpecNormalizerAgent({
      targetRepo: repoProvided ? targetPath : '',
      inputFile,
      id,
    });

    const reportLines = buildSpecNormalizerReport(result);
    if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
    for (const errorLine of result.errors) console.error(errorLine);
    if (result.exitCode !== 0) process.exit(result.exitCode);
  })().catch(err => {
    console.error('normalize-spec failed unexpectedly:', (err as Error).message);
    process.exit(1);
  });
} else if (command === 'import-spec') {
  const providerFlagIndex = args.indexOf('--provider');
  const provider = providerFlagIndex !== -1 ? args[providerFlagIndex + 1] : undefined;
  const idFlagIndex = args.indexOf('--id');
  const externalId = idFlagIndex !== -1 ? args[idFlagIndex + 1] : undefined;
  const repoProvided = args[1] !== undefined && !args[1].startsWith('--');

  (async () => {
    const result = await runImportSpecAgent({
      targetRepo: repoProvided ? targetPath : '',
      provider,
      externalId,
    });

    const reportLines = buildImportSpecReport(result);
    if (reportLines.length > 0) console.log('\n' + reportLines.join('\n'));
    for (const errorLine of result.errors) console.error(errorLine);
    if (result.exitCode !== 0) process.exit(result.exitCode);
  })().catch(err => {
    console.error('import-spec failed unexpectedly:', (err as Error).message);
    process.exit(1);
  });
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
