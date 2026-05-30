import fs from 'fs';
import path from 'path';
import { buildRepoRulesTemplate } from '../core/repoRulesTemplate';

/**
 * Use-case orchestration for the `init-rules` command.
 *
 * core/repoRulesTemplate.ts holds the reusable, generic template. This agent
 * ensures .qa-agents exists and writes repo-rules.md only when it does not
 * already exist (never overwrites). cli/ only parses the path, calls this
 * agent, and prints the report.
 */

export type RepoRulesOptions = {
  targetRepo: string;
};

export type RepoRulesResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  rulesPath: string;
  created: boolean;
};

export function runRepoRulesAgent(options: RepoRulesOptions): RepoRulesResult {
  const { targetRepo } = options;
  const qaDir = path.join(targetRepo, '.qa-agents');
  if (!fs.existsSync(qaDir)) {
    fs.mkdirSync(qaDir, { recursive: true });
  }

  const rulesPath = path.join(qaDir, 'repo-rules.md');

  let created: boolean;
  if (fs.existsSync(rulesPath)) {
    created = false;
  } else {
    fs.writeFileSync(rulesPath, buildRepoRulesTemplate(), 'utf-8');
    created = true;
  }

  return { ok: true, exitCode: 0, errors: [], rulesPath, created };
}

export function buildRepoRulesReport(result: RepoRulesResult): string[] {
  const label = result.created ? 'Created repo rules file:' : 'Repo rules file already exists:';
  return [`${label}\n${result.rulesPath}`];
}
