import fs from 'fs';
import path from 'path';

/**
 * Use-case orchestration for the `capability-check` command.
 *
 * Static analysis only: evaluates repo-native QA/automation scripts by EVIDENCE
 * (not exact names) and judges whether they look usable/safe to orchestrate. It
 * never executes scripts, modifies files, calls AI providers, or prints raw
 * command values (so secrets in commands are never echoed).
 */

export type CapabilityType =
  | 'Test generation'
  | 'Test execution'
  | 'AI automation'
  | 'Test data / seed'
  | 'Reporting'
  | 'Unknown QA capability';

export type Confidence = 'High' | 'Medium' | 'Low';

export type Safety =
  | 'Safe to inspect'
  | 'Needs manual review'
  | 'Potentially unsafe to execute automatically';

export type CapabilityCandidate = {
  label: string;
  type: CapabilityType;
  confidence: Confidence;
  safety: Safety;
  evidence: string[];
  recommendation: string;
};

export type CapabilityCheckOptions = {
  targetRepo: string;
  scriptName?: string;
};

export type CapabilityCheckResult = {
  ok: boolean;
  exitCode: number;
  errors: string[];
  targetRepo: string;
  mode: 'all' | 'single';
  requestedScript?: string;
  scriptNotFound?: { name: string; suggestions: string[] };
  candidates: CapabilityCandidate[];
  noCandidates: boolean;
  orchestration: string[];
};

function readFileIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

function readScripts(targetRepo: string): Record<string, string> {
  const scripts: Record<string, string> = {};
  const raw = readFileIfExists(path.join(targetRepo, 'package.json'));
  if (!raw) return scripts;
  try {
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (typeof cmd === 'string') scripts[name] = cmd;
    }
  } catch { /* invalid package.json -> no scripts */ }
  return scripts;
}

// True if README/repo-rules mention test generation (used as a soft signal).
function docsMentionGeneration(targetRepo: string): boolean {
  const texts = [
    readFileIfExists(path.join(targetRepo, 'README.md')),
    readFileIfExists(path.join(targetRepo, '.qa-agents', 'repo-rules.md')),
  ];
  return texts.some(t => t != null && /(generate\s+test|test\s+case|automation\s+generation|ai\s+test)/i.test(t));
}

function nameSeg(name: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(name);
}

// Destructive / deploy operations that make a script unsafe to auto-execute.
const UNSAFE_RE = /\b(rm|del|rmdir|delete|clean|deploy|publish|release|prod|production|migrate|write)\b/;
const DRYRUN_RE = /(--?dry-run|dry-run|--check|--list|--help|(^|[^a-z])help([^a-z]|$))/;

function assessSafety(command: string, type: CapabilityType): { safety: Safety; evidence: string[] } {
  const c = command.toLowerCase();

  if (UNSAFE_RE.test(c)) {
    return {
      safety: 'Potentially unsafe to execute automatically',
      evidence: ['Command contains a destructive or deploy-related operation'],
    };
  }

  if (type === 'Test execution') {
    return { safety: 'Safe to inspect', evidence: [] };
  }

  if (DRYRUN_RE.test(c)) {
    return { safety: 'Safe to inspect', evidence: ['Supports a dry-run/check/list mode'] };
  }

  if (type === 'Test generation' || type === 'AI automation' || type === 'Unknown QA capability') {
    return { safety: 'Needs manual review', evidence: ['No dry-run flag detected'] };
  }

  // Test data / seed, Reporting: read-ish by default.
  return { safety: 'Safe to inspect', evidence: [] };
}

function recommendFor(type: CapabilityType, safety: Safety): string {
  if (safety === 'Potentially unsafe to execute automatically') {
    return 'Do not auto-execute. Inspect manually — the command performs destructive or deploy operations.';
  }
  if (type === 'Test execution') {
    return 'Can be used as an execution capability through qa-agents run / execution-config.';
  }
  if (safety === 'Needs manual review') {
    return 'Review this script before orchestration. Prefer using it only if it supports dry-run or controlled output.';
  }
  return 'Appears read-only; safe to inspect before orchestration.';
}

