import fs from 'fs';
import path from 'path';

/**
 * Writes a normalized spec into <target-repo>/.qa-agents/specs/, creating the
 * directory if needed. Refuses to overwrite an existing file.
 */

export type WriteSpecResult = {
  created: boolean;
  outputPath: string;
  alreadyExists: boolean;
};

export function writeSpecFile(targetRepo: string, fileName: string, content: string): WriteSpecResult {
  const specsDir = path.join(targetRepo, '.qa-agents', 'specs');
  const outputPath = path.join(specsDir, fileName);

  if (fs.existsSync(outputPath)) {
    return { created: false, outputPath, alreadyExists: true };
  }

  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');
  return { created: true, outputPath, alreadyExists: false };
}
