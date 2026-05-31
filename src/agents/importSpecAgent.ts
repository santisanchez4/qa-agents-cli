import fs from 'fs';
import { WorkItemPayload, WorkItemProviderName } from '../core/connectors/workItemConnector';
import { resolveWorkItemConnector } from '../core/connectors/workItemConnectorResolver';
import { normalizeId } from '../core/specNormalizer';
import { buildSpecMarkdown } from '../core/specTemplate';
import { writeSpecFile } from '../core/specFileWriter';

/**
 * Use-case orchestration for the `import-spec` command.
 *
 * Resolves a generic work-item connector and, when a real provider (Step 61:
 * azure) returns a payload, routes it into the existing Step 59 spec flow
 * (specTemplate.buildSpecMarkdown + specFileWriter.writeSpecFile, with
 * specNormalizer.normalizeId) to produce <target-repo>/.qa-agents/specs/TC-<id>.md.
 *
 * No provider HTTP/credentials logic lives here — that is inside each connector.
 * Read-only with respect to the provider; never prints secrets.
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
  title?: string;
  normalizedId?: string;
  outputPath?: string;
  targetRepo?: string;
};

function fail(errors: string[]): ImportSpecResult {
  return { ok: false, exitCode: 1, errors };
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// Converts a generic WorkItemPayload into normalized spec markdown using the
// existing Step 59 template (no normalizer duplication).
function buildSpecFromPayload(payload: WorkItemPayload, normalizedId: string): string {
  const stepStrings = (payload.steps ?? [])
    .map(step => step.action)
    .filter(action => action.length > 0);

  const expectedFromSteps = (payload.steps ?? [])
    .map(step => step.expectedResult)
    .filter((result): result is string => Boolean(result && result.length > 0));
  const expectedResults = [...expectedFromSteps, ...(payload.acceptanceCriteria ?? [])];

  const baseText = payload.description ?? payload.rawText ?? '';
  const summary = firstNonEmptyLine(baseText) ?? 'TBD';

  return buildSpecMarkdown({
    id: normalizedId,
    title: payload.title,
    source: payload.provider,
    sourceFile: `work-item/${payload.externalId}`,
    normalizedAt: new Date().toISOString(),
    summary,
    steps: stepStrings,
    expectedResults,
    rawInput: payload.rawText ?? payload.description ?? '(no raw text captured)',
  });
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
    const payload = response.payload;
    const normalizedId = normalizeId(payload.externalId) ?? `TC-${payload.externalId}`;
    const markdown = buildSpecFromPayload(payload, normalizedId);

    const write = writeSpecFile(targetRepo, `${normalizedId}.md`, markdown);
    if (write.alreadyExists) {
      return fail([`Normalized spec already exists. Refusing to overwrite:\n${write.outputPath}`]);
    }

    return {
      ok: true,
      exitCode: 0,
      errors: [],
      provider: resolution.provider,
      externalId: payload.externalId,
      title: payload.title,
      normalizedId,
      outputPath: write.outputPath,
      targetRepo,
      status: 'Normalized spec created.',
    };
  }

  // Recognized provider whose adapter is not implemented yet (e.g. jira/trello).
  if (response.reason === 'not_implemented') {
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

  // Real-connector failures (not_configured / not_found / invalid_response).
  return fail([response.error ?? 'Work item import failed.']);
}

export function buildImportSpecReport(result: ImportSpecResult): string[] {
  // Success: a spec file was created.
  if (result.outputPath && result.normalizedId) {
    return [
      'QA Agents - Import Spec',
      '',
      'Provider:',
      result.provider ?? '',
      '',
      'External ID:',
      result.externalId ?? '',
      '',
      'Normalized spec created:',
      result.outputPath,
      '',
      'Title:',
      result.title ?? '',
      '',
      'Next step:',
      `npm run dev -- generate ${result.targetRepo ?? ''} --spec .qa-agents/specs/${result.normalizedId}.md --dry-run`,
    ];
  }

  // Informative status (e.g. not implemented yet).
  if (result.provider && result.status !== undefined) {
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

  // Validation/connector failure -> the CLI prints errors only.
  return [];
}
