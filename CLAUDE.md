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

### Re-run only failed tests

```bash
npm run dev -- run <target-repo> --failed [--env <env>] [--target <target>] [--vars-file <file>]
```

See [Run command behavior](#run-command-behavior).

### Analyze failures

```bash
npm run dev -- analyze-failures <target-repo>
```

See [Failure analysis](#failure-analysis).

### Print run report

```bash
npm run dev -- report <target-repo>
```

See [Run report](#run-report).

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

npm run dev -- run C:\Repos\warzone-ui --failed --env staging --target chromium

npm run dev -- analyze-failures C:\Repos\warzone-ui

npm run dev -- report C:\Repos\warzone-ui
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
run [path] --failed [--env <env>] [--target <target>] [--vars-file <file>]
analyze-failures [path]
report [path]
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

The `run` command supports three modes:

```bash
npm run dev -- run <target-repo> --file <test-file> [--env <env>] [--target <target>] [--vars-file <file>]
npm run dev -- run <target-repo> --suite [--env <env>] [--target <target>] [--vars-file <file>]
npm run dev -- run <target-repo> --failed [--env <env>] [--target <target>] [--vars-file <file>]
```

Only one mode may be used at a time.

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
6. For `--failed`: reads `latest-run.json`, extracts unique failed file paths, and reruns only those files.
7. Captures stdout/stderr, prints them, and saves run data to `.qa-agents/runs/latest-run.json`.
8. Exits with the child process's exit code.

For `npm run` scripts, inserts `--` before the file path(s):

```bash
npm run test:e2e -- tests/e2e/a.spec.ts tests/e2e/b.spec.ts
```

For direct commands:

```bash
npx playwright test tests/e2e/a.spec.ts tests/e2e/b.spec.ts
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
mode              - "file", "suite", or "failed"
testFile          - path to the test file (--file mode only, otherwise null)
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
summary           - test result counts (total/passed/failed/skipped/notRun)
failedTests       - list of failed test details (cleaned of ANSI codes)
retry             - retry metadata (see below)
```

Each failed test includes:

```txt
file          - spec file path
title         - test title (ANSI-stripped)
errorType     - normalized error category (e.g. URLAssertionError, LocatorTimeoutError)
message       - error message (ANSI-stripped)
trace         - path to trace.zip if available
screenshot    - path to screenshot if available
video         - path to video if available
```

Retry metadata shape:

```txt
retry: {
  isRetry    - true when this run was triggered by --failed
  sourceRun  - snapshot of the previous run (status, mode, environment, target, command, startedAt, finishedAt, summary)
               null for non-retry runs
  rerunFiles - list of files that were retried
               empty for non-retry runs
}
```

---

## Text sanitization

Playwright test output may contain ANSI escape codes that make stored data and CLI output harder to read.

The module `src/core/textSanitizer.ts` exports:

- `stripAnsi(value)` — removes ANSI/VT escape sequences from a string.
- `cleanText(value)` — strips ANSI codes, collapses whitespace, and trims.
- `normalizeErrorType(errorType, message)` — improves the error type label based on message content:
  - message contains `toHaveURL` → `URLAssertionError`
  - message contains timeout + locator → `LocatorTimeoutError`
  - message contains timeout + navigation → `NavigationTimeoutError`
  - message contains 401 or 403 → `AuthorizationError`
  - otherwise keeps the detected error type

`parseFailedTests` in `runResults.ts` applies these sanitizers before saving to `latest-run.json`.

---

## Failure analysis

```bash
npm run dev -- analyze-failures <target-repo>
```

It:

- Reads `.qa-agents/runs/latest-run.json`.
- Prints run status, environment, target, and summary counts.
- If the run is a retry (`retry.isRetry` is true), prints a **Retry context** block showing source run details, re-run files, and a retry result classification:
  - Retry passed → "Flaky / intermittent test or environment timing issue."
  - Retry failed → "Persistent failure."
- For retry runs that passed completely:
  - Prints: `No failures found in retry run.`
  - Prints: `Original failed tests passed on retry.`
- For all other runs with no failures:
  - Prints: `No failures found in latest run.`
- Prints details and classification for each failed test.
- Classifies failures using basic pattern matching:
  - Environment / service unavailable
  - Navigation timeout
  - Locator timeout
  - URL assertion failed
  - Authentication / authorization error
  - Unknown
- Does not rerun tests.
- Does not modify any files.
- Does not self-heal.

---

## Run report

```bash
npm run dev -- report <target-repo>
```

It:

- Reads `.qa-agents/runs/latest-run.json`.
- Prints an executive-style run report including:
  - Execution details (mode, environment, target, command, status, duration).
  - Summary (total/passed/failed/skipped/notRun).
  - Result section — retry-aware:
    - Retry passed → "Retry was executed. Failed tests passed on retry. Classification: Flaky or intermittent."
    - Retry failed → "Retry was executed. Failed tests failed again. Classification: Persistent failure."
    - Non-retry passed → "Suite passed."
    - Non-retry failed → "Suite failed. Failed tests: N. Classification: \<category\>."
  - Failure overview listing title, file, errorType, and classification category for each failure (omitted when a retry run fully passed).
- Does not rerun tests.
- Does not modify any files.

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
Test Runner Agent           -> run --file, run --suite, run --failed
Run Results Collector       -> latest-run.json written after each run
Failure Analyzer Agent      -> analyze-failures (retry-aware)
Run Report Generator        -> report
```

---

## Current module structure

```txt
src/
  cli/
    index.ts              - command parsing and orchestration
    help.ts               - printHelp()

  core/
    projectScanner.ts     - repo analysis
    executionConfig.ts    - ExecutionConfig types, buildExecutionConfig, classifyTestScript
    envLoader.ts          - parseEnvFile, loadEnvOverlay, isVarSet
    testRunner.ts         - buildRunCommand, RunCommand type
    runResults.ts         - LatestRunData types, parsePlaywrightSummary, parseFailedTests, saveLatestRun
    failureAnalyzer.ts    - classifyFailure, cleanMojibake, buildRetryContextLines
    duplicateDetection.ts - detectRelatedTests
    testGeneration.ts     - buildAutomationPlan, buildTestCode, buildDeterministicTestDraft, collectSpecFiles
    textSanitizer.ts      - stripAnsi, cleanText, normalizeErrorType
    reportGenerator.ts    - buildRunReport
```

Command logic (analyze, generate, run, inspect, init-config, env-check, discover-envs, analyze-failures, report) still lives in `src/cli/index.ts`. Splitting these into `src/commands/` is the remaining technical debt.

---

## Remaining technical debt

The main remaining debt is splitting `src/cli/index.ts` command blocks into separate command modules:

```txt
src/commands/
  analyze.command.ts
  generate.command.ts
  inspect.command.ts
  initConfig.command.ts
  envCheck.command.ts
  discoverEnvs.command.ts
  run.command.ts
  analyzeFailures.command.ts
  report.command.ts
```

Split incrementally, one command at a time.

---

## Step 31 — AI provider architecture (completed)

Prepared the architecture for an optional AI-assisted review layer.

New modules:

```txt
src/core/aiProvider.ts          - AiProviderName, AiProviderConfig, AiReviewRequest,
                                  AiReviewResponse, AiProvider interface,
                                  createDisabledAiProvider()
src/core/reviewerPromptBuilder.ts - buildReviewerPrompt(context, result): string
```

The disabled provider is the safe default: `isConfigured()` returns false, `review()` returns a no-op response without calling any external service.

The prompt builder constructs a structured prompt from deterministic findings plus project context. It is ready to be wired into the agent in Step 32.

The `ai-review` command output is unchanged:
```
Review mode:
- AI provider: not connected yet
- Engine: deterministic static review
```

---

## Next planned feature

**Step 32 — Connect optional AI provider**

Purpose: wire the AI provider into the `ai-review` command so that, when an API key is present, the AI-assisted layer runs after the deterministic reviewer and enhances its findings.

Key rules:
- The deterministic reviewer always runs first and always produces findings.
- The AI layer is optional and only activates when a provider is configured.
- The AI layer enhances recommendations — it does not replace deterministic findings.
- The `Review mode:` section will update to reflect the active provider.
- The command remains read-only. No file modifications ever.

Candidate implementation:
- Read `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from the environment.
- Use `createDisabledAiProvider()` as the fallback when no key is present.
- Call `buildReviewerPrompt(context, result)` to build the prompt.
- Merge `AiReviewResponse.additionalFindings` into the report after deterministic findings.
