import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSpecNormalizerAgent, buildSpecNormalizerReport } from '../../src/agents/specNormalizerAgent';

let tempRoot: string;
let repo: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-agents-spec-'));
  repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeInput(name: string, content: string): string {
  const file = path.join(tempRoot, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('runSpecNormalizerAgent', () => {
  it('creates .qa-agents/specs/TC-12345.md from a markdown input', async () => {
    const input = writeInput('spec.md', '# Login smoke\n\n1. Open app\nExpected: user logged in\n');
    const result = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: '12345' });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.normalizedId).toBe('TC-12345');
    expect(result.title).toBe('Login smoke');
    expect(result.created).toBe(true);

    const expectedPath = path.join(repo, '.qa-agents', 'specs', 'TC-12345.md');
    expect(result.outputPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const written = fs.readFileSync(expectedPath, 'utf-8');
    expect(written).toContain('# TC-12345 - Login smoke');
    expect(written).toContain('1. Open app');
    expect(written).toContain('1. user logged in');
    expect(written).toContain('## Raw Input');

    const report = buildSpecNormalizerReport(result).join('\n');
    expect(report).toContain('Normalized spec created:');
    expect(report).toContain('TC-12345');
    expect(report).toContain('--spec .qa-agents/specs/TC-12345.md --dry-run');
  });

  it('refuses to overwrite an existing normalized spec', async () => {
    const input = writeInput('spec.md', '# Title\n1. step\n');
    const first = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: 'TC-12345' });
    expect(first.ok).toBe(true);

    const second = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: 'TC-12345' });
    expect(second.ok).toBe(false);
    expect(second.exitCode).toBe(1);
    expect(second.errors.join('\n')).toContain('Refusing to overwrite');
  });

  it('rejects an invalid id', async () => {
    const input = writeInput('spec.md', '# Title\n');
    const result = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: 'not-an-id' });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('Invalid --id');
  });

  it('errors when the input file does not exist', async () => {
    const missing = path.join(tempRoot, 'nope.md');
    const result = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: missing, id: '12345' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Input file not found');
  });

  it('errors on an unsupported file extension', async () => {
    const input = writeInput('spec.json', '{}');
    const result = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: '12345' });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Unsupported file extension');
  });

  it('errors when the target repo path does not exist', async () => {
    const input = writeInput('spec.md', '# Title\n');
    const result = await runSpecNormalizerAgent({
      targetRepo: path.join(tempRoot, 'does-not-exist'),
      inputFile: input,
      id: '12345',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('Target repo path does not exist');
  });

  it('validates missing required args', async () => {
    const noRepo = await runSpecNormalizerAgent({ targetRepo: '', inputFile: 'x.md', id: '12345' });
    expect(noRepo.errors.join('\n')).toContain('Missing target repo');

    const noInput = await runSpecNormalizerAgent({ targetRepo: repo, id: '12345' });
    expect(noInput.errors.join('\n')).toContain('Missing --input');

    const input = writeInput('spec.md', '# Title\n');
    const noId = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input });
    expect(noId.errors.join('\n')).toContain('Missing --id');
  });

  it('supports .txt input', async () => {
    const input = writeInput('spec.txt', 'Plain text spec\nStep: do the thing\n');
    const result = await runSpecNormalizerAgent({ targetRepo: repo, inputFile: input, id: '777' });
    expect(result.ok).toBe(true);
    expect(result.title).toBe('Plain text spec');
    const written = fs.readFileSync(result.outputPath!, 'utf-8');
    expect(written).toContain('1. do the thing');
  });
});
