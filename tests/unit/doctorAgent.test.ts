import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDoctorAgent, buildDoctorReport } from '../../src/agents/doctorAgent';

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-doctor-'));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeProfile(repo: string): void {
  const qaDir = path.join(repo, '.qa-agents');
  fs.mkdirSync(qaDir, { recursive: true });
  const profile = {
    rootPath: repo,
    language: 'TypeScript',
    detectedFrameworks: ['Playwright'],
    structure: { testsDir: 'tests', specFilesCount: 7, usesPom: false },
  };
  fs.writeFileSync(path.join(qaDir, 'project-profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
}

describe('runDoctorAgent', () => {
  it('reports NOT READY when the target repo does not exist', () => {
    const missing = path.join(tempRoot, 'does-not-exist');
    const result = runDoctorAgent({ targetRepo: missing });

    expect(result.overall).toBe('NOT READY');
    const repoCheck = result.checks.find(c => c.label === 'Target repo exists');
    expect(repoCheck?.status).toBe('FAIL');
    expect(result.findings.some(f => f.severity === 'Error')).toBe(true);
  });

  it('reports PARTIAL for a repo with package.json only', () => {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}', 'utf-8');
    const result = runDoctorAgent({ targetRepo: tempRoot });

    expect(result.overall).toBe('PARTIAL');
    expect(result.checks.find(c => c.label === 'package.json found')?.status).toBe('OK');
    expect(result.checks.find(c => c.label === 'project-profile.json')?.status).toBe('WARN');
    expect(result.specFiles).toBeNull();
  });

  it('reports PARTIAL when project-profile.json exists but execution-config.json is missing', () => {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}', 'utf-8');
    writeProfile(tempRoot);

    const result = runDoctorAgent({ targetRepo: tempRoot });

    expect(result.overall).toBe('PARTIAL');
    expect(result.checks.find(c => c.label === 'project-profile.json')?.status).toBe('OK');
    expect(result.checks.find(c => c.label === 'execution-config.json')?.status).toBe('WARN');
    expect(result.specFiles).toBe(7);
  });

  it('reports READY when project-profile.json and execution-config.json both exist', () => {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}', 'utf-8');
    writeProfile(tempRoot);
    fs.writeFileSync(
      path.join(tempRoot, '.qa-agents', 'execution-config.json'),
      JSON.stringify({ environments: {}, targets: {} }, null, 2),
      'utf-8',
    );

    const result = runDoctorAgent({ targetRepo: tempRoot });

    expect(result.overall).toBe('READY');
    expect(result.checks.find(c => c.label === 'execution-config.json')?.status).toBe('OK');
  });

  it('flags an invalid latest-run.json as FAIL with an Error finding', () => {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}', 'utf-8');
    writeProfile(tempRoot);
    const runsDir = path.join(tempRoot, '.qa-agents', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'latest-run.json'), '{ invalid json', 'utf-8');

    const result = runDoctorAgent({ targetRepo: tempRoot });

    expect(result.checks.find(c => c.label === 'latest-run.json')?.status).toBe('FAIL');
    expect(result.findings.some(f => f.message.includes('latest-run.json') && f.severity === 'Error')).toBe(true);
  });
});

describe('buildDoctorReport', () => {
  it('renders the expected report sections', () => {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), '{}', 'utf-8');
    const result = runDoctorAgent({ targetRepo: tempRoot });
    const report = buildDoctorReport(result).join('\n');

    expect(report).toContain('QA Agents - Doctor');
    expect(report).toContain('Overall status:');
    expect(report).toContain('Checks:');
    expect(report).toContain('- AI config:');
    expect(report).toContain('- Spec files:');
    expect(report).toContain('Findings:');
    expect(report).toContain('Recommended next commands:');
  });
});

function writeExecConfig(repo: string, config: unknown): void {
  const qaDir = path.join(repo, '.qa-agents');
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, 'execution-config.json'), JSON.stringify(config, null, 2), 'utf-8');
}

describe('runDoctorAgent cloud-target diagnostics', () => {
  it('warns when cloud vars exist but no cloud target is configured', () => {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'LT_USERNAME=cloudUser\nLT_ACCESS_KEY=superSecret123\n', 'utf-8');
    writeExecConfig(tempRoot, { environments: {}, targets: { local: { script: 'test' } } });

    const result = runDoctorAgent({ targetRepo: tempRoot });
    const cloudFinding = result.findings.find(f =>
      f.message === 'Cloud execution variables found, but no cloud target is configured.');

    expect(cloudFinding).toBeDefined();
    expect(cloudFinding?.severity).toBe('Warning');
    expect(result.cloud.hasCloudVars).toBe(true);
    expect(result.cloud.targetConfigured).toBe(false);
    // Recommendation lists variable NAMES only.
    expect(cloudFinding?.recommendation).toContain('LT_USERNAME');
    expect(cloudFinding?.recommendation).toContain('LT_ACCESS_KEY');

    // Values must never be printed in the rendered report.
    const report = buildDoctorReport(result).join('\n');
    expect(report).toContain('- Cloud variables: LambdaTest (2)');
    expect(report).not.toContain('cloudUser');
    expect(report).not.toContain('superSecret123');
  });

  it('does not warn when a cloud target (lambda) is configured', () => {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'LT_USERNAME=cloudUser\nLT_ACCESS_KEY=superSecret123\n', 'utf-8');
    writeExecConfig(tempRoot, {
      environments: {},
      targets: {
        local: { script: 'test' },
        lambda: { script: 'test', requiredEnv: ['LT_USERNAME', 'LT_ACCESS_KEY'] },
      },
    });

    const result = runDoctorAgent({ targetRepo: tempRoot });
    const cloudFinding = result.findings.find(f =>
      f.message === 'Cloud execution variables found, but no cloud target is configured.');

    expect(cloudFinding).toBeUndefined();
    expect(result.cloud.hasCloudVars).toBe(true);
    expect(result.cloud.targetConfigured).toBe(true);
  });

  it('does not change readiness: profile + exec-config present stays READY despite the cloud warning', () => {
    writeProfile(tempRoot);
    fs.writeFileSync(path.join(tempRoot, '.env'), 'LT_USERNAME=u\nLT_ACCESS_KEY=k\n', 'utf-8');
    // exec-config exists but has no cloud target -> warning, but READY stays READY.
    writeExecConfig(tempRoot, { environments: {}, targets: { local: { script: 'test' } } });

    const result = runDoctorAgent({ targetRepo: tempRoot });
    expect(result.overall).toBe('READY');
    expect(result.findings.some(f =>
      f.message === 'Cloud execution variables found, but no cloud target is configured.')).toBe(true);
  });

  it('shows no Cloud variables line when there are no cloud vars', () => {
    fs.writeFileSync(path.join(tempRoot, '.env'), 'BASE_URL=https://example.com\n', 'utf-8');
    const result = runDoctorAgent({ targetRepo: tempRoot });
    expect(result.cloud.hasCloudVars).toBe(false);
    expect(buildDoctorReport(result).join('\n')).not.toContain('Cloud variables:');
  });
});
