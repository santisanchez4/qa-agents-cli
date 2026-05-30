import { describe, it, expect } from 'vitest';
import { buildRepoRulesTemplate } from '../../src/core/repoRulesTemplate';

describe('buildRepoRulesTemplate', () => {
  const template = buildRepoRulesTemplate();

  it('includes all expected sections', () => {
    const expectedSections = [
      '# QA Agents Repo Rules',
      '## Project context',
      '## Selector strategy',
      '## Environment variables',
      '## Test data rules',
      '## Critical flows',
      '## Do not do',
      '## Notes for AI reviewer',
    ];
    for (const section of expectedSections) {
      expect(template).toContain(section);
    }
  });

  it('does not include project-specific names', () => {
    const lowered = template.toLowerCase();
    expect(lowered).not.toContain('warzone');
    expect(lowered).not.toContain('intermex');
  });
});
