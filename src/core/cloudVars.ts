import fs from 'fs';
import path from 'path';
import { parseEnvFile } from './envLoader';

/**
 * Cloud-execution variable detection.
 *
 * Detects real cloud-grid credential variable NAMES from a target repo, grouped
 * by provider. It never reads or prints values, and never invents names — it
 * only classifies names actually found in env files, package.json scripts,
 * playwright.config.*, or .qa-agents/execution-config.json.
 *
 * Shared by discover-envs (executionConfigAgent) and doctor (doctorAgent).
 */

export type CloudProvider = 'LambdaTest' | 'BrowserStack' | 'Unknown';

export const CLOUD_PROVIDER_ORDER: CloudProvider[] = ['LambdaTest', 'BrowserStack', 'Unknown'];

export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = {
  LambdaTest: 'LambdaTest',
  BrowserStack: 'BrowserStack',
  Unknown: 'Unknown cloud-related',
};

export function classifyCloudVar(key: string): CloudProvider | null {
  const k = key.toUpperCase();
  if (/^(LT_|LAMBDATEST)/.test(k)) return 'LambdaTest';
  if (/BROWSERSTACK/.test(k)) return 'BrowserStack';
  // Generic cloud-grid signals (word-bounded to avoid matching e.g. GITHUB).
  if (/(^|_)(SAUCE|SAUCELABS|SELENIUM|GRID|HUB)(_|$)/.test(k)) return 'Unknown';
  return null;
}

// Extracts referenced env-variable NAMES (never values) from a text blob such
// as a package.json script command or a playwright.config file.
export function extractEnvVarNames(text: string): string[] {
  const names = new Set<string>();
  const patterns: RegExp[] = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
    /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, // $NAME or ${NAME}
    /%([A-Za-z_][A-Za-z0-9_]*)%/g,       // %NAME%
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1]);
  }
  return [...names];
}

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

// Reads variable NAMES (keys only) from all .env* files in the repo root.
function readEnvVarKeys(targetPath: string): string[] {
  const keys = new Set<string>();
  try {
    const files = fs.readdirSync(targetPath)
      .filter(f => /^\.env($|\.)/.test(f))
      .filter(f => {
        try { return fs.statSync(path.join(targetPath, f)).isFile(); } catch { return false; }
      });
    for (const f of files) {
      try {
        const parsed = parseEnvFile(path.join(targetPath, f));
        for (const k of Object.keys(parsed)) keys.add(k);
      } catch { /* skip unreadable */ }
    }
  } catch { /* unreadable dir */ }
  return [...keys];
}

/**
 * Collects cloud-execution variable names from all repo sources, grouped by
 * provider. Reads only names; values are never inspected or stored.
 *
 * Sources: .env* keys, package.json scripts (env-var references),
 * playwright.config.* (env-var references), and execution-config.json
 * requiredEnv (environments + targets).
 */
export function collectCloudVars(targetPath: string): Map<CloudProvider, Set<string>> {
  const result = new Map<CloudProvider, Set<string>>();
  const add = (name: string): void => {
    const provider = classifyCloudVar(name);
    if (!provider) return;
    if (!result.has(provider)) result.set(provider, new Set());
    result.get(provider)!.add(name);
  };

  // 1. .env* keys.
  for (const key of readEnvVarKeys(targetPath)) add(key);

  // 2. package.json scripts that reference env vars.
  try {
    const pkgRaw = readFileIfExists(path.join(targetPath, 'package.json'));
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, unknown> };
      for (const cmd of Object.values(pkg.scripts ?? {})) {
        if (typeof cmd === 'string') for (const n of extractEnvVarNames(cmd)) add(n);
      }
    }
  } catch { /* ignore unreadable/invalid package.json */ }

  // 3. playwright.config.* that references env vars.
  try {
    for (const file of fs.readdirSync(targetPath)) {
      if (!/^playwright\.config\.(ts|js|mjs|cjs)$/.test(file)) continue;
      const text = readFileIfExists(path.join(targetPath, file));
      if (text) for (const n of extractEnvVarNames(text)) add(n);
    }
  } catch { /* ignore unreadable dir */ }

  // 4. execution-config.json requiredEnv (environments + targets).
  try {
    const cfgRaw = readFileIfExists(path.join(targetPath, '.qa-agents', 'execution-config.json'));
    if (cfgRaw) {
      const cfg = JSON.parse(cfgRaw) as {
        environments?: Record<string, { requiredEnv?: unknown }>;
        targets?: Record<string, { requiredEnv?: unknown }>;
      };
      const collectReq = (group: Record<string, { requiredEnv?: unknown }> | undefined): void => {
        for (const entry of Object.values(group ?? {})) {
          if (Array.isArray(entry.requiredEnv)) {
            for (const n of entry.requiredEnv) if (typeof n === 'string') add(n);
          }
        }
      };
      collectReq(cfg.environments);
      collectReq(cfg.targets);
    }
  } catch { /* ignore unreadable/invalid execution-config.json */ }

  return result;
}
