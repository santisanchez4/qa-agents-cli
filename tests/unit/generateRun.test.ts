import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Stub the test runner so no real Playwright/child process is ever launched.
vi.mock('../../src/agents/testRunnerAgent', () => ({
  runTestRunnerAgent: vi.fn(() => ({ ok: true, exitCode: 0, errors: [], messages: [], executed: true })),
}));

import { runTestRunnerAgent } from '../../src/agents/testRunnerAgent';
import { runAutomationGenerator, runGeneratedTest } from '../../src/agents/automationGeneratorAgent';

const runnerMock = vi.mocked(runTestRunnerAgent);

let tempRoot: string;
let repo: string;

const PROFILE = {
  rootPath: '',
  language: 'TypeScript',
  detectedFrameworks: ['Playwright'],
  packageManager: 'npm',
  testCommand: 'npm run test:e2e',
  structure: { testsDir: 'tests', specFilesCount: 0, usesPom: false },
};

const SPEC_MD = '# Login smoke\n\n1. Open the app\nExpected: user is logged in\n';

beforeEach(() => {
  runnerMock.mockClear();
  runnerMock.mockReturnValue({ ok: true, exitCode: 0, errors: [], messages: [], executed: true });

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-genrun-'));
  repo = path.join(tempRoot, 'repo');
  const qaDir = path.join(repo, '.qa-agents');
  fs.mkdirSync(path.join(qaDir, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'project-profile.json'), JSON.stringify({ ...PROFILE, rootPath: repo }), 'utf-8');
  fs.writeFileSync(path.join(qaDir, 'repo-rules.md'), '# Rules\n', 'utf-8');
  fs.writeFileSync(path.join(qaDir, 'specs', 'TC-100.md'), SPEC_MD, 'utf-8');
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const base = { tcId: '100', dryRun: false, write: false, force: false };

describe('generate --run validation', () => {
  it('returns a friendly error for --run without --write', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, run: true });
    expect(result.errors.join('\n')).toContain('The --run flag requires --write.');
    expect(result.runPlanned).toBeUndefined();
  });

  it('returns a friendly error for --run with --dry-run', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, run: true });
    expect(result.errors.join('\n')).toContain('The --run flag cannot be used with --dry-run.');
    expect(result.runPlanned).toBeUndefined();
  });
});

describe('generate --write --run planning', () => {
  it('plans a run of the generated file with env/target/vars after a successful write', async () => {
    const result = await runAutomationGenerator({
      ...base,
      targetRepo: repo,
      write: true,
      run: true,
      selectedEnv: 'QA',
      selectedTarget: 'lambda',
      varsFileArg: '.env.qa',
    });

    expect(result.writeSuccess).not.toBeNull();
    expect(result.runPlanned).toBeTruthy();
    expect(result.runPlanned!.relativeTestFile).toBe(result.writeSuccess!.suggestedFilePath);
    expect(result.runPlanned!.selectedEnv).toBe('QA');
    expect(result.runPlanned!.selectedTarget).toBe('lambda');
    expect(result.runPlanned!.varsFileArg).toBe('.env.qa');

    // The generator itself must not execute the runner.
    expect(runnerMock).not.toHaveBeenCalled();
  });

  it('defaults env/target to local when not provided', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, run: true });
    expect(result.runPlanned!.selectedEnv).toBe('local');
    expect(result.runPlanned!.selectedTarget).toBe('local');
  });

  it('does not plan a run when --run is absent', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true });
    expect(result.runPlanned).toBeUndefined();
  });

  it('does not plan a run when a duplicate blocks the write', async () => {
    const authDir = path.join(repo, 'tests', 'e2e', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, 'login.spec.ts'), "import { test } from '@playwright/test';\n", 'utf-8');

    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, run: true });
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('Refusing to auto-create a possible duplicate');
    expect(result.writeSuccess).toBeNull();
    expect(result.runPlanned).toBeUndefined();
  });

  it('does not plan a run when the write is refused (file exists)', async () => {
    await runAutomationGenerator({ ...base, targetRepo: repo, write: true });
    const second = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, run: true });
    expect(second.exitCode).toBe(1);
    expect(second.errors.join('\n')).toContain('Refusing to overwrite');
    expect(second.runPlanned).toBeUndefined();
  });
});

describe('runGeneratedTest (delegates to testRunnerAgent)', () => {
  it('runs only the generated file in --file mode and passes env/target/vars', async () => {
    const result = await runAutomationGenerator({
      ...base,
      targetRepo: repo,
      write: true,
      run: true,
      selectedEnv: 'staging',
      selectedTarget: 'chromium',
      varsFileArg: '.env.local',
    });

    const runResult = runGeneratedTest(result.runPlanned!);

    expect(runResult.exitCode).toBe(0);
    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(runnerMock).toHaveBeenCalledWith(expect.objectContaining({
      targetRepo: repo,
      fileFlagPresent: true,
      relativeTestFile: result.writeSuccess!.suggestedFilePath,
      isSuite: false,
      isFailed: false,
      selectedEnv: 'staging',
      selectedTarget: 'chromium',
      varsFileArg: '.env.local',
    }));
  });

  it('preserves a non-zero runner exit code (test failure)', async () => {
    runnerMock.mockReturnValue({ ok: false, exitCode: 1, errors: [], messages: [], executed: true });
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, run: true });
    const runResult = runGeneratedTest(result.runPlanned!);
    expect(runResult.exitCode).toBe(1);
  });

  it('preserves exit 0 on runner success', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, run: true });
    const runResult = runGeneratedTest(result.runPlanned!);
    expect(runResult.exitCode).toBe(0);
  });
});
