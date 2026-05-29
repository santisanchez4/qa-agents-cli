# QA Agents CLI - Project Memory

## Project goal

This repo is a local CLI tool called `qa-agents-cli`.

The goal is to build a reusable QA Automation Agent Stack that can be used locally against any automation project.

---

## Generic product rule

`qa-agents-cli` is the reusable engine.

It must not hardcode project names, folder structures, business rules, URLs, credentials, or any project-specific concepts (including anything Warzone-specific).

Target repositories provide local context through:

```txt
<target-repo>/.qa-agents/project-profile.json
<target-repo>/.qa-agents/repo-rules.md
<target-repo>/.qa-agents/execution-config.json
<target-repo>/.qa-agents/specs/
<target-repo>/.qa-agents/runs/
```

Any behavior discovered during lab testing must be generalized before being added to the CLI logic. If it only makes sense for one project, it belongs in that project's `.qa-agents/` files — not here.

---

## Lab projects

`warzone-ui` is used only to validate the CLI against a real project. It is a laboratory, not a built-in or default target. The CLI must work equally well against any repo with a compatible structure.

Warzone-specific rules live exclusively in:

```txt
C:\Repos\warzone-ui\.qa-agents\repo-rules.md
```

They must never be copied or replicated into `qa-agents-cli` source code.

---

## Target repo `.qa-agents` structure

```txt
.qa-agents/
  project-profile.json      # Created by: analyze --save
  repo-rules.md             # Maintained manually in the target repo
  execution-config.json     # Created by: init-config
  specs/                    # Spec files maintained in the target repo
  runs/
    latest-run.json         # Written by: run
```

---

## Current CLI commands

### Analyze a repo

```bash
npm run dev -- analyze <target-repo>
```

Saves nothing. Prints JSON analysis to stdout.

### Analyze and save project profile

```bash
npm run dev -- analyze <target-repo> --save
```

Creates:

```txt
<target-repo>/.qa-agents/project-profile.json
```

### Generate from local spec

```bash
npm run dev -- generate <target-repo> --spec <spec-file>
```

Loads:

```txt
<target-repo>/.qa-agents/project-profile.json
<target-repo>/.qa-agents/repo-rules.md
<target-repo>/.qa-agents/specs/<spec-file>
```

Produces an Automation Plan. Does not write files.

### Dry-run generation

```bash
npm run dev -- generate <target-repo> --spec <spec-file> --dry-run
```

Prints the Automation Plan, any duplicate risk warnings, and the generated test draft. Never creates or modifies files.

> **npm behavior note:** `--dry-run` is a recognized npm flag and may be consumed by npm before reaching the script. The CLI detects dry-run mode via both:
> ```ts
> args.includes('--dry-run')
> process.env['npm_config_dry_run'] === 'true'
> ```

### Write generation

```bash
npm run dev -- generate <target-repo> --spec <spec-file> --write
```

Safe write order:

```txt
1. Build plan
2. Build test code
3. Detect related tests
4. If related tests exist and no --force, stop
5. If target file already exists, stop
6. Create folder
7. Write file
```

### Force write

```bash
npm run dev -- generate <target-repo> --spec <spec-file> --write --force
```

Allows writing even when related tests exist. Prints:

```txt
Force enabled. Creating file despite related tests.
```

### Dry-run and write conflict

If both `--dry-run` and `--write` are provided, the CLI prefers safety and prints:

```txt
Both --dry-run and --write were provided. Running in dry-run mode only.
```

No files are written.

### Inspect suite

```bash
npm run dev -- inspect <target-repo>
```

