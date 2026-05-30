/**
 * Deterministic spec parsing/normalization helpers.
 *
 * Pure functions only — no filesystem, no network, no AI. Reused by the
 * spec-normalizer agent to convert a raw local input file into a standardized
 * internal spec.
 */

export type ParsedSpec = {
  title: string;
  summary: string;
  steps: string[];
  expectedResults: string[];
};

/**
 * Normalizes a raw id into `TC-<number>` form.
 * Accepts: `12345`, `TC-12345`, `tc_12345`, `TC12345` (case-insensitive).
 * Returns null when no valid numeric id can be derived.
 */
export function normalizeId(rawId: string | undefined): string | null {
  if (!rawId) return null;
  const match = rawId.trim().match(/^(?:tc[-_ ]?)?(\d+)$/i);
  return match ? `TC-${match[1]}` : null;
}

function stripBom(content: string): string {
  // Strip a leading UTF-8 BOM (U+FEFF) so heading/first-line detection is robust
  // for files created on Windows.
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function splitLines(content: string): string[] {
  return stripBom(content).split(/\r?\n/);
}

/**
 * Title: first markdown heading, else first non-empty line, else "Untitled Spec".
 */
export function extractTitle(content: string): string {
  const lines = splitLines(content);

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return heading[1].trim();
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }

  return 'Untitled Spec';
}

const STEP_NUMBER_RE = /^\d+[.)]\s+(.+)$/;
const STEP_KEYWORD_RE = /^(?:step|action)\s*:\s*(.+)$/i;

/**
 * Steps: numbered lines (`1.`, `2)`, …) and lines starting with `Step:`/`Action:`.
 */
export function extractSteps(content: string): string[] {
  const steps: string[] = [];
  for (const raw of splitLines(content)) {
    const line = raw.trim();
    const numbered = line.match(STEP_NUMBER_RE);
    if (numbered) { steps.push(numbered[1].trim()); continue; }
    const keyword = line.match(STEP_KEYWORD_RE);
    if (keyword) { steps.push(keyword[1].trim()); continue; }
  }
  return steps;
}

const EXPECTED_RE = /expected(?:\s+results?)?\s*:\s*(.+)$/i;
const THEN_RE = /\bthen\b/i;

/**
 * Expected results: lines containing `Expected:` / `Expected Result:` (captures
 * the text after the colon) or `Then` (Gherkin-style, captures the line).
 */
export function extractExpectedResults(content: string): string[] {
  const results: string[] = [];
  for (const raw of splitLines(content)) {
    const line = raw.trim();
    if (!line) continue;
    const expected = line.match(EXPECTED_RE);
    if (expected) { results.push(expected[1].trim()); continue; }
    if (THEN_RE.test(line)) {
      results.push(line.replace(/^then\b\s*/i, '').trim() || line);
    }
  }
  return results;
}

/**
 * Summary: first meaningful line that is not a heading, numbered step, or a
 * step/expected keyword line. Falls back to "TBD".
 */
export function extractSummary(content: string): string {
  for (const raw of splitLines(content)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (STEP_NUMBER_RE.test(line)) continue;
    if (/^(?:step|action|expected)\b/i.test(line)) continue;
    if (THEN_RE.test(line)) continue;
    return line;
  }
  return 'TBD';
}

export function parseSpec(content: string): ParsedSpec {
  return {
    title: extractTitle(content),
    summary: extractSummary(content),
    steps: extractSteps(content),
    expectedResults: extractExpectedResults(content),
  };
}
