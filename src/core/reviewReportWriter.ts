import fs from 'fs';
import path from 'path';

/**
 * Builds a timestamp string in the form YYYYMMDD-HHMMSS (local time).
 */
function buildTimestamp(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Saves an ai-review report to the target repo under .qa-agents/reviews/.
 *
 * Writes two files with identical content:
 * - latest-ai-review.md           (overwritten on each save)
 * - ai-review-YYYYMMDD-HHMMSS.md  (timestamped copy, preserved)
 *
 * Returns the absolute paths of both written files.
 */
export function saveAiReviewReport(
  targetRepo: string,
  reportLines: string[]
): { latestPath: string; timestampedPath: string } {
  const reviewsDir = path.join(targetRepo, '.qa-agents', 'reviews');
  if (!fs.existsSync(reviewsDir)) fs.mkdirSync(reviewsDir, { recursive: true });

  const content = reportLines.join('\n') + '\n';

  const latestPath = path.join(reviewsDir, 'latest-ai-review.md');
  const timestampedPath = path.join(reviewsDir, `ai-review-${buildTimestamp()}.md`);

  fs.writeFileSync(latestPath, content, 'utf-8');
  fs.writeFileSync(timestampedPath, content, 'utf-8');

  return { latestPath, timestampedPath };
}