See [Suite inspection](#suite-inspection).

### Initialize execution config

```bash
npm run dev -- init-config <target-repo>
```

See [Execution config](#execution-config).

### Check environment variables

```bash
npm run dev -- env-check <target-repo> --env <env> --target <target> [--vars-file <file>]
```

See [Environment check](#environment-check).

### Discover environments

```bash
npm run dev -- discover-envs <target-repo>
```

See [Environment discovery](#environment-discovery).

### Run a specific test file

```bash
npm run dev -- run <target-repo> --file <test-file> [--env <env>] [--target <target>] [--vars-file <file>]
```

### Run the full suite

```bash
npm run dev -- run <target-repo> --suite [--env <env>] [--target <target>] [--vars-file <file>]
```

See [Run command behavior](#run-command-behavior).

### Analyze failures

```bash
npm run dev -- analyze-failures <target-repo>
```

See [Failure analysis](#failure-analysis).

---

## Example only

> These examples use `warzone-ui` as the lab project. Replace with any compatible target repo.

```bash
npm run dev -- analyze C:\Repos\warzone-ui --save

npm run dev -- inspect C:\Repos\warzone-ui

npm run dev -- init-config C:\Repos\warzone-ui

npm run dev -- discover-envs C:\Repos\warzone-ui

npm run dev -- env-check C:\Repos\warzone-ui --env staging --target chromium

npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md --dry-run

npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md --write

npm run dev -- run C:\Repos\warzone-ui --file tests/e2e/auth/login.spec.ts --env staging --target chromium

npm run dev -- run C:\Repos\warzone-ui --suite --env staging --target chromium

npm run dev -- analyze-failures C:\Repos\warzone-ui
```

> **Important:** Do not run qa-agents commands from inside the target repo using that repo's own `npm run dev`. Always run from the `qa-agents-cli` directory:
>
> ```bash
> cd C:\Users\Santiago\qa-agents-cli
> npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md
> ```

---

## Current implemented behavior

```txt
analyze [path]
analyze [path] --save
generate [path] --spec <file>
generate [path] --spec <file> --dry-run
generate [path] --spec <file> --write
generate [path] --spec <file> --write --force
inspect [path]
init-config [path]
env-check [path] --env <env> --target <target> [--vars-file <file>]
discover-envs [path]
run [path] --file <file> [--env <env>] [--target <target>] [--vars-file <file>]
run [path] --suite [--env <env>] [--target <target>] [--vars-file <file>]
analyze-failures [path]
```

---

## Repo analysis behavior

The scanner detects:

- Root path
- Language
- Frameworks (Playwright, Cypress, ...)
- Important files
- Package manager
- Package scripts
- Suggested test command
- Project structure

Detected structure shape:

```ts
structure: {
  testsDir?: string;
  pagesDir?: string;
  locatorsDir?: string;
  fixturesDir?: string;
  utilsDir?: string;
  servicesDir?: string;
  specFilesCount: number;
  usesPom: boolean;
}
```

The scanner must stay fully generic.

---

## Suite inspection

The `inspect` command provides an overview of the test suite in a target repo.

```bash
npm run dev -- inspect <target-repo>
```

It:

- Loads the project profile (`project-profile.json`).
- Counts total spec files.
- Groups tests by folder to show distribution across feature areas.
- Detects support folders (fixtures, helpers, utils, setup).
- Detects available execution modes from package scripts (e.g., headed, headless, specific browsers).
- Recommends next commands based on what is already configured.

Does not modify any files.

---

## Execution config

The `init-config` command initializes the execution configuration for a target repo.

```bash
npm run dev -- init-config <target-repo>
```

It:

- Creates `.qa-agents/execution-config.json` in the target repo.
- Uses detected package scripts to populate available targets and test commands.
- Creates starter environments (e.g., `staging`, `production`) and targets (e.g., `chromium`, `firefox`).
- Does **not** overwrite an existing `execution-config.json`.

The generated config is a starting point. Environments, targets, required variables, and commands should be adjusted manually to match the project.

---

## Environment check

```bash
npm run dev -- env-check <target-repo> --env <env> --target <target> [--vars-file <file>]
```

It:

- Loads `project-profile.json`.
- Loads `execution-config.json`.
- Validates that the selected `--env` exists in the config.
- Validates that the selected `--target` exists in the config.
- Loads variables from `--vars-file` if provided, otherwise auto-loads from the target repo in this order:
  1. `.env.<env>`
  2. `.env.<env>.local`
  3. `.env.local`
  4. `.env`
- Never prints secret values — prints `SET` or `MISSING` only.
- Exits non-zero when required variables are missing.

> **Flag note:** Use `--vars-file`, not `--env-file`. The flag `--env-file` can conflict with Node/tsx argument handling.

---

## Environment discovery

```bash
npm run dev -- discover-envs <target-repo>
```

It:

- Detects `.env*` files in the target repo.
- Parses variable keys only — never reads or prints values.
- Infers possible environments from env file names, URL patterns, variable names, and package scripts.
- Groups variables by category:
  - App / URL variables
  - User credentials
  - Admin credentials
  - Cloud execution variables
  - Secrets / API keys
- Detects execution targets.
- Does not modify any config files.

---

## Generic structure rules

Common test directories:

```txt
tests / test / e2e
```

Common page/POM/component directories:

```txt
pages / src/pages / PageObjects / pageObjects
src/apps / src/components / apps / components
```

Common locator/view directories:

```txt
locators / src/locators / selectors / src/selectors
views / src/views / elements / src/elements
```

Common support folders (never selected as feature folders):

```txt
fixtures / helpers / setup / utils / data / mocks
```

---

## E2E folder logic

If the target repo has `tests/e2e`, use it as the E2E base folder. Ignore support folders when selecting feature areas.

Inspect feature folders inside `tests/e2e` to find the best match for the spec.

---

## Feature folder matching

The CLI uses generic keyword matching to map spec titles to existing feature folders:

```txt
login / sign-in    -> auth, login
register / sign-up -> auth, register, registration
tournament         -> tournament, tournaments
team               -> team, teams
wallet             -> wallet
admin              -> admin
support            -> support
```

If no folder matches, suggest a kebab-case folder derived from the spec title.

---

## Existing pattern inspection

Before generating code, the CLI inspects up to 5 `.spec.ts` files from the target area.

Search priority:

```txt
1. Suggested target folder
2. E2E base folder
3. Detected tests directory
```

Detected patterns:

```txt
imports @playwright/test
uses test.describe
uses test.beforeEach
uses fixtures
uses helpers
uses page objects/components
has tagged tests
```

Also detects support folders:

```txt
tests/fixtures / tests/helpers / tests/setup
src/fixtures / src/helpers / src/utils
```

Generated code must respect detected patterns. If existing tests do not use helpers or page objects, the generator must not invent them.

---

## Duplicate detection

Before writing, the CLI inspects `.spec.ts` files under the same search priority as pattern inspection.

Related tests are detected by:

- Normalized spec title keywords
- Suggested file basename keywords
- TC IDs from the spec title, spec body, or file name

TC ID formats detected and normalized to `TC-<number>`:

```txt
TC-12345 / TC_12345 / tc-12345 / @TC-12345 / Test Case 12345
```

If related tests are found and `--force` is not provided, `--write` stops and prints:

```txt
Related existing test files found. Refusing to auto-create a possible duplicate.

Related files:
- <file>

Suggested action:
Review the existing test and decide whether to update it, add a new scenario, or create a separate test intentionally.
```

---

## Deterministic test generation

The current generator is deterministic and does not call any AI API.

For Playwright specs it generates:

- Import from `@playwright/test`
- `test.describe` wrapper if detected in existing patterns
- No tags if existing tests do not use tags
- Env vars (`E2E_EMAIL`, `E2E_PASSWORD`) for auth flows — never hardcoded credentials
- User-facing Playwright locators (`getByRole`)
- Post-action assertions

The generator detects the spec type (login, register, generic) from the title and filename.

---

## Spec title normalization

The Automation Plan displays the original markdown heading as-is.

Generated code strips common prefixes (case-insensitive):

```txt
Test Spec: / Spec: / Test:
```

So a spec titled `Test Spec: Login Smoke` produces:

```ts
test.describe('login smoke', () => {
```

---

## Run command behavior

The `run` command supports running a single test file or the full suite, with optional environment and target selection.

```bash
npm run dev -- run <target-repo> --file <test-file> [--env <env>] [--target <target>] [--vars-file <file>]

npm run dev -- run <target-repo> --suite [--env <env>] [--target <target>] [--vars-file <file>]
```

Behavior:

1. Loads `project-profile.json`.
2. If `execution-config.json` exists:
   - Validates the selected `--env` and `--target` against the config.
   - Loads env vars from `--vars-file` or auto-loads from `.env.<env>`, `.env.<env>.local`, `.env.local`, `.env`.
   - Validates required variables for the selected environment.
   - Uses the test command configured for the selected target.
   - Passes env vars into the spawned test process.
3. If `execution-config.json` does not exist:
   - Falls back to the `testCommand` from the project profile.
4. For `--file`: appends the specific test file to the command.
5. For `--suite`: runs the full suite without appending a file path.
6. Captures stdout/stderr, prints them, and saves run data to `.qa-agents/runs/latest-run.json`.
7. Exits with the child process's exit code.

For `npm run` commands, inserts `--` before the file path:

```bash
npm run test:e2e -- <test-file>
```

For direct commands:

```bash
npx playwright test <test-file>
```

---

## Latest run results

Every `run` command writes results to:

```txt
<target-repo>/.qa-agents/runs/latest-run.json
```

Fields stored:

```txt
targetRepo        - absolute path to the target repo
mode              - "file" or "suite"
testFile          - path to the test file (file mode only)
environment       - selected --env value
target            - selected --target value
varsFile          - path to --vars-file if provided
loadedEnvFiles    - list of .env files that were loaded
command           - the full command that was run
exitCode          - process exit code
status            - "passed" or "failed"
startedAt         - ISO timestamp
finishedAt        - ISO timestamp
durationMs        - run duration in milliseconds
summary           - test result counts
failedTests       - list of failed test details
```

Summary shape:

```txt
total / passed / failed / skipped / notRun
```

Each failed test includes:

```txt
file          - spec file path
title         - test title
errorType     - classified error category
message       - error message
trace         - stack trace
screenshot    - path to screenshot if available
video         - path to video if available
```

---

## Failure analysis

```bash
npm run dev -- analyze-failures <target-repo>
```

It:

- Reads `.qa-agents/runs/latest-run.json`.
- Prints run status, environment, target, and summary counts.
- Prints details for each failed test.
- Classifies failures using basic pattern matching:
  - Environment / service unavailable
  - Navigation timeout
  - Locator timeout
  - URL assertion failed
  - Authentication / authorization error
  - Unknown
- Prints likely cause and suggested actions for each failure category.
- Does not rerun tests.
- Does not modify any files.
- Does not self-heal.

---

## Current agent-like capabilities

The CLI now covers the following capability areas. These are not independent AI agents yet — they are deterministic CLI capabilities that prepare the system for future multi-agent orchestration.

```txt
Repo Analyst Agent          -> analyze, analyze --save
Local Test Intake Agent     -> generate --spec (plan only)
Automation Planner          -> generate --spec (Automation Plan output)
QA Automation Agent (MVP)   -> generate --spec --write (deterministic)
Duplicate Guard             -> duplicate detection before --write
Suite Inspector Agent       -> inspect
Environment & Execution     -> init-config, env-check, discover-envs
Test Runner Agent           -> run --file, run --suite
Run Results Collector       -> latest-run.json written after each run
Failure Analyzer Agent      -> analyze-failures
```

---

## Current technical debt

`src/cli/index.ts` is too large and should be modularized before adding more features.

Suggested future module structure:

```txt
src/
  cli/
    index.ts
    help.ts

  commands/
    analyze.command.ts
    generate.command.ts
    inspect.command.ts
    initConfig.command.ts
    envCheck.command.ts
    discoverEnvs.command.ts
    run.command.ts
    analyzeFailures.command.ts

  core/
    projectScanner.ts
    projectProfile.ts
    executionConfig.ts
    envLoader.ts
    testDiscovery.ts
    testRunner.ts
    runResults.ts
    failureAnalyzer.ts
    duplicateDetection.ts
    testGeneration.ts
    pathUtils.ts
    textUtils.ts

  types/
    project.types.ts
    execution.types.ts
    run.types.ts
    failure.types.ts
```

Refactor incrementally — do not attempt a big-bang rewrite:

1. Move help text to `src/cli/help.ts`.
2. Move env file loading to `core/envLoader.ts`.
3. Move execution config logic to `core/executionConfig.ts`.
4. Move run result logic to `core/runResults.ts`.
5. Move failure analyzer logic to `core/failureAnalyzer.ts`.
6. Split commands one by one.

---

## Next planned feature

After documentation and modularization:

```bash
npm run dev -- run <target-repo> --failed [--env <env>] [--target <target>] [--vars-file <file>]
```

Purpose:

- Read `latest-run.json`.
- Extract the list of failed test files.
- Re-run only those files.
- Do not self-heal yet.
