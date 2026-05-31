import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAutomationGenerator, buildAutomationGeneratorReport } from '../../src/agents/automationGeneratorAgent';

let tempRoot: string;
let repo: string;
let savedProvider: string | undefined;

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
  // Ensure no real AI provider is ever resolved during these tests.
  savedProvider = process.env.QA_AGENTS_AI_PROVIDER;
  delete process.env.QA_AGENTS_AI_PROVIDER;

  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-genreview-'));
  repo = path.join(tempRoot, 'repo');
  const qaDir = path.join(repo, '.qa-agents');
  fs.mkdirSync(path.join(qaDir, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'project-profile.json'), JSON.stringify({ ...PROFILE, rootPath: repo }), 'utf-8');
  fs.writeFileSync(path.join(qaDir, 'repo-rules.md'), '# Rules\n', 'utf-8');
  fs.writeFileSync(path.join(qaDir, 'specs', 'TC-100.md'), SPEC_MD, 'utf-8');
});

afterEach(() => {
  if (savedProvider === undefined) delete process.env.QA_AGENTS_AI_PROVIDER;
  else process.env.QA_AGENTS_AI_PROVIDER = savedProvider;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const base = { targetRepo: '', tcId: '100', dryRun: false, write: false, force: false };

describe('generate --review', () => {
  it('reviews the generated draft on --dry-run without writing the target test file', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, review: true });

    expect(result.ok).toBe(true);
    expect(result.reviewReport).toBeDefined();
    expect(result.reviewReport!.join('\n')).toContain('QA Agents - AI Automation Review');

    // dry-run must not write the generated test file.
    expect(fs.existsSync(path.join(repo, 'tests'))).toBe(false);

    const report = buildAutomationGeneratorReport(result).join('\n');
    expect(report).toContain('Generated test review:');
  });

  it('reviews the written file on --write', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, review: true });

    expect(result.ok).toBe(true);
    expect(result.writeSuccess).not.toBeNull();
    expect(fs.existsSync(result.writeSuccess!.filePath)).toBe(true);
    expect(result.reviewReport!.join('\n')).toContain('QA Agents - AI Automation Review');
  });

  it('does not run the AI layer unless --ai is passed', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, review: true });
    const text = result.reviewReport!.join('\n');
    expect(text).toContain('AI provider: not connected yet'); // deterministic-only mode
    expect(text).not.toContain('AI-assisted review:'); // AI section only when --ai requested
  });

  it('with --ai but no provider, deterministic review still runs and AI is skipped', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, review: true, ai: true });
    const text = result.reviewReport!.join('\n');
    expect(text).toContain('QA Agents - AI Automation Review');
    expect(text).toContain('AI-assisted review:'); // requested
    expect(text).toMatch(/Status: (skipped|not implemented)/);
  });

  it('--save-review writes the report under .qa-agents/reviews/', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, review: true, saveReview: true });

    expect(result.reviewSavedPath).toBeDefined();
    expect(fs.existsSync(result.reviewSavedPath!)).toBe(true);
    expect(result.reviewSavedPath!.replace(/\\/g, '/')).toContain('/.qa-agents/reviews/');

    const report = buildAutomationGeneratorReport(result).join('\n');
    expect(report).toContain('Review report saved:');
  });
});

describe('generate --review validation and safety', () => {
  it('returns a friendly error for --ai without --review', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, ai: true });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('The --ai flag requires --review.');
  });

  it('returns a friendly error for --save-review without --review', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true, saveReview: true });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('The --save-review flag requires --review.');
  });

  it('skips review when a duplicate blocks the write', async () => {
    // Pre-create a related test so duplicate detection blocks the write.
    const authDir = path.join(repo, 'tests', 'e2e', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, 'login.spec.ts'), "import { test } from '@playwright/test';\n", 'utf-8');

    const result = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, review: true });
    // Guard failures keep ok=true (plan still prints) but signal via exitCode/errors.
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('Refusing to auto-create a possible duplicate');
    expect(result.reviewReport).toBeUndefined(); // review skipped
  });

  it('skips review when the target file already exists (overwrite refused)', async () => {
    // First write succeeds and creates the target file.
    const first = await runAutomationGenerator({ ...base, targetRepo: repo, write: true });
    expect(first.writeSuccess).not.toBeNull();

    // Second write is refused by the overwrite guard.
    const second = await runAutomationGenerator({ ...base, targetRepo: repo, write: true, review: true });
    expect(second.exitCode).toBe(1);
    expect(second.errors.join('\n')).toContain('Refusing to overwrite');
    expect(second.reviewReport).toBeUndefined(); // review skipped
  });

  it('does not run review when --review is absent (output unchanged)', async () => {
    const result = await runAutomationGenerator({ ...base, targetRepo: repo, dryRun: true });
    expect(result.reviewReport).toBeUndefined();
    expect(result.reviewSavedPath).toBeUndefined();
    expect(buildAutomationGeneratorReport(result).join('\n')).not.toContain('Generated test review:');
  });
});
