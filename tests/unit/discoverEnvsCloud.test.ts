import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDiscoverEnvsAgent } from '../../src/agents/executionConfigAgent';

let tempRepo: string;

beforeEach(() => {
  tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-cloud-'));
});

afterEach(() => {
  fs.rmSync(tempRepo, { recursive: true, force: true });
});

function writeEnv(contents: string): void {
  fs.writeFileSync(path.join(tempRepo, '.env'), contents, 'utf-8');
}

function report(): string {
  return runDiscoverEnvsAgent({ targetRepo: tempRepo }).report;
}

describe('discover-envs cloud detection', () => {
  it('detects LambdaTest LT_USERNAME / LT_ACCESS_KEY from .env (names only, no values)', () => {
    writeEnv('LT_USERNAME=myCloudUser\nLT_ACCESS_KEY=superSecretKey123\n');
    const r = report();

    expect(r).toContain('Cloud execution:');
    expect(r).toContain('LambdaTest:');
    expect(r).toContain('- LT_USERNAME');
    expect(r).toContain('- LT_ACCESS_KEY');

    // Values must never appear.
    expect(r).not.toContain('myCloudUser');
    expect(r).not.toContain('superSecretKey123');
  });

  it('detects LAMBDATEST_KEY from .env under LambdaTest', () => {
    writeEnv('LAMBDATEST_KEY=abc123secretValue\n');
    const r = report();

    expect(r).toContain('LambdaTest:');
    expect(r).toContain('- LAMBDATEST_KEY');
    expect(r).not.toContain('abc123secretValue');
  });

  it('detects BrowserStack credentials under BrowserStack', () => {
    writeEnv('BROWSERSTACK_USERNAME=bsUser\nBROWSERSTACK_ACCESS_KEY=bsSecret\n');
    const r = report();

    expect(r).toContain('BrowserStack:');
    expect(r).toContain('- BROWSERSTACK_USERNAME');
    expect(r).toContain('- BROWSERSTACK_ACCESS_KEY');
    expect(r).not.toContain('bsUser');
    expect(r).not.toContain('bsSecret');
  });

  it('lists unknown cloud-like names as keys only under "Unknown cloud-related"', () => {
    writeEnv('SAUCE_USERNAME=sauceUser\nSELENIUM_GRID_URL=http://grid.example/wd/hub\n');
    const r = report();

    expect(r).toContain('Unknown cloud-related:');
    expect(r).toContain('- SAUCE_USERNAME');
    expect(r).toContain('- SELENIUM_GRID_URL');
    expect(r).not.toContain('sauceUser');
    // The grid URL value (host) must not be printed.
    expect(r).not.toContain('grid.example');
  });

  it('detects cloud var names from execution-config.json requiredEnv even without .env', () => {
    const qaDir = path.join(tempRepo, '.qa-agents');
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(
      path.join(qaDir, 'execution-config.json'),
      JSON.stringify({
        environments: {},
        targets: { lambda: { script: 'test', requiredEnv: ['LT_USERNAME', 'LT_ACCESS_KEY'] } },
      }),
      'utf-8',
    );

    const r = report();
    expect(r).toContain('Cloud execution:');
    expect(r).toContain('LambdaTest:');
    expect(r).toContain('- LT_USERNAME');
    expect(r).toContain('- LT_ACCESS_KEY');
  });

  it('does not show a Cloud execution section when no cloud vars are present', () => {
    writeEnv('BASE_URL=https://example.com\nE2E_EMAIL=user@example.com\n');
    const r = report();
    expect(r).not.toContain('Cloud execution:');
  });
});
