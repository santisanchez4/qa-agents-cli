import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildAiConfigReport } from '../../src/core/aiConfigReport';

// Environment variables that buildAiConfigReport reads. We clear them before each
// test and restore the original process.env afterwards so tests stay isolated.
const MANAGED_VARS = [
  'QA_AGENTS_AI_PROVIDER',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'QA_AGENTS_DEEPSEEK_MODEL',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of MANAGED_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('buildAiConfigReport', () => {
  it('reports disabled / not configured when no provider is requested', () => {
    const report = buildAiConfigReport().join('\n');
    expect(report).toContain('- Resolved: disabled');
    expect(report).toContain('- Status: not configured');
    expect(report).toContain('- QA_AGENTS_AI_PROVIDER: MISSING');
  });

  it('shows an unsupported-provider message for an unknown provider', () => {
    process.env['QA_AGENTS_AI_PROVIDER'] = 'notaprovider';
    const report = buildAiConfigReport().join('\n');
    expect(report).toContain('Unsupported provider: notaprovider');
    expect(report).toContain('- Resolved: disabled');
    expect(report).toContain('- Status: not configured');
  });

  it('reports configured / SET when deepseek has an API key', () => {
    process.env['QA_AGENTS_AI_PROVIDER'] = 'deepseek';
    process.env['DEEPSEEK_API_KEY'] = 'sk-secret-value-should-not-print';

    const report = buildAiConfigReport().join('\n');

    expect(report).toContain('- Resolved: deepseek');
    expect(report).toContain('- Status: configured');
    expect(report).toContain('- API key: SET');
    expect(report).toContain('- DEEPSEEK_API_KEY: SET');
  });

  it('never prints the actual API key value', () => {
    const secret = 'sk-super-secret-12345';
    process.env['QA_AGENTS_AI_PROVIDER'] = 'deepseek';
    process.env['DEEPSEEK_API_KEY'] = secret;

    const report = buildAiConfigReport().join('\n');

    expect(report).not.toContain(secret);
  });
});
