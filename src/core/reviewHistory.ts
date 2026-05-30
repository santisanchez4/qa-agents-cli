import fs from 'fs';
import path from 'path';

/**
 * Builds a human-readable listing of saved ai-review reports for a target repo.
 *
 * Looks in <target-repo>/.qa-agents/reviews/ for:
 * - latest-ai-review.md           (the most recent saved report)
 * - ai-review-YYYYMMDD-HHMMSS.md  (timestamped history, sorted newest first)
 *
 * Does not read or print report contents — it only lists the saved files.
 */
export function buildReviewHistoryReport(targetRepo: string): string[] {
  const lines: string[] = [];
  lines.push('QA Agents - Saved Reviews');
  lines.push('');
  lines.push('Target repo:');
  lines.push(targetRepo);
  lines.push('');

  const reviewsDir = path.join(targetRepo, '.qa-agents', 'reviews');

  if (!fs.existsSync(reviewsDir)) {
    lines.push('No saved reviews found.');
    lines.push('');
    lines.push('Run:');
    lines.push(`npm run dev -- ai-review ${targetRepo} --file <file> --save-report`);
    return lines;
  }

  const entries = fs.readdirSync(reviewsDir);
  const hasLatest = entries.includes('latest-ai-review.md');
  const history = entries
    .filter(name => /^ai-review-\d{8}-\d{6}\.md$/.test(name))
    .sort()
    .reverse();

  if (!hasLatest && history.length === 0) {
    lines.push('No saved reviews found.');
    lines.push('');
    lines.push('Run:');
    lines.push(`npm run dev -- ai-review ${targetRepo} --file <file> --save-report`);
    return lines;
  }

  lines.push('Latest:');
  if (hasLatest) {
    lines.push('- latest-ai-review.md');
  } else {
    lines.push('- (none)');
  }
  lines.push('');

  lines.push('History:');
  if (history.length === 0) {
    lines.push('- (none)');
  } else {
    for (const name of history) {
      lines.push(`- ${name}`);
    }
  }

  return lines;
}
