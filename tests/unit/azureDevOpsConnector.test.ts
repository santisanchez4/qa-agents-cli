import { describe, it, expect } from 'vitest';
import {
  createAzureDevOpsConnector,
  parseAzureSteps,
  mapAzureWorkItem,
} from '../../src/core/connectors/azureDevOpsConnector';

const ENV = {
  AZURE_DEVOPS_ORG_URL: 'https://dev.azure.com/my-org',
  AZURE_DEVOPS_PROJECT: 'my-project',
  AZURE_DEVOPS_PAT: 'super-secret-pat',
};

type FetchCapture = { url?: string; init?: RequestInit };

function mockFetchJson(json: unknown, status = 200, capture?: FetchCapture): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (capture) { capture.url = url; capture.init = init; }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    };
  }) as unknown as typeof fetch;
}

const STEPS_XML =
  '<steps id="0" last="2">' +
  '<step id="2" type="ActionStep">' +
  '<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Navigate to login&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>' +
  '<parameterizedString isformatted="true">&lt;P&gt;Login page shown&lt;/P&gt;</parameterizedString>' +
  '</step>' +
  '<step id="3" type="ValidateStep">' +
  '<parameterizedString isformatted="true">Enter credentials</parameterizedString>' +
  '<parameterizedString isformatted="true">Dashboard appears</parameterizedString>' +
  '</step>' +
  '</steps>';

const WORK_ITEM = {
  id: 253628,
  fields: {
    'System.Title': 'Login smoke',
    'System.Description': '<div>User can log in with valid credentials.</div>',
    'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>AC one</li><li>AC two</li></ul>',
    'Microsoft.VSTS.TCM.Steps': STEPS_XML,
  },
};

describe('createAzureDevOpsConnector', () => {
  it('isConfigured true only when all env vars are set', () => {
    expect(createAzureDevOpsConnector({ env: ENV }).isConfigured()).toBe(true);
    expect(createAzureDevOpsConnector({ env: { ...ENV, AZURE_DEVOPS_PAT: '' } }).isConfigured()).toBe(false);
    expect(createAzureDevOpsConnector({ env: {} }).isConfigured()).toBe(false);
  });

  it('returns not_configured when config is missing', async () => {
    const connector = createAzureDevOpsConnector({ env: {}, fetchImpl: mockFetchJson(WORK_ITEM) });
    const res = await connector.importWorkItem({ provider: 'azure', externalId: '253628' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_configured');
    expect(res.error).toContain('AZURE_DEVOPS_ORG_URL');
  });

  it('maps a successful response into a WorkItemPayload', async () => {
    const capture: FetchCapture = {};
    const connector = createAzureDevOpsConnector({ env: ENV, fetchImpl: mockFetchJson(WORK_ITEM, 200, capture) });
    const res = await connector.importWorkItem({ provider: 'azure', externalId: '253628' });

    expect(res.ok).toBe(true);
    const payload = res.payload!;
    expect(payload.provider).toBe('azure');
    expect(payload.externalId).toBe('253628');
    expect(payload.title).toBe('Login smoke');
    expect(payload.description).toContain('User can log in');
    expect(payload.acceptanceCriteria).toEqual(['AC one', 'AC two']);
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps![0]).toEqual({ action: 'Navigate to login', expectedResult: 'Login page shown' });

    // URL uses org/project/id/api-version; auth is Basic and never the raw PAT.
    expect(capture.url).toContain('https://dev.azure.com/my-org/my-project/_apis/wit/workitems/253628');
    expect(capture.url).toContain('api-version=7.1');
    const auth = (capture.init?.headers as Record<string, string>).Authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(auth).not.toContain('super-secret-pat');
  });

  it('does not crash on missing/empty fields', async () => {
    const connector = createAzureDevOpsConnector({ env: ENV, fetchImpl: mockFetchJson({ id: 5 }) });
    const res = await connector.importWorkItem({ provider: 'azure', externalId: '5' });
    expect(res.ok).toBe(true);
    expect(res.payload!.title).toBe('Azure Work Item 5');
    expect(res.payload!.steps).toBeUndefined();
  });

  it('returns invalid_response for a null body', async () => {
    const connector = createAzureDevOpsConnector({ env: ENV, fetchImpl: mockFetchJson(null) });
    const res = await connector.importWorkItem({ provider: 'azure', externalId: '5' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid_response');
  });

  it('maps HTTP 404 to not_found and 401 to not_configured', async () => {
    const notFound = createAzureDevOpsConnector({ env: ENV, fetchImpl: mockFetchJson({}, 404) });
    expect((await notFound.importWorkItem({ provider: 'azure', externalId: '9' })).reason).toBe('not_found');

    const unauthorized = createAzureDevOpsConnector({ env: ENV, fetchImpl: mockFetchJson({}, 401) });
    expect((await unauthorized.importWorkItem({ provider: 'azure', externalId: '9' })).reason).toBe('not_configured');
  });

  it('never leaks the PAT value in error messages', async () => {
    const throwingFetch = (async () => {
      throw new Error('network failure for token=super-secret-pat');
    }) as unknown as typeof fetch;
    const connector = createAzureDevOpsConnector({ env: ENV, fetchImpl: throwingFetch });
    const res = await connector.importWorkItem({ provider: 'azure', externalId: '9' });

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('super-secret-pat');
    expect(res.error).toContain('***');
  });
});

describe('parseAzureSteps', () => {
  it('parses action/expected pairs from steps XML', () => {
    const steps = parseAzureSteps(STEPS_XML);
    expect(steps).toEqual([
      { action: 'Navigate to login', expectedResult: 'Login page shown' },
      { action: 'Enter credentials', expectedResult: 'Dashboard appears' },
    ]);
  });

  it('falls back to a single best-effort action for unrecognized content', () => {
    const steps = parseAzureSteps('<div>Just a free-form description</div>');
    expect(steps).toEqual([{ action: 'Just a free-form description' }]);
  });

  it('returns an empty array for empty content', () => {
    expect(parseAzureSteps('')).toEqual([]);
  });
});

describe('mapAzureWorkItem', () => {
  it('returns null for non-object input', () => {
    expect(mapAzureWorkItem('1', null)).toBeNull();
    expect(mapAzureWorkItem('1', 'not-json')).toBeNull();
  });
});
