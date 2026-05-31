/**
 * Generic work-item connector interface.
 *
 * Architecture only (Step 60): defines the provider-agnostic shape for importing
 * external work items (Azure DevOps, Jira, Trello, …). No real network/API logic
 * lives here. A future step plugs a real adapter behind this interface and routes
 * its WorkItemPayload into the existing Step 59 spec normalizer/writer flow.
 */

export type WorkItemProviderName =
  | 'azure'
  | 'jira'
  | 'trello'
  | 'disabled';

export type WorkItemStep = {
  action: string;
  expectedResult?: string;
};

export type WorkItemPayload = {
  provider: WorkItemProviderName;
  externalId: string;
  title: string;
  description?: string;
  preconditions?: string[];
  steps?: WorkItemStep[];
  acceptanceCriteria?: string[];
  rawText?: string;
  raw?: unknown;
};

export type WorkItemImportRequest = {
  provider: WorkItemProviderName;
  externalId: string;
};

export type WorkItemImportReason =
  | 'not_configured'
  | 'not_implemented'
  | 'not_found'
  | 'invalid_response';

export type WorkItemImportResponse = {
  ok: boolean;
  payload?: WorkItemPayload;
  error?: string;
  reason?: WorkItemImportReason;
};

export interface WorkItemConnector {
  name: WorkItemProviderName;
  isConfigured(): boolean;
  importWorkItem(request: WorkItemImportRequest): Promise<WorkItemImportResponse>;
}
