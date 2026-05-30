import fs from 'fs';
import path from 'path';
import { scanProject, ProjectScanResult } from '../core/projectScanner';

/**
 * Use-case orchestration for the `analyze` command.
 *
 * core/projectScanner.ts holds the reusable, generic repo detection
 * (language, frameworks, package manager, scripts, important files, structure).
 * This agent runs the scan and, with --save, persists the project profile.
 * cli/ only parses the path and --save, calls this agent, and prints the report.
 */

export type RepoAnalystOptions = {
  targetRepo: string;
  save: boolean;
};

export type RepoAnalystResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  profile: ProjectScanResult;
  savedPath: string | null;
};

export function runRepoAnalyst(options: RepoAnalystOptions): RepoAnalystResult {
  const { targetRepo, save } = options;
  const profile = scanProject(targetRepo);

  let savedPath: string | null = null;
  if (save) {
    const qaDir = path.join(targetRepo, '.qa-agents');
    if (!fs.existsSync(qaDir)) {
      fs.mkdirSync(qaDir);
    }
    savedPath = path.join(qaDir, 'project-profile.json');
    fs.writeFileSync(savedPath, JSON.stringify(profile, null, 2), 'utf-8');
  }

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    profile,
    savedPath,
  };
}

/**
 * Formats the structured analysis result into stdout report lines.
 */
export function buildRepoAnalystReport(result: RepoAnalystResult): string[] {
  const lines: string[] = [
    '',
    'QA Agents - Repo Analysis',
    '',
    JSON.stringify(result.profile, null, 2),
  ];

  if (result.savedPath) {
    lines.push('', 'Project profile saved at:', result.savedPath);
  }

  return lines;
}