// Classifies a script by evidence. Returns null when it is not QA-related.
function detectCapability(
  name: string,
  command: string,
  docsGeneration: boolean,
): { type: CapabilityType; confidence: Confidence; evidence: string[] } | null {
  const n = name.toLowerCase();
  const c = command.toLowerCase();
  const evidence: string[] = [];

  const scriptRefs = [...command.matchAll(/(scripts\/[A-Za-z0-9_./-]+)/g)].map(m => m[1]);
  for (const ref of scriptRefs) evidence.push(`Script command references ${ref}`);
  const refsGenerator = scriptRefs.some(r => /(generate|tc|automation|test-?case|spec)/i.test(r));

  let type: CapabilityType | null = null;
  let confidence: Confidence = 'Low';

  // --- Test generation ---
  const nameGen = nameSeg(n, 'tc') || n.includes('tc-') || n.includes('generate') ||
    n.includes('automation') || n.includes('testcase') || n.includes('test-case');
  const cmdGen = c.includes('tc-generate') || c.includes('generate-test') || c.includes('test-case') ||
    c.includes('testcase') || c.includes('automation-generator') || refsGenerator ||
    (c.includes('generate') && (c.includes('test') || c.includes('spec') || c.includes('tc')));
  if (nameGen || cmdGen) {
    type = 'Test generation';
    if (nameSeg(n, 'tc')) evidence.push('Script name contains "tc"');
    if (n.includes('generate')) evidence.push('Script name contains "generate"');
    if (n.includes('automation')) evidence.push('Script name contains "automation"');
    const strong = refsGenerator || c.includes('tc-generate') || c.includes('generate-test') ||
      (n.includes('generate') && (nameSeg(n, 'tc') || n.includes('test') || n.includes('spec')));
    confidence = strong ? 'High' : 'Medium';
    if (docsGeneration) evidence.push('Repo docs mention test generation');
  }

  // --- AI automation ---
  if (!type) {
    const nameAi = nameSeg(n, 'ai') || n.includes('agent') || n.includes('codex') || n.includes('claude') || n.includes('gpt');
    const cmdAi = c.includes('openai') || c.includes('anthropic') || c.includes('claude') ||
      c.includes('gpt') || c.includes('agent') || /(^|[^a-z])ai([^a-z]|$)/.test(c);
    if (nameAi || cmdAi) {
      type = 'AI automation';
      evidence.push('Script invokes AI or automation tooling');
      confidence = nameAi && cmdAi ? 'High' : 'Medium';
    }
  }

  // --- Test data / seed ---
  if (!type) {
    if (nameSeg(n, 'seed') || nameSeg(n, 'data') || nameSeg(n, 'setup') || n.includes('fixture') ||
        c.includes('seed') || c.includes('fixture')) {
      type = 'Test data / seed';
      evidence.push('Script relates to test data/seed/setup');
      confidence = 'Medium';
    }
  }

  // --- Reporting ---
  if (!type) {
    if (n.includes('allure') || n.includes('report') || c.includes('allure') ||
        c.includes('show-report') || c.includes('playwright-report')) {
      type = 'Reporting';
      evidence.push('Script relates to reporting');
      confidence = 'Medium';
    }
  }

  // --- Test execution ---
  if (!type) {
    const isExec = n === 'test' || n.startsWith('test:') || nameSeg(n, 'e2e') ||
      nameSeg(n, 'smoke') || nameSeg(n, 'regression') ||
      c.includes('playwright') || c.includes('cypress') || c.includes('vitest') || c.includes('jest');
    if (isExec) {
      type = 'Test execution';
      if (c.includes('playwright')) evidence.push('Script command runs Playwright');
      else if (c.includes('cypress')) evidence.push('Script command runs Cypress');
      else evidence.push('Script runs tests');
      const strong = c.includes('playwright') || c.includes('cypress') || c.includes('vitest') || c.includes('jest');
      confidence = strong ? 'High' : 'Medium';
    }
  }

  // --- Unknown QA capability (weak signal) ---
  if (!type) {
    if (nameSeg(n, 'qa') || nameSeg(n, 'spec') || n.includes('e2e') || c.includes('spec') || c.includes('qa')) {
      type = 'Unknown QA capability';
      evidence.push('Possible QA-related script (ambiguous signal)');
      confidence = 'Low';
    }
  }

  if (!type) return null;
  return { type, confidence, evidence: [...new Set(evidence)] };
}

