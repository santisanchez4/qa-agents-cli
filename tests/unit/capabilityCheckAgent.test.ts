import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCapabilityCheckAgent, buildCapabilityCheckReport } from '../../src/agents/capabilityCheckAgent';

let tempRepo: string;

beforeEach(() => {
  tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-capcheck-'));
});

afterEach(() => {
  fs.rmSync(tempRepo, { recursive: true, force: true });
});

function writePackage(scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(tempRepo, 'package.json'), JSON.stringify({ name: 't', scripts }, null, 2), 'utf-8');
}

function candidate(result: ReturnType<typeof runCapabilityCheckAgent>, label: string) {
  return result.candidates.find(c => c.label === label);
}

describe('runCapabilityCheckAgent', () => {
  it('detects tc:generate as high-confidence Test generation', () => {
    writePackage({ 'tc:generate': 'node scripts/tc-generate.mjs' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });
    const c = candidate(result, 'npm run tc:generate');

    expect(c).toBeDefined();
    expect(c?.type).toBe('Test generation');
    expect(c?.confidence).toBe('High');
  });

  it('detects generate-tests even without a tc prefix', () => {
    writePackage({ 'generate-tests': 'node gen.mjs' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });
    const c = candidate(result, 'npm run generate-tests');

    expect(c).toBeDefined();
    expect(c?.type).toBe('Test generation');
  });

  it('detects scripts/tc-generate.mjs filename as evidence', () => {
    writePackage({ 'tc:generate': 'node scripts/tc-generate.mjs --out cases' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });
    const c = candidate(result, 'npm run tc:generate');

    expect(c?.evidence.some(e => e.includes('scripts/tc-generate.mjs'))).toBe(true);
  });

  it('marks scripts with delete/clean/prod operations as potentially unsafe', () => {
    writePackage({
      'tc:generate': 'node gen.mjs && rm -rf out',
      'deploy:prod': 'node scripts/automation-generator.js --prod',
    });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });

    expect(candidate(result, 'npm run tc:generate')?.safety).toBe('Potentially unsafe to execute automatically');
    expect(candidate(result, 'npm run deploy:prod')?.safety).toBe('Potentially unsafe to execute automatically');
  });

  it('detects Playwright test execution as Safe to inspect', () => {
    writePackage({ 'test:obr': 'playwright test tests/obr' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });
    const c = candidate(result, 'npm run test:obr');

    expect(c?.type).toBe('Test execution');
    expect(c?.safety).toBe('Safe to inspect');
    expect(c?.evidence).toContain('Script command runs Playwright');
  });

  it('shows a friendly error and suggestions when --script is missing', () => {
    writePackage({ 'tc:generate': 'node gen.mjs', 'tc:auto': 'node auto.mjs', test: 'playwright test' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo, scriptName: 'tc:generat' });

    expect(result.exitCode).toBe(1);
    expect(result.scriptNotFound).toBeDefined();
    expect(result.scriptNotFound?.name).toBe('tc:generat');
    expect(result.scriptNotFound?.suggestions).toContain('tc:generate');

    const report = buildCapabilityCheckReport(result).join('\n');
    expect(report).toContain('Script not found: tc:generat');
    expect(report).toContain('- tc:generate');
  });

  it('prints the native fallback when no QA candidates are found', () => {
    writePackage({ lint: 'eslint .', build: 'tsc -p .' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });

    expect(result.noCandidates).toBe(true);
    const report = buildCapabilityCheckReport(result).join('\n');
    expect(report).toContain('No repo-native QA automation capabilities found.');
    expect(report).toContain('- generate');
    expect(report).toContain('- ai-review');
  });

  it('does not print secret values from script commands', () => {
    writePackage({ 'test:lambda': 'LT_ACCESS_KEY=topSecretValue playwright test' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo });
    const report = buildCapabilityCheckReport(result).join('\n');

    expect(report).toContain('npm run test:lambda');
    expect(report).not.toContain('topSecretValue');
  });

  it('analyzes only the requested script in single mode', () => {
    writePackage({ 'tc:generate': 'node scripts/tc-generate.mjs', test: 'playwright test' });
    const result = runCapabilityCheckAgent({ targetRepo: tempRepo, scriptName: 'tc:generate' });

    expect(result.mode).toBe('single');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].label).toBe('npm run tc:generate');
  });
});
