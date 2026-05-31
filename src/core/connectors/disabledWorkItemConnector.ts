import { WorkItemConnector, WorkItemImportResponse } from './workItemConnector';

/**
 * The safe default connector: configured = false, and importWorkItem always
 * reports "not implemented" without touching the network or any external API.
 * Used for every provider in Step 60 until real adapters are added.
 */
export function createDisabledWorkItemConnector(): WorkItemConnector {
  return {
    name: 'disabled',
    isConfigured(): boolean {
      return false;
    },
    async importWorkItem(): Promise<WorkItemImportResponse> {
      return {
        ok: false,
        reason: 'not_implemented',
        error: 'External work item import is not implemented for this provider yet.',
      };
    },
  };
}
