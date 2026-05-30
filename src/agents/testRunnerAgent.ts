import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ProjectScanResult } from '../core/projectScanner';
import { ExecutionConfig } from '../core/executionConfig';
import { loadEnvOverlay, isVarSet } from '../core/envLoader';
import { buildRunCommand } from '../core/testRunner';
import {
  LatestRunData,
  RetrySourceRun,
  RetryMetadata,
  parsePlaywrightSummary,
  parseFailedTests,
  saveLatestRun,
} from '../core/runResults';

/**
 * Use-case orchestration for the `run` command.
 *
 * core/ holds the reusable execution helpers (env loading, command building,
 * result parsing/saving). This agent wires them together for the three run
 * modes (--file, --suite, --failed), executes the test process, streams its
 * output, and persists latest-run.json. cli/ only parses flags, calls this
 * agent, prints any returned messages/errors, and exits with result.exitCode.
 *
 * Validation failures and the "no failed tests" informational case return
 * structured data without printing, so the CLI controls those streams. The
 * executed path prints inline (header, child output, save notice) because that
 * output is intrinsically interleaved with process execution.
 */

export type TestRunnerAgentOptions = {
  targetRepo: string;
  fileFlagPresent: boolean;
  relativeTestFile?: string;
  isSuite: boolean;
  isFailed: boolean;
  selectedEnv: string;
  selectedTarget: string;
  varsFileArg?: string;
};

export type TestRunnerAgentResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  messages: string[];
  executed: boolean;
};

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

export function runTestRunnerAgent(options: TestRunnerAgentOptions): TestRunnerAgentResult {
  const {
    targetRepo,
    fileFlagPresent,
    relativeTestFile,
    isSuite,
    isFailed,
    selectedEnv,
    selectedTarget,
    varsFileArg,
  } = options;

  const fail = (errors: string[], exitCode = 1): TestRunnerAgentResult =>
    ({ ok: false, exitCode, errors, messages: [], executed: false });
  const info = (messages: string[], exitCode = 0): TestRunnerAgentResult =>
    ({ ok: true, exitCode, errors: [], messages, executed: false });

  const modeCount = (fileFlagPresent ? 1 : 0) + (isSuite ? 1 : 0) + (isFailed ? 1 : 0);
  if (modeCount > 1) {
    return fail(['Please use only one run mode: --file, --suite, or --failed.']);
  }
  if (modeCount === 0) {
    return fail(['Please provide one run mode: --file <file>, --suite, or --failed.']);
  }

  // --failed: load latest run and extract failed file paths before anything else
  let failedFiles: string[] = [];
  let retrySourceRun: RetrySourceRun | null = null;

  if (isFailed) {
    const runResultPath = path.join(targetRepo, '.qa-agents', 'runs', 'latest-run.json');
    const runResultRaw = readFileIfExists(runResultPath);
    if (!runResultRaw) {
      return fail(['No latest run result found. Run a suite or file first.']);
    }
    let latestRun: LatestRunData;
    try {
      latestRun = JSON.parse(runResultRaw) as LatestRunData;
    } catch {
      return fail(['Could not read latest run result.']);
    }
    if (!latestRun.failedTests || latestRun.failedTests.length === 0) {
      return info(['No failed tests found in latest run.']);
    }
    failedFiles = [...new Set(
      latestRun.failedTests.map(t => t.file).filter((f): f is string => f !== null)
    )];
    if (failedFiles.length === 0) {
      return info(['No failed tests found in latest run.']);
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

  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const configPath = path.join(targetRepo, '.qa-agents', 'execution-config.json');

  const profileRaw = readFileIfExists(profilePath);
  const configRaw = readFileIfExists(configPath);

  if (!profileRaw) {
    return fail(['Missing project profile. Run analyze --save first.']);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);

  // Validate test file exists on disk (--file mode only)
  if (relativeTestFile !== undefined && !isFailed) {
    const absoluteTestFile = path.join(targetRepo, relativeTestFile);
    if (!fs.existsSync(absoluteTestFile)) {
      return fail([`Test file not found:\n${absoluteTestFile}`]);
    }
  }

  let finalCmd: string;
  let finalSpawnArgs: string[];
  let displayCmd: string;
  let envOverlay: Record<string, string> = {};
  let loadedFiles: string[] = [];
  const hasConfig = configRaw !== null;

  // Lines printed before the run starts (legacy notice). Kept separate so the
  // executed path can print them in the original order.
  const preRunNotices: string[] = [];

  if (hasConfig) {
    const config: ExecutionConfig = JSON.parse(configRaw!);

    if (!config.environments[selectedEnv]) {
      return fail([[
        `Environment not found: ${selectedEnv}`,
        '',
        'Available environments:',
        ...Object.keys(config.environments).map(e => `- ${e}`),
      ].join('\n')]);
    }

    if (!config.targets[selectedTarget]) {
      return fail([[
        `Target not found: ${selectedTarget}`,
        '',
        'Available targets:',
        ...Object.keys(config.targets).map(t => `- ${t}`),
      ].join('\n')]);
    }

    const envLoadResult = loadEnvOverlay(targetRepo, selectedEnv, varsFileArg);
    if (envLoadResult.error) {
      return fail([envLoadResult.error]);
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
      return fail([[
        'NOT READY — missing required variables:',
        ...missingVars.map(v => `- ${v}`),
      ].join('\n')]);
    }

    const scriptName = targetConfig.script;
    const pkgManager = profile.packageManager ?? 'npm';
    const packageScripts = profile.packageScripts ?? {};

    if (!scriptName || !(scriptName in packageScripts)) {
      return fail([`Configured script not found in package.json: ${scriptName || '(empty)'}`]);
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
    preRunNotices.push('Execution config not found. Running with project profile testCommand.');
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

  // Execution path — output is interleaved with the child process, so it is
  // printed inline here rather than returned to the CLI.
  for (const notice of preRunNotices) console.log(notice);

  // Print header
  const header = isFailed
    ? 'QA Agents - Failed Tests Runner'
    : isSuite
    ? 'QA Agents - Suite Runner'
    : 'QA Agents - Test Runner';
  console.log(`\n${header}\n`);
  console.log(`Target repo:\n${targetRepo}\n`);

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
    cwd: targetRepo,
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
    targetRepo: targetRepo,
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

  saveLatestRun(targetRepo, runData);
  if (isFailed) {
    console.log('Retry metadata saved in latest-run.json.');
  }

  return { ok: true, exitCode, errors: [], messages: [], executed: true };
}

/**
 * Returns the stdout lines the CLI should print. For executed runs all output
 * is already streamed inline, so this only carries the informational messages
 * from the non-executed paths (e.g. "No failed tests found in latest run.").
 */
export function buildTestRunnerAgentOutput(result: TestRunnerAgentResult): string[] {
  return result.messages;
}
