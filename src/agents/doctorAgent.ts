import fs from 'fs';
import path from 'path';
import { ProjectScanResult } from '../core/projectScanner';
import { readLatestRunResultSafe } from '../core/runResults';
import { buildAiConfigReport } from '../core/aiConfigReport';
import { CLOUD_PROVIDER_ORDER, CLOUD_PROVIDER_LABEL, collectCloudVars } from '../core/cloudVars';

/**
 * Use-case orchestration for the `doctor` command.
 *
 * Diagnostics only: checks whether a target repo is ready to use with
 * qa-agents-cli. It never modifies files, runs Playwright, or calls AI
 * providers, and it never prints secrets (AI status is derived from the
 * read-only aiConfigReport, which already redacts keys).
 */

export type CheckStatus = 'OK' | 'WARN' | 'FAIL';
export type DoctorOverall = 'READY' | 'PARTIAL' | 'NOT READY';
export type FindingSeverity = 'Info' | 'Warning' | 'Error';
export type AiStatus = 'configured' | 'not configured' | 'disabled';

export type DoctorCheck = {
  label: string;
  status: CheckStatus;
  note?: string;
};

export type DoctorFinding = {
  message: string;
  severity: FindingSeverity;
  recommendation: string;
};

export type DoctorAgentOptions = {
  targetRepo: string;
};

export type DoctorCloudInfo = {
  hasCloudVars: boolean;
  byProvider: { label: string; names: string[] }[];
  allNames: string[];
  targetConfigured: boolean;
};

export type DoctorAgentResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  targetRepo: string;
  overall: DoctorOverall;
  checks: DoctorCheck[];
  findings: DoctorFinding[];
  aiStatus: AiStatus;
  specFiles: number | null;
  cloud: DoctorCloudInfo;
};

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

// Target names that indicate a cloud/remote execution target.
const CLOUD_TARGET_NAMES = ['lambda', 'lambdatest', 'cloud', 'browserstack', 'bs', 'remote'];

function isCloudTargetName(name: string): boolean {
  const n = name.toLowerCase();
  if (CLOUD_TARGET_NAMES.includes(n)) return true;
  // Also match descriptive names containing an unambiguous cloud token.
  return ['lambda', 'browserstack', 'cloud', 'remote'].some(tok => n.includes(tok));
}

/**
 * Detects cloud-execution variables in the repo (names only) and whether the
 * execution-config defines a likely cloud target. Reads only names — never
 * variable values.
 */
function inspectCloud(targetRepo: string): DoctorCloudInfo {
  const cloudMap = collectCloudVars(targetRepo);

  const byProvider = CLOUD_PROVIDER_ORDER
    .map(p => ({ label: CLOUD_PROVIDER_LABEL[p], names: [...(cloudMap.get(p) ?? [])].sort() }))
    .filter(g => g.names.length > 0);

  const allNames = [...new Set(byProvider.flatMap(g => g.names))].sort();

  let targetConfigured = false;
  try {
    const cfgRaw = fs.readFileSync(path.join(targetRepo, '.qa-agents', 'execution-config.json'), 'utf-8');
    const cfg = JSON.parse(cfgRaw) as { targets?: Record<string, unknown> };
    targetConfigured = Object.keys(cfg.targets ?? {}).some(isCloudTargetName);
  } catch { /* no/invalid config -> no cloud target */ }

  return { hasCloudVars: allNames.length > 0, byProvider, allNames, targetConfigured };
}

/**
 * Derives a concise AI status from the read-only aiConfigReport output.
 * Reuses the canonical provider/key logic without ever touching key values.
 */
