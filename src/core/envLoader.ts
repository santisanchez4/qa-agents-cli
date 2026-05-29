import fs from 'fs';
import path from 'path';

export type EnvLoadResult = {
  overlay: Record<string, string>;
  loadedFiles: string[];
  error: string | null;
};

export function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadEnvOverlay(
  targetPath: string,
  selectedEnv: string,
  varsFileArg: string | undefined
): EnvLoadResult {
  let candidateFiles: string[];

  if (varsFileArg) {
    const abs = path.isAbsolute(varsFileArg)
      ? varsFileArg
      : path.join(targetPath, varsFileArg);
    if (!fs.existsSync(abs)) {
      return { overlay: {}, loadedFiles: [], error: `Env file not found:\n${abs}` };
    }
    candidateFiles = [abs];
  } else {
    const names = [
      `.env.${selectedEnv}`,
      `.env.${selectedEnv}.local`,
      `.env.local`,
      `.env`,
    ];
    const seen = new Set<string>();
    candidateFiles = names
      .filter(n => { if (seen.has(n)) return false; seen.add(n); return true; })
      .map(n => path.join(targetPath, n))
      .filter(p => fs.existsSync(p));
  }

  const overlay: Record<string, string> = {};
  const loadedFiles: string[] = [];

  for (const filePath of candidateFiles) {
    const parsed = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env) && !(key in overlay)) {
        overlay[key] = value;
      }
    }
    loadedFiles.push(path.relative(targetPath, filePath).replace(/\\/g, '/'));
  }

  return { overlay, loadedFiles, error: null };
}

export function isVarSet(name: string, envOverlay: Record<string, string>): boolean {
  return (name in process.env && Boolean(process.env[name])) ||
    (name in envOverlay && Boolean(envOverlay[name]));
}
