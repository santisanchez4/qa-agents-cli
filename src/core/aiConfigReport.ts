type ProviderSpec = {
  apiKeyVar: string;
  modelVar: string;
  defaultModel: string;
};

const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  openai:    { apiKeyVar: 'OPENAI_API_KEY',    modelVar: 'QA_AGENTS_OPENAI_MODEL',    defaultModel: 'gpt-4.1-mini' },
  anthropic: { apiKeyVar: 'ANTHROPIC_API_KEY', modelVar: 'QA_AGENTS_ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-4-5' },
  gemini:    { apiKeyVar: 'GEMINI_API_KEY',     modelVar: 'QA_AGENTS_GEMINI_MODEL',    defaultModel: 'gemini-2.5-flash' },
  deepseek:  { apiKeyVar: 'DEEPSEEK_API_KEY',  modelVar: 'QA_AGENTS_DEEPSEEK_MODEL',  defaultModel: 'deepseek-v4-flash' },
};

const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_SPECS).join(', ');

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildAiConfigReport(): string[] {
  const requestedRaw  = process.env['QA_AGENTS_AI_PROVIDER'];
  const providerInput = requestedRaw?.trim().toLowerCase() ?? '';
  const tlsEnv        = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];

  const providerRequested = isSet(requestedRaw);
  const providerKnown     = providerRequested && providerInput in PROVIDER_SPECS;
  const spec              = providerKnown ? PROVIDER_SPECS[providerInput] : null;
  const apiKeyValue       = spec ? process.env[spec.apiKeyVar] : undefined;
  const apiKeyPresent     = isSet(apiKeyValue);
  const fullyConfigured   = providerKnown && apiKeyPresent;

  const resolvedProvider = fullyConfigured ? providerInput : 'disabled';
  const resolvedModel    = fullyConfigured
    ? (process.env[spec!.modelVar] || spec!.defaultModel)
    : 'N/A';

  const apiKeyDisplay = !providerRequested
    ? 'MISSING'
    : !providerKnown
    ? 'N/A'
    : apiKeyPresent ? 'SET' : 'MISSING';

  const lines: string[] = ['QA Agents - AI Config', ''];

  // ─── Provider ───────────────────────────────────────────────────────────────
  lines.push(
    'Provider:',
    `- Requested: ${providerRequested ? requestedRaw : 'N/A'}`,
    `- Resolved: ${resolvedProvider}`,
    `- Status: ${fullyConfigured ? 'configured' : 'not configured'}`,
    `- Model: ${resolvedModel}`,
    `- API key: ${apiKeyDisplay}`,
  );

  if (providerRequested && !providerKnown) {
    lines.push(
      '',
      `Unsupported provider: ${requestedRaw}`,
      `Supported providers: ${SUPPORTED_PROVIDERS}`,
    );
  }

  // ─── Required env vars ───────────────────────────────────────────────────────
  lines.push('', 'Required env vars:');
  lines.push(`- QA_AGENTS_AI_PROVIDER: ${providerRequested ? 'SET' : 'MISSING'}`);
  if (spec) {
    lines.push(`- ${spec.apiKeyVar}: ${apiKeyPresent ? 'SET' : 'MISSING'}`);
  }

  // ─── Security checks ─────────────────────────────────────────────────────────
  lines.push('', 'Security checks:');
  if (tlsEnv === '0') {
    lines.push('- NODE_TLS_REJECT_UNAUTHORIZED: WARNING: set to 0, TLS certificate verification is disabled.');
  } else {
    lines.push('- NODE_TLS_REJECT_UNAUTHORIZED: OK');
  }

  // ─── Notes ────────────────────────────────────────────────────────────────────
  lines.push(
    '',
    'Notes:',
    '- ai-review uses AI only when --ai is passed.',
    '- If provider is disabled, deterministic review still works.',
  );

  return lines;
}