function deriveAiStatus(): AiStatus {
  const lines = buildAiConfigReport();
  const valueOf = (prefix: string): string | undefined => {
    const line = lines.find(l => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : undefined;
  };

  const status = valueOf('- Status: ');
  const requested = valueOf('- Requested: ');

  if (status === 'configured') return 'configured';
  if (!requested || requested === 'N/A') return 'disabled';
  return 'not configured';
}

export function runDoctorAgent(options: DoctorAgentOptions): DoctorAgentResult {
  const { targetRepo } = options;

  const checks: DoctorCheck[] = [];
  const findings: DoctorFinding[] = [];

  // --- Target repo exists ---------------------------------------------------
  const repoExists = fs.existsSync(targetRepo) && fs.statSync(targetRepo).isDirectory();
  checks.push({ label: 'Target repo exists', status: repoExists ? 'OK' : 'FAIL' });
  if (!repoExists) {
    findings.push({
      message: 'Target repo path does not exist or is not a directory.',
      severity: 'Error',
      recommendation: 'Check the path you passed to doctor.',
    });
  }

  // --- package.json ---------------------------------------------------------
  const hasPackageJson = repoExists && fileExists(path.join(targetRepo, 'package.json'));
  checks.push({ label: 'package.json found', status: hasPackageJson ? 'OK' : 'WARN' });
  if (repoExists && !hasPackageJson) {
    findings.push({
      message: 'No package.json found in the target repo.',
      severity: 'Warning',
      recommendation: 'Confirm the path points to the project root.',
    });
  }

  // --- project-profile.json -------------------------------------------------
  const profilePath = path.join(targetRepo, '.qa-agents', 'project-profile.json');
  const profilePresent = fileExists(profilePath);
  let profile: ProjectScanResult | null = null;
  let profileValid = false;
  if (profilePresent) {
    try {
      profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as ProjectScanResult;
      profileValid = true;
    } catch {
      profileValid = false;
    }
  }
  checks.push({ label: 'project-profile.json', status: profileValid ? 'OK' : 'WARN' });
  if (!profilePresent) {
    findings.push({
      message: 'project-profile.json not found.',
      severity: 'Warning',
      recommendation: `Run: npm run dev -- analyze ${targetRepo} --save`,
    });
  } else if (!profileValid) {
    findings.push({
      message: 'project-profile.json exists but is not valid JSON.',
      severity: 'Warning',
      recommendation: `Re-run: npm run dev -- analyze ${targetRepo} --save`,
    });
  }

  // --- repo-rules.md --------------------------------------------------------
  const hasRepoRules = fileExists(path.join(targetRepo, '.qa-agents', 'repo-rules.md'));
  checks.push({ label: 'repo-rules.md', status: hasRepoRules ? 'OK' : 'WARN' });
  if (!hasRepoRules) {
    findings.push({
      message: 'repo-rules.md not found.',
      severity: 'Warning',
      recommendation: `Run: npm run dev -- init-rules ${targetRepo}`,
    });
  }

  // --- execution-config.json ------------------------------------------------
  const hasExecConfig = fileExists(path.join(targetRepo, '.qa-agents', 'execution-config.json'));
  checks.push({ label: 'execution-config.json', status: hasExecConfig ? 'OK' : 'WARN' });
  if (!hasExecConfig) {
    findings.push({
      message: 'execution-config.json not found.',
      severity: 'Warning',
      recommendation: `Run: npm run dev -- init-config ${targetRepo}`,
    });
  }

  // --- latest-run.json ------------------------------------------------------
  const latestRun = readLatestRunResultSafe(targetRepo);
  let latestRunStatus: CheckStatus;
  let latestRunNote: string | undefined;
  if (latestRun.ok) {
    latestRunStatus = 'OK';
    latestRunNote = `last run: ${latestRun.data?.status ?? 'unknown'}`;
  } else if (latestRun.reason === 'missing') {
    latestRunStatus = 'WARN';
    findings.push({
      message: 'No latest run result found.',
      severity: 'Warning',
      recommendation: `Run a suite: npm run dev -- run ${targetRepo} --suite`,
    });
  } else {
    latestRunStatus = 'FAIL';
    findings.push({
      message: 'latest-run.json is invalid or unreadable.',
      severity: 'Error',
      recommendation: `Re-run tests to regenerate it: npm run dev -- run ${targetRepo} --suite`,
    });
  }
  checks.push({ label: 'latest-run.json', status: latestRunStatus, note: latestRunNote });

  // --- AI config ------------------------------------------------------------
  // Rendered as its own line (configured | not configured | disabled), not as a
  // generic OK/WARN check. AI readiness never blocks overall status.
  const aiStatus = deriveAiStatus();
  if (aiStatus !== 'configured') {
    findings.push({
      message: `AI provider is ${aiStatus}.`,
      severity: 'Info',
      recommendation: 'Optional. AI review is opt-in; deterministic review always works. See: npm run dev -- ai-config',
    });
  }

  // --- Spec files -----------------------------------------------------------
  const specFiles = profileValid ? (profile?.structure?.specFilesCount ?? null) : null;

  // --- Cloud execution variables vs. configured cloud target ----------------
  // Diagnostics only: never reads or prints variable values; never modifies the
  // config. A missing cloud target is a Warning that does NOT affect readiness.
  const cloud = repoExists ? inspectCloud(targetRepo) : {
    hasCloudVars: false, byProvider: [], allNames: [], targetConfigured: false,
  };
  if (cloud.hasCloudVars && !cloud.targetConfigured) {
    findings.push({
      message: 'Cloud execution variables found, but no cloud target is configured.',
      severity: 'Warning',
      recommendation: `Add a cloud target (e.g. "lambda") to .qa-agents/execution-config.json using the detected variable names: ${cloud.allNames.join(', ')}`,
    });
  }

  // --- Overall status -------------------------------------------------------
  let overall: DoctorOverall;
  if (!repoExists) {
    overall = 'NOT READY';
  } else if (!profileValid || !hasExecConfig) {
    overall = 'PARTIAL';
  } else {
    overall = 'READY';
  }

  return {
    ok: true,
    exitCode: 0,
    errors: [],
    targetRepo,
    overall,
    checks,
    findings,
    aiStatus,
    specFiles,
    cloud,
  };
}

export function buildDoctorReport(result: DoctorAgentResult): string[] {
  const lines: string[] = [
    'QA Agents - Doctor',
    '',
    'Target repo:',
    result.targetRepo,
    '',
    'Overall status:',
    result.overall,
    '',
    'Checks:',
  ];

  for (const check of result.checks) {
    const note = check.note ? ` (${check.note})` : '';
    lines.push(`- ${check.label}: ${check.status}${note}`);
  }

  lines.push(`- AI config: ${result.aiStatus}`);
  lines.push(`- Spec files: ${result.specFiles ?? 'N/A'}`);

  // Cloud variables line (names listed in the finding, not here). Only shown
  // when cloud variables are actually found in the repo.
  if (result.cloud.hasCloudVars) {
    const summary = result.cloud.byProvider.map(g => `${g.label} (${g.names.length})`).join(', ');
    const targetNote = result.cloud.targetConfigured ? '' : ' — no cloud target configured';
    lines.push(`- Cloud variables: ${summary}${targetNote}`);
  }

  lines.push('', 'Findings:');
  if (result.findings.length === 0) {
    lines.push('(none)');
  } else {
    result.findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${finding.message}`,
        `   Severity: ${finding.severity}`,
        `   Recommendation: ${finding.recommendation}`,
      );
    });
  }

  lines.push(
    '',
    'Recommended next commands:',
    `- npm run dev -- analyze ${result.targetRepo} --save`,
    `- npm run dev -- init-rules ${result.targetRepo}`,
    `- npm run dev -- init-config ${result.targetRepo}`,
    '- npm run dev -- ai-config',
    `- npm run dev -- inspect ${result.targetRepo}`,
    `- npm run dev -- report ${result.targetRepo}`,
  );

  return lines;
}
