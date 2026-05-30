import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';

/**
 * Use-case orchestration for the `capabilities` command.
 *
 * Read-only: detects what automation/QA capabilities a target repo already
 * supports (package.json scripts, execution-config targets) plus the qa-agents
 * native capabilities, so future agents can orchestrate existing scripts instead
 * of duplicating them. It never executes scripts, modifies files, prints
 * secrets, or calls AI providers.
 */

export type CapabilitiesAgentOptions = {
  targetRepo: string;
};

export type CapabilityGroup = {
  title: string;
  items: string[];
};

export type CapabilitiesAgentResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  targetRepo: string;
  packageJsonFound: boolean;
  warnings: string[];
  repoGroups: CapabilityGroup[];
  qaAgentsCapabilities: string[];
  strategy: string[];
};

const QA_AGENTS_CAPABILITIES = [
  'analyze', 'inspect', 'doctor', 'generate', 'ai-review', 'run',
  'report', 'reviews', 'env-check', 'discover-envs', 'init-config', 'init-rules',
];

type RepoGroupKey = 'execution' | 'generation' | 'ai' | 'data' | 'reports' | 'cloud';

// Display order (only non-empty groups are shown).
const GROUP_DISPLAY: { key: RepoGroupKey; title: string }[] = [
  { key: 'execution',  title: 'Test execution' },
  { key: 'generation', title: 'Test generation' },
  { key: 'ai',         title: 'AI / automation' },
  { key: 'data',       title: 'Test data / seed' },
  { key: 'reports',    title: 'Reports' },
  { key: 'cloud',      title: 'Cloud/grid execution' },
];

const CLOUD_TOKENS = ['lambda', 'lambdatest', 'browserstack', 'cloud', 'remote'];

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

// Matches a token as a whole `:`/`-`/`_`-delimited segment of a script name.
function seg(name: string, token: string): boolean {
  return new RegExp(`(^|[:_-])${token}([:_-]|$)`).test(name);
}

// Classifies a package.json script name into a single capability group
// (priority order — first match wins).
function classifyScript(name: string): RepoGroupKey | null {
  const n = name.toLowerCase();
  if (seg(n, 'tc') || n.includes('generate')) return 'generation';
  if (seg(n, 'ai') || n.includes('agent') || n.includes('codex') || n.includes('claude') || n.includes('gpt')) return 'ai';
  if (CLOUD_TOKENS.some(t => n.includes(t))) return 'cloud';
  if (seg(n, 'seed') || seg(n, 'data') || seg(n, 'setup')) return 'data';
  if (n.includes('allure') || n.includes('report')) return 'reports';
  if (n === 'test' || n.startsWith('test:') || n.includes('e2e') || seg(n, 'smoke') || seg(n, 'regression')) return 'execution';
  return null;
}

function isCloudTargetName(name: string): boolean {
  const n = name.toLowerCase();
  return CLOUD_TOKENS.some(t => n.includes(t));
}

export function runCapabilitiesAgent(options: CapabilitiesAgentOptions): CapabilitiesAgentResult {
  const { targetRepo } = options;
  const warnings: string[] = [];

  // --- package.json scripts (fall back to project-profile.json) -------------
  const scripts: Record<string, string> = {};
  const pkgRaw = readFileIfExists(path.join(targetRepo, 'package.json'));
  const packageJsonFound = pkgRaw !== null;

  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, unknown> };
      for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
        if (typeof cmd === 'string') scripts[name] = cmd;
      }
    } catch {
      warnings.push('package.json was found but could not be parsed.');
    }
  } else {
    const profileRaw = readFileIfExists(path.join(targetRepo, '.qa-agents', 'project-profile.json'));
    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw) as ProjectScanResult;
        for (const [name, cmd] of Object.entries(profile.packageScripts ?? {})) {
          if (typeof cmd === 'string') scripts[name] = cmd;
        }
      } catch { /* ignore invalid profile */ }
    }
    warnings.push('No package.json found in the target repo. Reporting QA Agents native capabilities (and any execution-config targets).');
  }

  // --- Classify scripts into capability buckets -----------------------------
  const buckets: Record<RepoGroupKey, string[]> = {
    execution: [], generation: [], ai: [], data: [], reports: [], cloud: [],
  };
  for (const name of Object.keys(scripts)) {
    const key = classifyScript(name);
    if (key) buckets[key].push(`npm run ${name}`);
  }

  // --- Cloud targets from execution-config.json -----------------------------
  const cfgRaw = readFileIfExists(path.join(targetRepo, '.qa-agents', 'execution-config.json'));
  if (cfgRaw) {
    try {
      const cfg = JSON.parse(cfgRaw) as { targets?: Record<string, unknown> };
      for (const targetName of Object.keys(cfg.targets ?? {})) {
        if (isCloudTargetName(targetName)) buckets.cloud.push(`target: ${targetName}`);
      }
    } catch { /* ignore invalid config */ }
  }

  // Dedupe + sort each bucket for deterministic output.
  for (const key of Object.keys(buckets) as RepoGroupKey[]) {
    buckets[key] = [...new Set(buckets[key])].sort();
  }

  const repoGroups: CapabilityGroup[] = GROUP_DISPLAY
    .filter(g => buckets[g.key].length > 0)
    .map(g => ({ title: g.title, items: buckets[g.key] }));

  // --- Recommended strategy -------------------------------------------------
  const strategy: string[] = [];
  if (buckets.generation.length > 0) {
    strategy.push('Existing generation scripts detected. Prefer orchestrating them before generating duplicate logic.');
  }
  strategy.push('Use qa-agents generate when no repo-native generator exists or when explicitly requested.');

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    targetRepo,
    packageJsonFound,
    warnings,
    repoGroups,
    qaAgentsCapabilities: QA_AGENTS_CAPABILITIES,
    strategy,
  };
}

export function buildCapabilitiesReport(result: CapabilitiesAgentResult): string[] {
  const lines: string[] = [
    'QA Agents - Capabilities',
    '',
    'Target repo:',
    result.targetRepo,
    '',
  ];

  for (const warning of result.warnings) lines.push(warning);
  if (result.warnings.length > 0) lines.push('');

  lines.push('Existing repo capabilities:');
  if (result.repoGroups.length === 0) {
    lines.push('(none detected)');
  } else {
    for (const group of result.repoGroups) {
      lines.push('', `${group.title}:`);
      for (const item of group.items) lines.push(`- ${item}`);
    }
  }

  lines.push('', 'QA Agents capabilities:');
  for (const capability of result.qaAgentsCapabilities) lines.push(`- ${capability}`);

  lines.push('', 'Recommended strategy:');
  for (const line of result.strategy) lines.push(`- ${line}`);

  return lines;
}
