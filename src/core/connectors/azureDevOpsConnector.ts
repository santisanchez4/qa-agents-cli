import {
  WorkItemConnector,
  WorkItemImportRequest,
  WorkItemImportResponse,
  WorkItemPayload,
  WorkItemStep,
} from './workItemConnector';

/**
 * Azure DevOps work-item connector (read-only import).
 *
 * Fetches a single work item via the Azure DevOps REST API and maps it into the
 * generic WorkItemPayload. No writes/updates to Azure. Never prints PAT or other
 * secret values. Generic: org/project/PAT come only from env vars.
 *
 * Required env vars:
 *   AZURE_DEVOPS_ORG_URL   e.g. https://dev.azure.com/my-org
 *   AZURE_DEVOPS_PROJECT   e.g. my-project
 *   AZURE_DEVOPS_PAT       personal access token (secret)
 */

const AZURE_API_VERSION = '7.1';

export type AzureDevOpsConnectorDeps = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

type AzureConfig = { orgUrl: string; project: string; pat: string };

const NOT_CONFIGURED_MESSAGE =
  'Azure DevOps connector is not configured. Required env vars: AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_PAT.';

function readConfig(env: NodeJS.ProcessEnv): AzureConfig | null {
  const orgUrl = env['AZURE_DEVOPS_ORG_URL']?.trim();
  const project = env['AZURE_DEVOPS_PROJECT']?.trim();
  const pat = env['AZURE_DEVOPS_PAT']?.trim();
  if (!orgUrl || !project || !pat) return null;
  return { orgUrl, project, pat };
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&'); // decode &amp; last
}

// Converts an HTML fragment to plain text, turning block-ish tags into line
// breaks. Does not decode entities (callers decode first when needed).
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n');
  return withBreaks
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

function fieldText(value: unknown): string {
  return htmlToText(decodeEntities(asString(value)));
}

function fieldLines(value: unknown): string[] {
  const text = fieldText(value);
  return text ? text.split('\n').filter(line => line.length > 0) : [];
}

/**
 * Best-effort parser for Azure Test Case steps (Microsoft.VSTS.TCM.Steps).
 *
 * The field is XML-ish, with each <step> holding two entity-encoded HTML
 * <parameterizedString> cells (action, expected result). If the structure is
 * unrecognized, the whole content is returned as a single best-effort action.
 */
export function parseAzureSteps(raw: string): WorkItemStep[] {
  const steps: WorkItemStep[] = [];
  const stepBlocks = raw.match(/<step\b[^>]*>[\s\S]*?<\/step>/gi);

  if (!stepBlocks) {
    const text = fieldText(raw);
    return text ? [{ action: text }] : [];
  }

  for (const block of stepBlocks) {
    const cells = [...block.matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/gi)]
      .map(match => fieldText(match[1]));
    const action = cells[0] ?? '';
    const expectedResult = cells[1];
    if (action || expectedResult) {
      steps.push(expectedResult ? { action, expectedResult } : { action });
    }
  }
  return steps;
}

/**
 * Maps an Azure DevOps work-item JSON object into a generic WorkItemPayload.
 * Tolerant of missing/odd field shapes (never throws).
 */
export function mapAzureWorkItem(externalId: string, json: unknown): WorkItemPayload | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const fields = (obj.fields && typeof obj.fields === 'object')
    ? (obj.fields as Record<string, unknown>)
    : {};

  const resolvedId = asString(obj.id) || asString(fields['System.Id']) || externalId;

  const title = fieldText(fields['System.Title']).replace(/\n+/g, ' ').trim()
    || `Azure Work Item ${resolvedId}`;

  const description = fieldText(fields['System.Description']) || undefined;
  const acceptanceCriteria = fieldLines(fields['Microsoft.VSTS.Common.AcceptanceCriteria']);
  const stepsRaw = asString(fields['Microsoft.VSTS.TCM.Steps']);
  const steps = stepsRaw ? parseAzureSteps(stepsRaw) : [];

  const rawTextParts = [
    description,
    acceptanceCriteria.length > 0 ? acceptanceCriteria.join('\n') : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    provider: 'azure',
    externalId: resolvedId,
    title,
    description,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    steps: steps.length > 0 ? steps : undefined,
    rawText: rawTextParts.length > 0 ? rawTextParts.join('\n\n') : undefined,
    raw: json,
  };
}

function safeMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAzureDevOpsConnector(deps: AzureDevOpsConnectorDeps = {}): WorkItemConnector {
  const getEnv = (): NodeJS.ProcessEnv => deps.env ?? process.env;
  const getFetch = (): typeof fetch => deps.fetchImpl ?? globalThis.fetch;

  return {
    name: 'azure',

    isConfigured(): boolean {
      return readConfig(getEnv()) !== null;
    },

    async importWorkItem(request: WorkItemImportRequest): Promise<WorkItemImportResponse> {
      const config = readConfig(getEnv());
      if (!config) {
        return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED_MESSAGE };
      }

      // Redact the PAT from any dynamic error text, just in case.
      const redact = (text: string): string => (config.pat ? text.split(config.pat).join('***') : text);

      const base = config.orgUrl.replace(/\/+$/, '');
      const url =
        `${base}/${encodeURIComponent(config.project)}/_apis/wit/workitems/` +
        `${encodeURIComponent(request.externalId)}?api-version=${AZURE_API_VERSION}`;
      const auth = Buffer.from(`:${config.pat}`).toString('base64');

      let response: Awaited<ReturnType<typeof fetch>>;
      try {
        response = await getFetch()(url, {
          method: 'GET',
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        });
      } catch (err) {
        return { ok: false, reason: 'invalid_response', error: `Failed to reach Azure DevOps: ${redact(safeMessage(err))}` };
      }

      if (!response.ok) {
        if (response.status === 404) {
          return { ok: false, reason: 'not_found', error: `Azure DevOps work item not found: ${request.externalId}` };
        }
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            reason: 'not_configured',
            error: `Azure DevOps authorization failed (HTTP ${response.status}). Check AZURE_DEVOPS_PAT and permissions.`,
          };
        }
        return { ok: false, reason: 'invalid_response', error: `Azure DevOps returned HTTP ${response.status}.` };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { ok: false, reason: 'invalid_response', error: 'Azure DevOps returned a non-JSON response.' };
      }

      const payload = mapAzureWorkItem(request.externalId, json);
      if (!payload) {
        return { ok: false, reason: 'invalid_response', error: 'Azure DevOps response did not contain a recognizable work item.' };
      }

      return { ok: true, payload };
    },
  };
}
