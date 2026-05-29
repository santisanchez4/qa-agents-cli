export type RunCommand = {
  cmd: string;
  spawnArgs: string[];
  display: string;
};

export function buildRunCommand(testCommand: string, relativeTestFile: string): RunCommand {
  const parts = testCommand.trim().split(/\s+/);
  const isNpmRun = parts.length >= 2 && parts[0] === 'npm' && parts[1] === 'run';
  const spawnArgs = isNpmRun
    ? [...parts.slice(1), '--', relativeTestFile]
    : [...parts.slice(1), relativeTestFile];
  const display = isNpmRun
    ? `${testCommand} -- ${relativeTestFile}`
    : `${testCommand} ${relativeTestFile}`;
  return { cmd: parts[0], spawnArgs, display };
}