function buildCandidate(label: string, command: string, docsGeneration: boolean): CapabilityCandidate | null {
  const detected = detectCapability(label.replace(/^npm run /, ''), command, docsGeneration);
  if (!detected) return null;
  const safety = assessSafety(command, detected.type);
  const evidence = [...new Set([...detected.evidence, ...safety.evidence])];
  return {
    label,
    type: detected.type,
    confidence: detected.confidence,
    safety: safety.safety,
    evidence,
    recommendation: recommendFor(detected.type, safety.safety),
  };
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function suggestScripts(requested: string, scriptNames: string[]): string[] {
  return [...scriptNames]
    .sort((x, y) => levenshtein(requested, x) - levenshtein(requested, y))
    .slice(0, 5);
}

// Generator-like files under scripts/ that no package script references become
// their own candidates (detect-by-evidence, not exact names).
function fileCandidates(targetRepo: string, scripts: Record<string, string>, docsGeneration: boolean): CapabilityCandidate[] {
  const candidates: CapabilityCandidate[] = [];
  const scriptsDir = path.join(targetRepo, 'scripts');
  let files: string[] = [];
  try {
    files = fs.readdirSync(scriptsDir, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name);
  } catch { return candidates; }

  const referenced = Object.values(scripts).join('\n').toLowerCase();
  for (const file of files) {
    const rel = `scripts/${file}`;
    if (!/(generate|tc-|automation|test-?case)/i.test(file)) continue;
    if (referenced.includes(rel.toLowerCase())) continue; // already covered by a package script
    const evidence = [`Generator-like file: ${rel}`, 'No dry-run flag detected'];
    if (docsGeneration) evidence.push('Repo docs mention test generation');
    candidates.push({
      label: `file: ${rel}`,
      type: 'Test generation',
      confidence: 'Medium',
      safety: 'Needs manual review',
      evidence,
      recommendation: recommendFor('Test generation', 'Needs manual review'),
    });
  }
  return candidates;
}

export function runCapabilityCheckAgent(options: CapabilityCheckOptions): CapabilityCheckResult {
  const { targetRepo } = options;
  const requestedScript = options.scriptName?.trim() || undefined;
  const scripts = readScripts(targetRepo);
  const docsGeneration = docsMentionGeneration(targetRepo);

  const base: Omit<CapabilityCheckResult, 'candidates' | 'noCandidates' | 'orchestration' | 'mode'> = {
    ok: true,
    exitCode: 0,
    errors: [],
    targetRepo,
    requestedScript,
  };

  // --- Single-script mode ---
  if (requestedScript) {
    if (!(requestedScript in scripts)) {
      return {
        ...base,
        exitCode: 1,
        mode: 'single',
        scriptNotFound: { name: requestedScript, suggestions: suggestScripts(requestedScript, Object.keys(scripts)) },
        candidates: [],
        noCandidates: true,
        orchestration: [],
      };
    }

    const command = scripts[requestedScript];
    let candidate = buildCandidate(`npm run ${requestedScript}`, command, docsGeneration);
    if (!candidate) {
      // User asked for this script explicitly, so report it even if it has no
      // clear QA signal.
      const safety = assessSafety(command, 'Unknown QA capability');
      candidate = {
        label: `npm run ${requestedScript}`,
        type: 'Unknown QA capability',
        confidence: 'Low',
        safety: safety.safety,
        evidence: ['No clear QA capability signals detected', ...safety.evidence],
        recommendation: recommendFor('Unknown QA capability', safety.safety),
      };
    }

    return {
      ...base,
      mode: 'single',
      candidates: [candidate],
      noCandidates: false,
      orchestration: buildOrchestration([candidate]),
    };
  }

  // --- All-candidates mode ---
  const candidates: CapabilityCandidate[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    const candidate = buildCandidate(`npm run ${name}`, command, docsGeneration);
    if (candidate) candidates.push(candidate);
  }
  candidates.push(...fileCandidates(targetRepo, scripts, docsGeneration));

  return {
    ...base,
    mode: 'all',
    candidates,
    noCandidates: candidates.length === 0,
    orchestration: candidates.length > 0 ? buildOrchestration(candidates) : [],
  };
}

function buildOrchestration(candidates: CapabilityCandidate[]): string[] {
  const lines: string[] = [];
  const hasGeneration = candidates.some(c => c.type === 'Test generation');
  const hasExecution = candidates.some(c => c.type === 'Test execution');

  if (hasGeneration) {
    lines.push('Repo-native generation candidates found. Validate them before using qa-agents generate as fallback.');
    lines.push('Do not auto-execute generation scripts until they support dry-run or are reviewed.');
  } else {
    lines.push('No repo-native generation candidates found. Use qa-agents generate for deterministic draft generation.');
  }
  if (hasExecution) {
    lines.push('Use qa-agents run / report / analyze-failures for the execution lifecycle.');
  }
  lines.push('Use qa-agents ai-review to review generated or existing tests.');
  return lines;
}

export function buildCapabilityCheckReport(result: CapabilityCheckResult): string[] {
  const lines: string[] = [
    'QA Agents - Capability Check',
    '',
    'Target repo:',
    result.targetRepo,
    '',
  ];

  if (result.scriptNotFound) {
    lines.push(`Script not found: ${result.scriptNotFound.name}`, '');
    if (result.scriptNotFound.suggestions.length > 0) {
      lines.push('Closest candidate scripts:');
      for (const s of result.scriptNotFound.suggestions) lines.push(`- ${s}`);
    } else {
      lines.push('No similar scripts found in package.json.');
    }
    return lines;
  }

  lines.push('Mode:');
  lines.push(result.mode === 'single' ? `- Single script: ${result.requestedScript}` : '- All candidates');
  lines.push('');

  if (result.noCandidates) {
    lines.push(
      'No repo-native QA automation capabilities found.',
      'Use qa-agents native commands:',
      '- generate',
      '- ai-review',
      '- run',
      '- report',
    );
    return lines;
  }

  lines.push('Candidates:');
  result.candidates.forEach((candidate, index) => {
    lines.push(
      '',
      `${index + 1}. ${candidate.label}`,
      `   Type: ${candidate.type}`,
      `   Confidence: ${candidate.confidence}`,
      `   Safety: ${candidate.safety}`,
      '   Evidence:',
      ...candidate.evidence.map(e => `   - ${e}`),
      '   Recommendation:',
      `   ${candidate.recommendation}`,
    );
  });

  if (result.orchestration.length > 0) {
    lines.push('', 'Recommended orchestration:');
    for (const line of result.orchestration) lines.push(`- ${line}`);
  }

  return lines;
}
