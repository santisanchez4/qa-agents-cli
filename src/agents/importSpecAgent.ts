import fs from 'fs';
import { WorkItemProviderName } from '../core/connectors/workItemConnector';
import { resolveWorkItemConnector } from '../core/connectors/workItemConnectorResolver';

/**
 * Use-case orchestration for the `import-spec` command.
 *
 * Step 60 wires the generic work-item connector interface end-to-end without any
 * real provider logic: it validates args, resolves a connector, and reports the
 * result. Every provider currently resolves to the disabled connector, so the
 * agent reports "not implemented yet".
 *
 * Extension point for Step 61: when a real connector returns `response.ok` with a
 * `payload`, convert that WorkItemPayload into a standardized spec using the
 * existing Step 59 flow (`core/specTemplate.buildSpecMarkdown` +
 * `core/specFileWriter.writeSpecFile`, with `core/specNormalizer.normalizeId`)
 * and produce <target-repo>/.qa-agents/specs/TC-<id>.md. See the `response.ok`
 * branch below.
 */

export type ImportSpecOptions = {
  targetRepo: string;
  provider?: string;
  externalId?: string;
};

export type ImportSpecResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  provider?: WorkItemProviderName;
  externalId?: string;
  status?: string;
  message?: string;
  outputPath?: string;
};

function fail(errors: string[]): ImportSpecResult {
  return { ok: false, exitCode: 1, errors };
}

export async function runImportSpecAgent(options: ImportSpecOptions): Promise<ImportSpecResult> {
  const { targetRepo, provider, externalId } = options;

  // --- Required args --------------------------------------------------------
  if (!targetRepo) {
    return fail(['Missing target repo. Usage: import-spec <target-repo> --provider <provider> --id <external-id>']);
  }
  if (!provider) {
    return fail(['Missing --provider <provider>. Supported: azure, jira, trello, disabled.']);
  }
  if (!externalId) {
    return fail(['Missing --id <external-id>.']);
  }

  // --- Provider resolution --------------------------------------------------
  const resolution = resolveWorkItemConnector(provider);
  if (!resolution.ok) {
    return fail([resolution.error]);
  }

  // --- Target repo ----------------------------------------------------------
  if (!fs.existsSync(targetRepo) || !fs.statSync(targetRepo).isDirectory()) {
    return fail([`Target repo path does not exist: ${targetRepo}`]);
  }

  // --- Import via the connector interface -----------------------------------
  const response = await resolution.connector.importWorkItem({
    provider: resolution.provider,
    externalId,
  });

  if (response.ok && response.payload) {
    // Step 61 anchor: convert response.payload into a normalized spec and write
    // it via the Step 59 spec flow. Unreachable in Step 60 (always disabled).
    return {
      ok: true,
      exitCode: 0,
      errors: [],
      provider: resolution.provider,
      externalId,
      status: 'Imported.',
      message: 'Work item imported. (Spec generation is added in a later step.)',
    };
  }

  // Recognized provider, but the connector is disabled / not implemented yet.
  if (response.reason === 'not_implemented' || response.reason === 'not_configured') {
    return {
      ok: true,
      exitCode: 0,
      errors: [],
      provider: resolution.provider,
      externalId,
      status: 'Not implemented yet.',
      message: response.error ?? 'External work item import is not implemented for this provider yet.',
    };
  }

  // Future real-connector failures (not_found / invalid_response).
  return {
    ok: false,
    exitCode: 1,
    errors: [response.error ?? 'Work item import failed.'],
    provider: resolution.provider,
    externalId,
  };
}

export function buildImportSpecReport(result: ImportSpecResult): string[] {
  // Validation failures carry no provider/status -> the CLI prints errors only.
  if (!result.provider || result.status === undefined) return [];

  return [
    'QA Agents - Import Spec',
    '',
    'Provider:',
    result.provider,
    '',
    'External ID:',
    result.externalId ?? '',
    '',
    'Status:',
    result.status,
    '',
    'Message:',
    result.message ?? '',
    '',
    'Next step:',
    'Implement the provider adapter, then route its WorkItemPayload into the existing spec normalizer.',
  ];
}
