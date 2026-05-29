export function printHelp(): void {
  console.log(`
Available commands:

  analyze [path]                Analyze a local automation repository
  analyze [path] --save         Save analysis to .qa-agents/project-profile.json
  generate [path] --spec <file> Load a local test spec for future automation generation
  generate [path] --spec <file> --dry-run  Preview generated test without writing files
  generate [path] --spec <file> --write    Generate and write the test file
  generate [path] --spec <file> --write --force  Write even if related tests exist
  run [path] --file <file> [--env <env>] [--target <target>] [--vars-file <file>]
  run [path] --suite [--env <env>] [--target <target>] [--vars-file <file>]
  run [path] --failed [--env <env>] [--target <target>] [--vars-file <file>]  Re-run failed test files from latest run
  inspect [path]                Inspect test suite, scripts, and execution modes
  init-config [path]            Create .qa-agents/execution-config.json from detected project scripts
  discover-envs [path]          Discover env files, variables, environments, and execution targets
  analyze-failures [path]       Analyze failures from the latest run result
  env-check [path] --env <env> --target <target> [--vars-file <file>]  Validate environment variables and execution target
  report [path]                 Print executive report from latest run result
`);
}
