import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCapabilitiesAgent, buildCapabilitiesReport } from '../../src/agents/capabilitiesAgent';

let tempRepo: string;

beforeEach(() => {
  tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-caps-'));
});

afterEach(() => {
  fs.rmSync(tempRepo, { recursive: true, force: true });
});

function writePackage(scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(tempRepo, 'package.json'), JSON.stringify({ name: 't', scripts }, null, 2), 'utf-8');
}

function writeExecConfig(config: unknown): void {
  const qaDir = path.join(tempRepo, '.qa-agents');
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'execution-config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

function groupItems(result: ReturnType<typeof runCapabilitiesAgent>, title: string): string[] {
  return result.repoGroups.find(g => g.title === title)?.items ?? [];
}

describe('runCapabilitiesAgent', () => {
  it('detects Test generation for tc:generate / tc:auto / tc:run', () => {
    writePackage({ 'tc:generate': 'node gen', 'tc:auto': 'node auto', 'tc:run': 'node run' });
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });

    expect(groupItems(result, 'Test generation')).toEqual([
      'npm run tc:auto',
      'npm run tc:generate',
      'npm run tc:run',
    ]);
    // Generation detected -> orchestrate-first strategy line present.
    expect(result.strategy.some(s => s.includes('Prefer orchestrating repo-native generation'))).toBe(true);
  });

  it('detects Test execution for test / test:obr', () => {
    writePackage({ test: 'playwright test', 'test:obr': 'playwright test obr' });
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });

    expect(groupItems(result, 'Test execution')).toEqual([
      'npm run test',
      'npm run test:obr',
    ]);
  });

  it('detects AI / automation for test:ai', () => {
    writePackage({ 'test:ai': 'node ai-runner', test: 'playwright test' });
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });

    expect(groupItems(result, 'AI / automation')).toContain('npm run test:ai');
    // test:ai must NOT also appear under Test execution.
    expect(groupItems(result, 'Test execution')).not.toContain('npm run test:ai');
  });

  it('detects Cloud/grid execution from an execution-config lambda target', () => {
    writePackage({ test: 'playwright test' });
    writeExecConfig({ environments: {}, targets: { local: { script: 'test' }, lambda: { script: 'test' } } });
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });

    expect(groupItems(result, 'Cloud/grid execution')).toContain('target: lambda');
  });

  it('returns QA Agents capabilities and a warning when no package.json exists', () => {
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });

    expect(result.packageJsonFound).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('No package.json');
    expect(result.qaAgentsCapabilities).toContain('analyze');
    expect(result.qaAgentsCapabilities).toContain('doctor');
    expect(result.repoGroups).toEqual([]);

    const report = buildCapabilitiesReport(result).join('\n');
    expect(report).toContain('QA Agents - Capabilities');
    expect(report).toContain('QA Agents capabilities:');
    expect(report).toContain('- analyze');
  });

  it('does not print script command values (names only)', () => {
    writePackage({ 'test:lambda': 'LT_ACCESS_KEY=shouldNotLeak playwright test' });
    const result = runCapabilitiesAgent({ targetRepo: tempRepo });
    const report = buildCapabilitiesReport(result).join('\n');

    expect(report).toContain('- npm run test:lambda');
    expect(report).not.toContain('shouldNotLeak');
  });
});

describe('runCapabilitiesAgent strategy recommendations', () => {
  it('recommends orchestrating repo-native generation when tc:generate exists', () => {
    writePackage({ 'tc:generate': 'node gen', test: 'playwright test' });
    const strategy = runCapabilitiesAgent({ targetRepo: tempRepo }).strategy;

    expect(strategy.some(s => s.includes('Prefer orchestrating repo-native generation'))).toBe(true);
    expect(strategy.some(s => s.includes('Use qa-agents ai-review after generation'))).toBe(true);
    // The no-generation guidance must NOT appear.
    expect(strategy.some(s => s.includes('No repo-native TC generation scripts detected'))).toBe(false);
  });

  it('recommends qa-agents generate when no generation scripts exist', () => {
    writePackage({ test: 'playwright test' });
    const strategy = runCapabilitiesAgent({ targetRepo: tempRepo }).strategy;

    expect(strategy).toContain('No repo-native TC generation scripts detected.');
    expect(strategy).toContain('Use qa-agents generate for deterministic draft generation.');
    expect(strategy.some(s => s.includes('Prefer orchestrating repo-native generation'))).toBe(false);
  });

  it('recommends cloud execution when a lambda target exists', () => {
    writePackage({ test: 'playwright test' });
    writeExecConfig({ environments: {}, targets: { local: { script: 'test' }, lambda: { script: 'test' } } });
    const strategy = runCapabilitiesAgent({ targetRepo: tempRepo }).strategy;

    expect(strategy.some(s => s.includes('Cloud/grid execution detected') && s.includes('lambda'))).toBe(true);
  });

  it('recommends adding a cloud target when cloud vars exist but no cloud target', () => {
    writePackage({ test: 'playwright test' });
    fs.writeFileSync(path.join(tempRepo, '.env'), 'LT_USERNAME=u\nLT_ACCESS_KEY=k\n', 'utf-8');
    const strategy = runCapabilitiesAgent({ targetRepo: tempRepo }).strategy;

    expect(strategy).toContain('Cloud variables detected but no cloud target found. Add a cloud target to execution-config.json before running cloud tests.');
    // No cloud target -> the cloud-execution line should not appear.
    expect(strategy.some(s => s.includes('Cloud/grid execution detected'))).toBe(false);
  });

  it('recommends initialization when no package.json exists', () => {
    const strategy = runCapabilitiesAgent({ targetRepo: tempRepo }).strategy;

    expect(strategy).toContain('Initialize or verify the repo structure before generating or running tests.');
    expect(strategy).toContain('Run qa-agents analyze --save when package metadata becomes available.');
    // Generation guidance is skipped without a package.json.
    expect(strategy.some(s => s.includes('TC generation'))).toBe(false);
  });
});
