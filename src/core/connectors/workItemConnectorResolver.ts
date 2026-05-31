import { WorkItemConnector, WorkItemProviderName } from './workItemConnector';
import { createDisabledWorkItemConnector } from './disabledWorkItemConnector';

/**
 * Resolves a provider name (case-insensitive) to a connector.
 *
 * Step 60: every supported provider resolves to the disabled connector, but the
 * requested provider name is preserved so the report can show it. A future step
 * returns a real adapter for a configured provider (falling back to disabled).
 * No env vars are read and no secrets are touched here.
 */

export const SUPPORTED_PROVIDERS: WorkItemProviderName[] = ['azure', 'jira', 'trello', 'disabled'];

export type WorkItemConnectorResolution =
  | { ok: true; provider: WorkItemProviderName; connector: WorkItemConnector }
  | { ok: false; error: string };

export function resolveWorkItemConnector(rawProvider: string | undefined): WorkItemConnectorResolution {
  const normalized = (rawProvider ?? '').trim().toLowerCase();

  if (!normalized) {
    return { ok: false, error: 'Missing provider.' };
  }

  if (!(SUPPORTED_PROVIDERS as string[]).includes(normalized)) {
    return {
      ok: false,
      error: `Unsupported provider: ${rawProvider}. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    };
  }

  // Step 60: all providers resolve to the disabled connector. The resolved
  // provider name is preserved for reporting.
  return {
    ok: true,
    provider: normalized as WorkItemProviderName,
    connector: createDisabledWorkItemConnector(),
  };
}
