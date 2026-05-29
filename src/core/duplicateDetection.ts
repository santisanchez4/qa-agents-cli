import fs from 'fs';
import path from 'path';
import { collectSpecFiles, normalizeSpecTitle } from './testGeneration';

const KEYWORD_STOP_WORDS = new Set(['spec', 'test', 'ts', 'e2e']);

function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().split(/[-_\s./]+/).filter(k => k.length >= 3 && !KEYWORD_STOP_WORDS.has(k))
  )];
}

function extractTcIds(text: string): string[] {
  const ids: string[] = [];
  const tcPattern = /(?:@)?TC[-_](\d+)/gi;
  const testCasePattern = /test\s+case\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tcPattern.exec(text)) !== null) ids.push(`TC-${m[1]}`);
  while ((m = testCasePattern.exec(text)) !== null) ids.push(`TC-${m[1]}`);
  return [...new Set(ids)];
}

export function detectRelatedTests(
  rootPath: string,
  suggestedFilePath: string,
  targetFolder: string,
  e2eBase: string | null,
  testsDir: string,
  specTitle: string,
  specRaw: string
): string[] {
  let searchDir = path.join(rootPath, targetFolder);
  if (!fs.existsSync(searchDir)) {
    searchDir = e2eBase !== null ? path.join(rootPath, e2eBase) : '';
  }
  if (!searchDir || !fs.existsSync(searchDir)) {
    searchDir = testsDir ? path.join(rootPath, testsDir) : '';
  }
  if (!searchDir || !fs.existsSync(searchDir)) return [];

  const specFiles = collectSpecFiles(searchDir, 200);
  const suggestedAbsolute = path.resolve(rootPath, suggestedFilePath);

  const suggestedBasename = path.basename(suggestedFilePath, '.spec.ts');
  const rawTitle = specTitle !== '(no heading found)' ? specTitle : suggestedBasename;
  const keywords = [...new Set([
    ...extractKeywords(suggestedBasename),
    ...extractKeywords(normalizeSpecTitle(rawTitle)),
  ])];
  const tcIds = extractTcIds([specTitle, specRaw, suggestedBasename].join('\n'));

  const related: string[] = [];
  for (const filePath of specFiles) {
    if (path.resolve(filePath) === suggestedAbsolute) continue;

    const basename = path.basename(filePath, '.spec.ts');
    const basenameKeywords = extractKeywords(basename);
    const keywordMatch = keywords.some(k => basenameKeywords.includes(k));
    if (keywordMatch) {
      related.push(path.relative(rootPath, filePath).replace(/\\/g, '/'));
      continue;
    }
    if (tcIds.length > 0) {
      const fileText = basename + '\n' + fs.readFileSync(filePath, 'utf-8');
      const existingTcIds = extractTcIds(fileText);
      if (tcIds.some(id => existingTcIds.includes(id))) {
        related.push(path.relative(rootPath, filePath).replace(/\\/g, '/'));
      }
    }
  }
  return related;
}
