import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runImportSpecAgent, buildImportSpecReport } from '../../src/agents/importSpecAgent';

let tempRoot: string;
let repo: string;
let savedEnv: Record<string, string | undefined>;

const AZURE_VARS = ['AZURE_DEVOPS_ORG_URL', 'AZURE_DEVOPS_PROJECT', 'AZURE_DEVOPS_PAT'];
const PAT = 'super-secret-pat';

const WORK_ITEM = {
  id: 253628,
  fields: {
    'System.Title': 'Login smoke',
    'System.Description': '<div>User can log in with valid credentials.</div>',
    'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>AC one</li><li>AC two</li></ul>',
    'Microsoft.VSTS.TCM.Steps':
      '<steps><step type="ActionStep">' +
      '<parameterizedString>Navigate to login</parameterizedString>' +
      '<parameterizedString>Login page shown</parameterizedString>' +
      '</step></steps>',
  },
};

function stubFetch(json: unknown, status = 200): void {
  vi.stubGlobal('fetch', (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  })) as unknown as typeof fetch);
}

function setAzureEnv(): void {
  process.env.AZURE_DEVOPS_ORG_URL = 'https://dev.azure.com/my-org';
  process.env.AZURE_DEVOPS_PROJECT = 'my-project';
  process.env.AZURE_DEVOPS_PAT = PAT;
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-import-azure-'));
  repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  savedEnv = {};
  for (const key of AZURE_VARS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of AZURE_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('import-spec --provider azure (mocked Azure)', () => {
  it('creates .qa-agents/specs/TC-253628.md from a mocked Azure work item', async () => {
    setAzureEnv();
    stubFetch(WORK_ITEM);

    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'azure', externalId: '253628' });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.normalizedId).toBe('TC-253628');
    expect(result.title).toBe('Login smoke');

    const expectedPath = path.join(repo, '.qa-agents', 'specs', 'TC-253628.md');
    expect(result.outputPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const md = fs.readFileSync(expectedPath, 'utf-8');
    expect(md).toContain('# TC-253628 - Login smoke');
    expect(md).toContain('- Source: azure');
    expect(md).toContain('1. Navigate to login');     // step action
    expect(md).toContain('1. Login page shown');      // expected result
    expect(md).toContain('AC one');                   // acceptance criteria -> expected results

    // The PAT must never appear in the generated spec.
    expect(md).not.toContain(PAT);

    const report = buildImportSpecReport(result).join('\n');
    expect(report).toContain('Normalized spec created:');
    expect(report).toContain('--spec .qa-agents/specs/TC-253628.md --dry-run');
    expect(report).not.toContain(PAT);
  });

  it('refuses to overwrite an existing spec', async () => {
    setAzureEnv();
    stubFetch(WORK_ITEM);

    const first = await runImportSpecAgent({ targetRepo: repo, provider: 'azure', externalId: '253628' });
    expect(first.ok).toBe(true);

    const second = await runImportSpecAgent({ targetRepo: repo, provider: 'azure', externalId: '253628' });
    expect(second.ok).toBe(false);
    expect(second.exitCode).toBe(1);
    expect(second.errors.join('\n')).toContain('Refusing to overwrite');
  });

  it('reports a friendly error (exit 1) when Azure env is not configured', async () => {
    // No Azure env set in this test.
    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'azure', externalId: '253628' });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('not configured');
    expect(result.errors.join('\n')).not.toContain(PAT);
    expect(buildImportSpecReport(result)).toEqual([]);
  });

  it('maps Azure 404 to a friendly not-found error', async () => {
    setAzureEnv();
    stubFetch({}, 404);
    const result = await runImportSpecAgent({ targetRepo: repo, provider: 'azure', externalId: '999999' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('not found');
  });
});
