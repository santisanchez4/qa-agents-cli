import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import { parseEnvFile, loadEnvOverlay, isVarSet } from '../core/envLoader';
import { ExecutionConfig, classifyTestScript, buildExecutionConfig } from '../core/executionConfig';
import {
  CLOUD_PROVIDER_ORDER,
  CLOUD_PROVIDER_LABEL,
  classifyCloudVar,
  collectCloudVars,
} from '../core/cloudVars';

/**
 * Use-case orchestration for the execution-configuration commands:
 * init-config, env-check, and discover-envs.
 *
 * core/executionConfig.ts and core/envLoader.ts hold the reusable, generic
 * helpers (config building, script classification, env parsing/overlay). This
 * agent wires them into each command flow. cli/ only parses args, calls the
 * matching run function, prints the report, and handles exit codes.
 */

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

// ---------------------------------------------------------------------------
// init-config
// ---------------------------------------------------------------------------

export type InitConfigOptions = {
  targetRepo: string;
};

export type InitConfigResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  configPath: string | null;
};

export function runInitConfigAgent(options: InitConfigOptions): InitConfigResult {
  const { targetRepo } = options;
  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  if (!profileRaw) {
    return { ok: false, exitCode: 1, errors: ['Missing project profile. Run analyze --save first.'], configPath: null };
  }

  const configPath = path.join(targetRepo, '.qa-agents', 'execution-config.json');

  if (fs.existsSync(configPath)) {
    return {
      ok: false,
      exitCode: 1,
      errors: [`execution-config.json already exists. Refusing to overwrite:\n${configPath}`],
      configPath: null,
    };
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const config = buildExecutionConfig(profile);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return { ok: true, exitCode: 0, errors: [], configPath };
}

export function buildInitConfigReport(result: InitConfigResult): string[] {
  if (!result.configPath) return [];
  return [`Execution config created:\n${result.configPath}`];
}

// ---------------------------------------------------------------------------
// env-check
// ---------------------------------------------------------------------------

export type EnvCheckOptions = {
  targetRepo: string;
  selectedEnv: string;
  selectedTarget: string;
  varsFileArg?: string;
};

export type EnvCheckResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  reportLines: string[];
};

export function runEnvCheckAgent(options: EnvCheckOptions): EnvCheckResult {
  const { targetRepo, selectedEnv, selectedTarget, varsFileArg } = options;

  const fail = (errors: string[]): EnvCheckResult =>
    ({ ok: false, exitCode: 1, errors, reportLines: [] });

  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const configPath = path.join(targetRepo, '.qa-agents', 'execution-config.json');

  const profileRaw = readFileIfExists(profilePath);
  const configRaw = readFileIfExists(configPath);

  if (!profileRaw) {
    return fail(['Missing project profile. Run analyze --save first.']);
  }

  if (!configRaw) {
    return fail(['Missing execution config. Run init-config first.']);
  }

  const profile: ProjectScanResult = JSON.parse(profileRaw);
  const config: ExecutionConfig = JSON.parse(configRaw);

  if (!config.environments[selectedEnv]) {
    return fail([[
      `Environment not found: ${selectedEnv}`,
      '',
      'Available environments:',
      ...Object.keys(config.environments).map(e => `- ${e}`),
    ].join('\n')]);
  }

  if (!config.targets[selectedTarget]) {
    return fail([[
      `Target not found: ${selectedTarget}`,
      '',
      'Available targets:',
      ...Object.keys(config.targets).map(t => `- ${t}`),
    ].join('\n')]);
  }

  // Load env overlay (process.env wins; first file value wins)
  const envLoadResult = loadEnvOverlay(targetRepo, selectedEnv, varsFileArg);
  if (envLoadResult.error) {
    return fail([envLoadResult.error]);
  }
  const envOverlay = envLoadResult.overlay;
  const loadedFiles = envLoadResult.loadedFiles;

  const envConfig = config.environments[selectedEnv];
  const targetConfig = config.targets[selectedTarget];
  const scriptName = targetConfig.script;
  const pkgManager = profile.packageManager ?? 'npm';
  const packageScripts = profile.packageScripts ?? {};

  const scriptExists = Boolean(scriptName) && scriptName in packageScripts;

  const requiredVars = [...new Set([
    ...(envConfig.requiredEnv ?? []),
    ...(targetConfig.requiredEnv ?? []),
  ])];

  const varStatuses = requiredVars.map(v => ({ name: v, set: isVarSet(v, envOverlay) }));
  const isReady = varStatuses.every(s => s.set) && scriptExists;

  const lines: string[] = [
    'QA Agents - Environment Check',
    '',
    'Target repo:',
    targetRepo,
    '',
    'Environment:',
    selectedEnv,
    '',
    'Execution target:',
    selectedTarget,
    '',
    'Target script:',
    scriptName ? `${pkgManager} run ${scriptName}` : '(none configured)',
  ];

  if (!scriptExists) {
    lines.push('', `Configured script not found in package.json: ${scriptName || '(empty)'}`);
  }

  if (loadedFiles.length > 0) {
    lines.push('', 'Loaded env files:');
    for (const f of loadedFiles) lines.push(`- ${f}`);
  } else {
    lines.push('', 'Loaded env files: (none)');
  }

  if (requiredVars.length > 0) {
    lines.push('', 'Required variables:');
    for (const { name, set } of varStatuses) {
      lines.push(`- ${name}: ${set ? 'SET' : 'MISSING'}`);
    }
  } else {
    lines.push('', 'Required variables: (none)');
  }

  lines.push('', 'Status:', isReady ? 'READY' : 'NOT READY');

  lines.push(
    '',
    'Recommended run command:',
    `npm run dev -- run ${targetRepo} --suite --env ${selectedEnv} --target ${selectedTarget}`,
  );

  return { ok: true, exitCode: isReady ? 0 : 1, errors: [], reportLines: lines };
}

