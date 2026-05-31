import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runImportSpecAgent, buildImportSpecReport } from '../../src/agents/importSpecAgent';

let tempRoot: string;
let repo: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-import-'));
  repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('runImportSpecAgent validation', () => {
  it('errors when the target repo is missing', async () => {
    const result = await runImportSpecAgent({ targetRepo: '', provider: 'azure', externalId: '1' });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('Missing target repo');
  });

  it('errors when --provider is missing', async () => {
    const result = await runImportSpecAgent({ targetRepo: repo, externalId: '1' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Missing --provider');
  });

  it('errors when --id is missing', async () => {
    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'azure' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Missing --id');
  });

  it('errors on an unsupported provider', async () => {
    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'github', externalId: '1' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Unsupported provider');
  });

  it('errors when the target repo path does not exist', async () => {
    const result = await runImportSpecAgent({
      targetRepo: path.join(tempRoot, 'nope'),
      provider: 'azure',
      externalId: '1',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Target repo path does not exist');
  });
});

describe('runImportSpecAgent not-implemented behavior', () => {
  for (const provider of ['azure', 'jira', 'trello']) {
    it(`reports not implemented for ${provider}`, async () => {
      const result = await runImportSpecAgent({ targetRepo: repo, provider, externalId: '253628' });

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe(provider);
      expect(result.externalId).toBe('253628');
      expect(result.status).toBe('Not implemented yet.');
      expect(result.message).toContain('not implemented');
      // No spec file is created in Step 60.
      expect(fs.existsSync(path.join(repo, '.qa-agents', 'specs'))).toBe(false);

      const report = buildImportSpecReport(result).join('\n');
      expect(report).toContain('QA Agents - Import Spec');
      expect(report).toContain(`Provider:\n${provider}`);
      expect(report).toContain('External ID:\n253628');
      expect(report).toContain('Status:\nNot implemented yet.');
    });
  }

  it('builds an empty report for a validation failure', async () => {
    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'azure' });
    expect(buildImportSpecReport(result)).toEqual([]);
  });
});
