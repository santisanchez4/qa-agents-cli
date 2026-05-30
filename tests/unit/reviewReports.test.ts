import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveAiReviewReport } from '../../src/core/reviewReportWriter';
import { buildReviewHistoryReport } from '../../src/core/reviewHistory';

let tempRepo: string;

beforeEach(() => {
  tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-test-'));
});

afterEach(() => {
  fs.rmSync(tempRepo, { recursive: true, force: true });
});

describe('saveAiReviewReport', () => {
  it('writes latest-ai-review.md and a timestamped copy with identical content', () => {
    const lines = ['QA Agents - Automation Review', '', '- Risk level: Low'];
    const { latestPath, timestampedPath } = saveAiReviewReport(tempRepo, lines);

    expect(fs.existsSync(latestPath)).toBe(true);
    expect(fs.existsSync(timestampedPath)).toBe(true);

    expect(path.basename(latestPath)).toBe('latest-ai-review.md');
    expect(path.basename(timestampedPath)).toMatch(/^ai-review-\d{8}-\d{6}\.md$/);

    const expected = lines.join('\n') + '\n';
    expect(fs.readFileSync(latestPath, 'utf-8')).toBe(expected);
    expect(fs.readFileSync(timestampedPath, 'utf-8')).toBe(expected);

    // Both files live under .qa-agents/reviews/
    expect(latestPath.replace(/\\/g, '/')).toContain('/.qa-agents/reviews/');
  });
});

describe('buildReviewHistoryReport', () => {
  it('reports no saved reviews when the reviews folder is missing', () => {
    const report = buildReviewHistoryReport(tempRepo).join('\n');
    expect(report).toContain('No saved reviews found.');
  });

  it('lists the latest report and timestamped history newest first', () => {
    const reviewsDir = path.join(tempRepo, '.qa-agents', 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewsDir, 'latest-ai-review.md'), 'latest', 'utf-8');
    fs.writeFileSync(path.join(reviewsDir, 'ai-review-20260101-090000.md'), 'old', 'utf-8');
    fs.writeFileSync(path.join(reviewsDir, 'ai-review-20260103-120000.md'), 'new', 'utf-8');
    fs.writeFileSync(path.join(reviewsDir, 'ai-review-20260102-100000.md'), 'mid', 'utf-8');

    const lines = buildReviewHistoryReport(tempRepo);
    const report = lines.join('\n');

    expect(report).toContain('Latest:');
    expect(report).toContain('- latest-ai-review.md');

    // History entries must appear newest-first.
    const historyEntries = lines.filter(l => /^- ai-review-\d{8}-\d{6}\.md$/.test(l));
    expect(historyEntries).toEqual([
      '- ai-review-20260103-120000.md',
      '- ai-review-20260102-100000.md',
      '- ai-review-20260101-090000.md',
    ]);
  });

  it('ignores unrelated files in the reviews folder', () => {
    const reviewsDir = path.join(tempRepo, '.qa-agents', 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewsDir, 'notes.txt'), 'ignore me', 'utf-8');
    fs.writeFileSync(path.join(reviewsDir, 'ai-review-20260101-090000.md'), 'old', 'utf-8');

    const lines = buildReviewHistoryReport(tempRepo);
    const report = lines.join('\n');
    const historyEntries = lines.filter(l => /^- ai-review-\d{8}-\d{6}\.md$/.test(l));
    expect(historyEntries).toEqual(['- ai-review-20260101-090000.md']);
    expect(report).not.toContain('notes.txt');
  });
});