export function buildEnvCheckReport(result: EnvCheckResult): string[] {
  return result.reportLines;
}

// ---------------------------------------------------------------------------
// discover-envs
// ---------------------------------------------------------------------------

const DISCOVER_ENV_KEYWORDS = [
  'local', 'dev', 'development', 'qa', 'uat', 'staging', 'production', 'prod',
];

// Ordered most-specific first so "production" matches before "prod"
const DISCOVER_URL_PATTERNS: Array<{ pattern: string; env: string }> = [
  { pattern: 'localhost',   env: 'local' },
  { pattern: 'staging',     env: 'staging' },
  { pattern: 'production',  env: 'production' },
  { pattern: 'uat',         env: 'uat' },
  { pattern: 'development', env: 'development' },
  { pattern: 'qa',          env: 'qa' },
  { pattern: 'dev',         env: 'dev' },
  { pattern: 'prod',        env: 'prod' },
];

function categorizeVar(key: string): string | null {
  const k = key.toUpperCase();
  if (/^E2E_ADMIN_(EMAIL|PASSWORD)$/.test(k)) return 'Admin credentials';
  if (/^E2E_(EMAIL|PASSWORD)\d*$/.test(k)) return 'User credentials';
  if (/URL|HOST|BASE|ENDPOINT|BACKEND/.test(k)) return 'App/URL';
  if (/API_KEY|TOKEN|SECRET/.test(k)) return 'Secrets/API keys';
  return null;
}

