export function printHelp(): void {
  console.log(`
Available commands:

  analyze [path]                Analyze a local automation repository
  analyze [path] --save         Save analysis to .qa-agents/project-profile.json
  generate [path] --spec <file> Load a local test spec for automation generation
  generate [path] --tc <id>     Load a normalized spec by Test Case id (.qa-agents/specs/TC-<id>.md)
  generate [path] (--spec <file> | --tc <id>) --dry-run  Preview generated test without writing files
  generate [path] (--spec <file> | --tc <id>) --write    Generate and write the test file
  generate [path] (--spec <file> | --tc <id>) --write --force  Write even if related tests exist
  generate [path] ... --review [--ai] [--save-review]  Review the generated test (AI only with --ai)
  generate [path] ... --write --run [--env <env>] [--target <target>] [--vars-file <file>]  Run the written test
  run [path] --file <file> [--env <env>] [--target <target>] [--vars-file <file>]
  run [path] --suite [--env <env>] [--target <target>] [--vars-file <file>]
  run [path] --failed [--env <env>] [--target <target>] [--vars-file <file>]  Re-run failed test files from latest run
  inspect [path]                Inspect test suite, scripts, and execution modes
  init-config [path]            Create .qa-agents/execution-config.json from detected project scripts
  init-rules [path]             Create a repo-rules.md template for a target repo
  discover-envs [path]          Discover env files, variables, environments, and execution targets
  analyze-failures [path]       Analyze failures from the latest run result
  env-check [path] --env <env> --target <target> [--vars-file <file>]  Validate environment variables and execution target
  report [path]                 Print executive report from latest run result
  ai-config [path]              Show AI provider configuration diagnostics without calling external APIs
  ai-review [path] --file <file> [--ai] [--save-report]  Review a test file and optionally save the report
  reviews [path]                List saved ai-review reports
  doctor [path]                 Check target repo readiness for qa-agents-cli
  capabilities [path]           Detect existing QA/automation capabilities in a target repo
  capability-check [path] [--script <script>]  Evaluate repo-native QA automation capabilities
  normalize-spec [path] --input <file> --id <id>  Normalize a local spec file into .qa-agents/specs/TC-<id>.md
  import-spec [path] --provider <provider> --id <external-id>  Import an external work item into a spec (azure: env-configured, read-only; jira/trello: not implemented)
`);
}
