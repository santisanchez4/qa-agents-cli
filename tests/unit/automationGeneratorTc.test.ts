import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runAutomationGenerator, buildAutomationGeneratorReport } from '../../src/agents/automationGeneratorAgent';

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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-gentc-'));
  repo = path.join(tempRoot, 'repo');
  const qaDir = path.join(repo, '.qa-agents');
  fs.mkdirSync(path.join(qaDir, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'project-profile.json'), JSON.stringify({ ...PROFILE, rootPath: repo }), 'utf-8');
  fs.writeFileSync(path.join(qaDir, 'repo-rules.md'), '# Rules\n', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeSpec(normalizedId: string): void {
  fs.writeFileSync(path.join(repo, '.qa-agents', 'specs', `${normalizedId}.md`), SPEC_MD, 'utf-8');
}

describe('generate --tc resolution', () => {
  it('resolves --tc 253628 to .qa-agents/specs/TC-253628.md (dry-run)', () => {
    writeSpec('TC-253628');
    const result = runAutomationGenerator({ targetRepo: repo, tcId: '253628', dryRun: true, write: false, force: false });

    expect(result.ok).toBe(true);
    expect(result.resolvedTcSpec).toBe('.qa-agents/specs/TC-253628.md');
    expect(result.draft).toBeTruthy();

    const report = buildAutomationGeneratorReport(result).join('\n');
    expect(report).toContain('Resolved TC spec:');
    expect(report).toContain('.qa-agents/specs/TC-253628.md');
  });

  it('resolves --tc TC-253628 correctly', () => {
    writeSpec('TC-253628');
    const result = runAutomationGenerator({ targetRepo: repo, tcId: 'TC-253628', dryRun: true, write: false, force: false });
    expect(result.ok).toBe(true);
    expect(result.resolvedTcSpec).toBe('.qa-agents/specs/TC-253628.md');
  });

  it('resolves --tc tc_253628 correctly', () => {
    writeSpec('TC-253628');
    const result = runAutomationGenerator({ targetRepo: repo, tcId: 'tc_253628', dryRun: true, write: false, force: false });
    expect(result.ok).toBe(true);
    expect(result.resolvedTcSpec).toBe('.qa-agents/specs/TC-253628.md');
  });

  it('returns a friendly error when the resolved spec does not exist', () => {
    const result = runAutomationGenerator({ targetRepo: repo, tcId: '999999', dryRun: true, write: false, force: false });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    const msg = result.errors.join('\n');
    expect(msg).toContain('Normalized spec not found for TC-999999');
    expect(msg).toContain('import-spec');
    expect(msg).toContain('normalize-spec');
  });

  it('returns a friendly error for an invalid TC id', () => {
    const result = runAutomationGenerator({ targetRepo: repo, tcId: 'not-an-id', dryRun: true, write: false, force: false });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Invalid --tc id');
  });

  it('returns a friendly error when --spec and --tc are both provided', () => {
    writeSpec('TC-253628');
    const result = runAutomationGenerator({
      targetRepo: repo,
      specArg: '.qa-agents/specs/TC-253628.md',
      tcId: '253628',
      dryRun: true, write: false, force: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Both --spec and --tc were provided');
  });

  it('returns a friendly error when --tc has no value', () => {
    const result = runAutomationGenerator({ targetRepo: repo, tcId: '', dryRun: true, write: false, force: false });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Missing value for --tc');
  });

  it('works with --write using --tc', () => {
    writeSpec('TC-253628');
    const result = runAutomationGenerator({ targetRepo: repo, tcId: '253628', dryRun: false, write: true, force: false });

    expect(result.ok).toBe(true);
    expect(result.resolvedTcSpec).toBe('.qa-agents/specs/TC-253628.md');
    expect(result.writeSuccess).not.toBeNull();
    expect(fs.existsSync(result.writeSuccess!.filePath)).toBe(true);
  });
});

describe('generate --spec still works (regression)', () => {
  it('loads a spec via --spec and produces a draft (dry-run)', () => {
    writeSpec('TC-100');
    const result = runAutomationGenerator({
      targetRepo: repo,
      specArg: '.qa-agents/specs/TC-100.md',
      dryRun: true, write: false, force: false,
    });
    expect(result.ok).toBe(true);
    expect(result.resolvedTcSpec).toBeNull(); // not a --tc run
    expect(result.draft).toBeTruthy();
  });

  it('reports missing --spec/--tc when neither is provided', () => {
    const result = runAutomationGenerator({ targetRepo: repo, dryRun: true, write: false, force: false });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Missing --spec or --tc argument.');
  });
});