function buildDiscoverReport(targetPath: string, profile: ProjectScanResult | null): string {
  const lines: string[] = ['QA Agents - Environment Discovery', '', 'Target repo:', targetPath];

  // Collect env files from repo root
  let envFiles: string[] = [];
  try {
    envFiles = fs.readdirSync(targetPath)
      .filter(f => /^\.env($|\.)/.test(f))
      .filter(f => fs.statSync(path.join(targetPath, f)).isFile());
    envFiles.sort((a, b) => (a === '.env' ? -1 : b === '.env' ? 1 : a.localeCompare(b)));
  } catch { /* unreadable dir */ }

  lines.push('', 'Env files found:');
  if (envFiles.length > 0) {
    for (const f of envFiles) lines.push(`- ${f}`);
  } else {
    lines.push('(none)');
  }

  // Parse env files — track keys and values (values only used internally)
  const envEvidence = new Map<string, Set<string>>(); // env name -> deduplicated reasons
  const addEvidence = (env: string, reason: string) => {
    if (!envEvidence.has(env)) envEvidence.set(env, new Set());
    envEvidence.get(env)!.add(reason);
  };

  const allVarKeys = new Set<string>();
  const parsedFiles = new Map<string, Record<string, string>>();

  for (const fileName of envFiles) {
    try {
      const parsed = parseEnvFile(path.join(targetPath, fileName));
      parsedFiles.set(fileName, parsed);
      for (const key of Object.keys(parsed)) allVarKeys.add(key);
    } catch { /* skip unreadable */ }

    // Evidence from file name: .env.staging -> "staging"
    const m = fileName.match(/^\.env\.([a-zA-Z][a-zA-Z0-9]*)(?:\.local)?$/);
    if (m) addEvidence(m[1].toLowerCase(), `${fileName} file found`);
  }

  // Evidence from URL-like variable values (never print the value)
  const URL_LIKE_KEY = /URL|HOST|BASE|ENDPOINT|BACKEND/i;
  for (const [, parsed] of parsedFiles) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!URL_LIKE_KEY.test(key)) continue;
      const v = value.toLowerCase();
      for (const { pattern, env } of DISCOVER_URL_PATTERNS) {
        if (v.includes(pattern)) {
          const reason = pattern === 'localhost'
            ? `${key} points to localhost`
            : `${key} value contains "${pattern}"`;
          addEvidence(env, reason);
          break; // first matching pattern wins per variable
        }
      }
    }
  }

  // Evidence from variable name segments (split on _)
  for (const key of allVarKeys) {
    const segments = key.toLowerCase().split('_');
    for (const kw of DISCOVER_ENV_KEYWORDS) {
      if (segments.includes(kw)) {
        addEvidence(kw, `Variable ${key} suggests ${kw}`);
        break;
      }
    }
  }

  // Evidence from package script names (split on : - _)
  const packageScripts = profile?.packageScripts ?? {};
  for (const name of Object.keys(packageScripts)) {
    const segments = name.toLowerCase().split(/[:_-]/);
    for (const kw of DISCOVER_ENV_KEYWORDS) {
      if (segments.includes(kw)) {
        addEvidence(kw, `Script '${name}' detected`);
        break;
      }
    }
  }

  // Print possible environments
  lines.push('', 'Possible environments:');
  if (envEvidence.size > 0) {
    for (const [env, reasons] of envEvidence) {
      lines.push(`- ${env}`, '  Evidence:');
      for (const reason of reasons) lines.push(`  - ${reason}`);
    }
  } else {
    lines.push('(none detected)');
  }

  // Variable groups (cloud-execution vars are reported in their own section).
  const varGroups: Record<string, string[]> = {};
  for (const key of allVarKeys) {
    if (classifyCloudVar(key)) continue;
    const cat = categorizeVar(key);
    if (cat) (varGroups[cat] ??= []).push(key);
  }

  const GROUP_ORDER = ['App/URL', 'User credentials', 'Admin credentials', 'Secrets/API keys'];
  lines.push('', 'Variable groups:');
  let firstGroup = true;
  for (const group of GROUP_ORDER) {
    const vars = varGroups[group];
    if (!vars?.length) continue;
    if (!firstGroup) lines.push('');
    firstGroup = false;
    lines.push(`${group}:`);
    for (const v of vars) lines.push(`- ${v}`);
  }
  if (firstGroup) lines.push('(no recognizable variable patterns found)');

  // Cloud execution variables (names only), grouped by provider. Only shown
  // when at least one cloud variable is actually found in the repo.
  const cloudVars = collectCloudVars(targetPath);
  const hasCloud = CLOUD_PROVIDER_ORDER.some(p => (cloudVars.get(p)?.size ?? 0) > 0);
  if (hasCloud) {
    lines.push('', 'Cloud execution:');
    let firstProvider = true;
    for (const provider of CLOUD_PROVIDER_ORDER) {
      const names = cloudVars.get(provider);
      if (!names || names.size === 0) continue;
      if (!firstProvider) lines.push('');
      firstProvider = false;
      lines.push(`${CLOUD_PROVIDER_LABEL[provider]}:`);
      for (const name of [...names].sort()) lines.push(`- ${name}`);
    }
  }

  // Execution targets from package scripts
  const EXEC_MODE_ORDER = ['local', 'headed', 'ui', 'cloud', 'debug', 'report'];
  const execModes = new Map<string, string>(); // mode -> first script name found
  for (const [name, value] of Object.entries(packageScripts)) {
    const mode = classifyTestScript(value);
    if (mode && !execModes.has(mode)) execModes.set(mode, name);
  }

  lines.push('', 'Execution targets:');
  if (execModes.size > 0) {
    for (const mode of EXEC_MODE_ORDER) {
      const scriptName = execModes.get(mode);
      if (scriptName) lines.push(`- ${mode}: ${scriptName}`);
    }
  } else {
    lines.push('(none detected)');
  }

  lines.push(
    '',
    'Recommended next step:',
    'Review .qa-agents/execution-config.json and add/update environments based on this discovery.',
  );

  return lines.join('\n');
}

export type DiscoverEnvsOptions = {
  targetRepo: string;
};

export type DiscoverEnvsResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  profileMissing: boolean;
  report: string;
};

export function runDiscoverEnvsAgent(options: DiscoverEnvsOptions): DiscoverEnvsResult {
  const { targetRepo } = options;
  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const profileRaw = readFileIfExists(profilePath);

  const profile: ProjectScanResult | null = profileRaw ? JSON.parse(profileRaw) : null;
  const report = buildDiscoverReport(targetRepo, profile);

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    profileMissing: profileRaw === null,
    report,
  };
}

export function buildDiscoverEnvsReport(result: DiscoverEnvsResult): string[] {
  const lines: string[] = [];
  if (result.profileMissing) {
    lines.push('Project profile not found. Run analyze --save for better results.');
  }
  lines.push('', result.report);
  return lines;
}
