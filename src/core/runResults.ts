import fs from 'fs';
import path from 'path';

export type RunSummary = {
  total: number | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  notRun: number | null;
};

export type FailedTest = {
  file: string | null;
  title: string | null;
  errorType: string | null;
  message: string | null;
  trace: string | null;
  screenshot: string | null;
  video: string | null;
};

export type LatestRunData = {
  targetRepo: string;
  mode: 'file' | 'suite';
  testFile: string | null;
  environment: string | null;
  target: string | null;
  varsFile: string | null;
  loadedEnvFiles: string[];
  command: string;
  exitCode: number;
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: RunSummary;
  failedTests: FailedTest[];
};

export function parsePlaywrightSummary(output: string): RunSummary {
  const summary: RunSummary = { total: null, passed: null, failed: null, skipped: null, notRun: null };
  try {
    const m = (re: RegExp) => { const r = output.match(re); return r ? parseInt(r[1], 10) : null; };
    summary.total   = m(/Running (\d+) tests? using/);
    summary.passed  = m(/(\d+) passed/);
    summary.failed  = m(/(\d+) failed/);
    summary.skipped = m(/(\d+) skipped/);
    summary.notRun  = m(/(\d+) did not run/);
  } catch { /* best-effort */ }
  return summary;
}

export function parseFailedTests(output: string): FailedTest[] {
  const tests: FailedTest[] = [];
  try {
    const lines = output.split('\n');
    // Playwright failure header: "  1) [chromium] › path/to/file.spec.ts:123:45 › Test title"
    const headerRe = /^\s*\d+\)\s+\[.*?\]\s+[›>]\s+(.+?):(\d+):(\d+)\s+[›>]\s+(.*)$/;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(headerRe);
      if (!m) continue;

      const file = m[1].trim().replace(/\\/g, '/');
      const title = m[4].trim();
      let errorType: string | null = null;
      let message: string | null = null;
      let trace: string | null = null;
      let screenshot: string | null = null;
      let video: string | null = null;

      for (let j = i + 1; j < Math.min(i + 60, lines.length); j++) {
        const line = lines[j];
        if (/^\s*\d+\)\s+\[.*?\]/.test(line)) break;

        if (!errorType) {
          const em = line.match(/^\s+(TimeoutError|AssertionError|Error|RangeError|TypeError|EvalError):\s*(.+)$/);
          if (em) { errorType = em[1]; message = `${em[1]}: ${em[2].trim()}`; }
        }
        if (!trace && line.includes('trace.zip')) {
          const tm = line.match(/(\S+trace\.zip)/);
          if (tm) trace = tm[1].replace(/\\/g, '/');
        }
        if (!screenshot && line.includes('.png')) {
          const sm = line.match(/(\S+\.png)/);
          if (sm) screenshot = sm[1].replace(/\\/g, '/');
        }
        if (!video && line.includes('.webm')) {
          const vm = line.match(/(\S+\.webm)/);
          if (vm) video = vm[1].replace(/\\/g, '/');
        }
      }

      tests.push({ file, title, errorType, message, trace, screenshot, video });
    }
  } catch { /* best-effort */ }
  return tests;
}

export function saveLatestRun(targetPath: string, data: LatestRunData): void {
  try {
    const runsDir = path.join(targetPath, '.qa-agents', 'runs');
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
    const outPath = path.join(runsDir, 'latest-run.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\nRun result saved at:\n${outPath}`);
  } catch { /* don't crash the CLI on save failure */ }
}
