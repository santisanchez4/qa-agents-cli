import { describe, it, expect } from 'vitest';
import { resolveWorkItemConnector, SUPPORTED_PROVIDERS } from '../../src/core/connectors/workItemConnectorResolver';
import { createDisabledWorkItemConnector } from '../../src/core/connectors/disabledWorkItemConnector';

describe('resolveWorkItemConnector', () => {
  it('recognizes azure/jira/trello/disabled case-insensitively', () => {
    const cases: Array<[string, string]> = [
      ['azure', 'azure'],
      ['AZURE', 'azure'],   // azure has a real adapter (Step 61)
      ['Jira', 'disabled'],
      ['  trello  ', 'disabled'],
      ['Disabled', 'disabled'],
    ];
    for (const [raw, expectedConnectorName] of cases) {
      const result = resolveWorkItemConnector(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(SUPPORTED_PROVIDERS).toContain(result.provider);
        expect(result.connector.name).toBe(expectedConnectorName);
      }
    }
  });

  it('preserves the normalized requested provider name', () => {
    const result = resolveWorkItemConnector('AZURE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.provider).toBe('azure');
  });

  it('rejects unsupported providers with a friendly error', () => {
    for (const raw of ['github', 'notion', 'foo']) {
      const result = resolveWorkItemConnector(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Unsupported provider');
    }
  });

  it('rejects an empty/missing provider', () => {
    expect(resolveWorkItemConnector('').ok).toBe(false);
    expect(resolveWorkItemConnector(undefined).ok).toBe(false);
  });
});

describe('createDisabledWorkItemConnector', () => {
  it('is named disabled and reports not configured', () => {
    const connector = createDisabledWorkItemConnector();
    expect(connector.name).toBe('disabled');
    expect(connector.isConfigured()).toBe(false);
  });

  it('importWorkItem returns not_implemented without touching the network', async () => {
    const connector = createDisabledWorkItemConnector();
    const response = await connector.importWorkItem({ provider: 'azure', externalId: '253628' });

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('not_implemented');
    expect(response.error).toContain('not implemented');
    expect(response.payload).toBeUndefined();
  });
});
