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

  agents/
    automationReviewerAgent.ts  - runAiReview, runAiLayer, buildAiReviewReport
    automationGeneratorAgent.ts - runAutomationGenerator, buildAutomationGeneratorReport
    failureAnalyzerAgent.ts     - runFailureAnalyzer, buildFailureAnalyzerReport
    reportAgent.ts              - runReportAgent, buildReportAgentOutput
    testRunnerAgent.ts          - runTestRunnerAgent, buildTestRunnerAgentOutput
```

The `generate`, `analyze-failures`, `report`, and `run` flows now live in agents (`automationGeneratorAgent.ts`, `failureAnalyzerAgent.ts`, `reportAgent.ts`, `testRunnerAgent.ts`). The remaining command logic (analyze, inspect, init-config, env-check, discover-envs) still lives in `src/cli/index.ts`. Splitting these into `src/commands/` (or further agents) is the remaining technical debt.

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

## Step 32 — Optional AI-assisted review wiring (completed)

Added `--ai` flag to `ai-review` command. Wired the optional AI layer without connecting a real provider.

New module: `src/core/aiProviderResolver.ts` — exports `resolveAiProvider()`.
Currently always returns `createDisabledAiProvider()`. Step 33 adds real provider factories.

Updated: `src/agents/automationReviewerAgent.ts`
- `ReviewContext.aiEnabled: boolean` — set by `--ai` flag.
- `AiLayerResult` type (`status`, `reason`, `additionalFindings`).
- `runAiLayer(context, result): Promise<AiLayerResult | null>` — calls resolver, checks `isConfigured()`.
- `buildAiReviewReport` — updated to accept `AiLayerResult | null` and render the AI section.

Behavior:
- Without `--ai`: output unchanged (deterministic review only).
- With `--ai`, provider not configured: prints deterministic review + "AI-assisted review: skipped".
- With `--ai`, provider configured but not implemented: prints "Status: not implemented".
- Deterministic review always runs first regardless of `--ai`.

---

## Step 33 — Multi-provider AI support for ai-review (completed)

`ai-review --ai` now supports four optional AI providers. Provider selection is driven entirely by environment variables — no code changes required to switch providers.

### Provider files

```txt
src/core/providers/openAiProvider.ts      - OpenAI (uses openai SDK)
src/core/providers/anthropicProvider.ts   - Anthropic / Claude (uses @anthropic-ai/sdk)
src/core/providers/geminiProvider.ts      - Google Gemini (uses @google/genai, dynamic import for ESM compat)
src/core/providers/deepSeekProvider.ts    - DeepSeek (uses openai SDK with DeepSeek base URL)
```

Shared: `REVIEW_SYSTEM_MESSAGE` and `safeErrorMessage` live in `src/core/aiProvider.ts` and are imported by all providers.

### Environment variables

```
QA_AGENTS_AI_PROVIDER=openai        OPENAI_API_KEY=<key>      QA_AGENTS_OPENAI_MODEL=gpt-4.1-mini     (default)
QA_AGENTS_AI_PROVIDER=anthropic     ANTHROPIC_API_KEY=<key>   QA_AGENTS_ANTHROPIC_MODEL=claude-sonnet-4-5 (default)
QA_AGENTS_AI_PROVIDER=gemini        GEMINI_API_KEY=<key>      QA_AGENTS_GEMINI_MODEL=gemini-2.5-flash (default)
QA_AGENTS_AI_PROVIDER=deepseek      DEEPSEEK_API_KEY=<key>    QA_AGENTS_DEEPSEEK_MODEL=deepseek-v4-flash (default)
```

If `QA_AGENTS_AI_PROVIDER` is unset or the matching API key is missing, the disabled provider is used (Status: skipped).

### Safety rules

- AI only runs when `--ai` is explicitly passed.
- Deterministic review always runs first and always produces findings.
- AI enhances recommendations — it does not replace deterministic findings.
- System message explicitly prohibits patches, file writes, and self-healing.
- API keys are never printed. Error messages redact key-like strings.
- `ai-review` is always read-only regardless of provider.

---

## Step 34 — init-rules command (completed)

Added `init-rules <path>` command that creates a generic `repo-rules.md` template at `<repo>/.qa-agents/repo-rules.md`.

New module: `src/core/repoRulesTemplate.ts` — exports `buildRepoRulesTemplate(): string`.

Behavior:
- Creates `.qa-agents/` if it does not exist.
- If `repo-rules.md` already exists, prints a notice and exits without overwriting.
- The template contains eight sections with examples (Project context, Test organization, Selector strategy, Environment variables, Test data rules, Critical flows, Stability rules, Do not do, Notes for AI reviewer).
- No project-specific content. Fully generic.

---

## Step 35 — ai-config diagnostics command (completed)

Added `ai-config [path]` command for safe, read-only AI provider diagnostics.

New module: `src/core/aiConfigReport.ts` — exports `buildAiConfigReport(): string[]`.

Output sections:
- **Provider** — Requested, Resolved, Status, Model, API key (SET/MISSING — never the value).
- **Required env vars** — `QA_AGENTS_AI_PROVIDER` and the provider-specific key.
- **Security checks** — warns if `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Notes** — reminds that `--ai` is opt-in and deterministic review always works.

Cases handled:
- No `QA_AGENTS_AI_PROVIDER` → Resolved: disabled, all vars MISSING.
- Unsupported provider → Resolved: disabled, prints "Unsupported provider" note.
- Supported provider, key missing → Resolved: disabled, shows which key is MISSING.
- Supported provider, key set → Resolved: \<provider\>, shows model (env override or default).

Does not call any external API. Does not print API key values.

---

## Step 36 — Save report support for ai-review (completed)

Added an optional `--save-report` flag to the `ai-review` command.

```bash
npm run dev -- ai-review <target-repo> --file <test-file> [--ai] [--save-report]
```

New module: `src/core/reviewReportWriter.ts` — exports
`saveAiReviewReport(targetRepo, reportLines): { latestPath: string; timestampedPath: string }`.

Behavior with `--save-report`:
- Ensures `<target-repo>/.qa-agents/reviews/` exists.
- Writes the full report to `latest-ai-review.md` (overwritten each save).
- Writes a preserved timestamped copy `ai-review-YYYYMMDD-HHMMSS.md`.
- Saved content matches the console report exactly.
- After saving, prints:

```txt
Review report saved:
<path to latest-ai-review.md>

Timestamped copy:
<path to ai-review-YYYYMMDD-HHMMSS.md>
```

Safety:
- Reports are saved only when `--save-report` is passed.
- Reports live under `.qa-agents/reviews/`; `latest-ai-review.md` is overwritten while timestamped copies are preserved.
- The reviewed test file and other target repo source files are never modified.
- `ai-review` behavior is unchanged without `--save-report`, and `--ai` behavior is unchanged.

---

## Step 37 — Saved reviews history command (completed)

Added a read-only `reviews` command that lists saved ai-review reports.

```bash
npm run dev -- reviews <target-repo>
```

New module: `src/core/reviewHistory.ts` — exports
`buildReviewHistoryReport(targetRepo: string): string[]`.

Behavior:
- Looks in `<target-repo>/.qa-agents/reviews/`.
- Prints the latest report (`latest-ai-review.md`) and timestamped history
  (`ai-review-YYYYMMDD-HHMMSS.md`) sorted newest first.
- If the reviews folder does not exist (or contains no recognized reports),
  prints `No saved reviews found.` plus a hint to run `ai-review --save-report`.
- If `latest-ai-review.md` is missing but timestamped files exist, still lists history.
- Only lists file names — never reads or prints report contents.
- Does not modify any files.

---

## Step 38 — Formalize Automation Generator Agent (completed)

Moved the `generate` command orchestration out of `src/cli/index.ts` into an
agent module, with no behavior change.

New module: `src/agents/automationGeneratorAgent.ts` — exports:

```txt
AutomationGeneratorMode          - 'plan' | 'dry-run' | 'write'
AutomationGeneratorOptions       - { targetRepo, specArg?, dryRun, write, force }
AutomationGeneratorResult        - structured outcome (ok, exitCode, errors,
                                   plan, relatedTests, draft, forceNotice,
                                   writeSuccess, dryRunWriteConflict, mode)
runAutomationGenerator(options)  - loads profile/rules/spec, builds the plan,
                                   detects duplicates, generates the deterministic
                                   draft/code, and performs the controlled write
buildAutomationGeneratorReport(result) - formats the result into stdout lines
```

Architecture boundary reinforced:
- `core/` — reusable helpers (`testGeneration.ts`, `duplicateDetection.ts`).
- `agents/` — use-case orchestration (`automationGeneratorAgent.ts`).
- `cli/` — `index.ts` now only parses flags, calls `runAutomationGenerator`,
  prints the report to stdout, prints `result.errors` to stderr, and exits with
  `result.exitCode`.

Behavior preserved exactly for all modes:
`generate --spec`, `--dry-run`, `--write`, and `--write --force`. Validation
errors, the duplicate-block message, the overwrite guard, the force notice, and
the success/next-step output are unchanged. `extractFirstHeading` moved into the
agent (it was only used by `generate`).

This is the first step of paying down the `src/commands/` split debt — the
generate flow now lives in an agent rather than inline in the CLI.

---

## Step 39 — Formalize Failure Analyzer Agent (completed)

Moved the `analyze-failures` command orchestration out of `src/cli/index.ts`
into an agent module, with no behavior change.

New module: `src/agents/failureAnalyzerAgent.ts` — exports:

```txt
FailureAnalyzerOptions             - { targetRepo }
FailureAnalyzerResult              - { ok, exitCode, errors, runData }
runFailureAnalyzer(options)        - loads .qa-agents/runs/latest-run.json,
                                     returns the parsed run data (or a missing-file error)
buildFailureAnalyzerReport(result) - formats the retry-aware failure report lines
```

Architecture boundary:
- `core/failureAnalyzer.ts` — unchanged reusable classification helpers
  (`cleanMojibake`, `classifyFailure`, `buildRetryContextLines`). No rules moved.
- `agents/failureAnalyzerAgent.ts` — use-case orchestration (load run, assemble report).
- `cli/index.ts` — now only calls `runFailureAnalyzer`, prints the report to
  stdout, prints `result.errors` to stderr, and exits with `result.exitCode`.

Behavior preserved exactly:
- Retry-aware output (retry passed → flaky/intermittent or environment timing;
  retry failed → persistent failure; non-retry unchanged).
- Cleaned failure messages, failure listing, classification, and the
  no-failure / retry no-failure messages.
- Missing `latest-run.json` → stderr error + exit 1.

---

## Step 40 — Harden run data readers (completed)

Commands that read `.qa-agents/runs/latest-run.json` now fail gracefully when
the file is missing, unreadable, or malformed. No schema/run/write changes —
read-side hardening only.

New reusable reader: `src/core/runResults.ts` →
`readLatestRunResultSafe(targetRepo): { ok, data?, error?, reason?, path }`.
It never throws and distinguishes failure modes via `reason`:
`'missing' | 'unreadable' | 'invalid'` (invalid covers malformed JSON and
non-object JSON such as `null`, arrays, or primitives).

Callers updated:
- **analyze-failures** (`failureAnalyzerAgent`):
  - missing → `No latest run result found. Run tests first with qa-agents run.` (exit 1)
  - unreadable/invalid → friendly block (exit 1):
    ```
    Could not read latest run result:
    <path>

    Reason:
    Invalid JSON in latest-run.json.

    Suggested action:
    Run tests again with:
    npm run dev -- run <repo> --suite
    ```
- **report**: uses the safe reader; preserves its existing messages
  (`No latest run result found. Run tests first.` / `Could not read latest run result.`)
  and unchanged successful output.
- **ai-review**: best-effort load — a missing or malformed `latest-run.json`
  no longer affects the review; it continues with `Latest run status: N/A`.

`run --failed` is intentionally left untouched (run behavior unchanged); it
already guards its own read.

---

## Step 41 — Formalize Report Agent (completed)

Moved the `report` command orchestration out of `src/cli/index.ts` into an
agent module, with no behavior change.

New module: `src/agents/reportAgent.ts` — exports:

```txt
ReportAgentOptions             - { targetRepo }
ReportAgentResult              - { ok, exitCode, errors, runData }
runReportAgent(options)        - loads latest-run.json via readLatestRunResultSafe,
                                 returns the parsed run data (or a friendly error)
buildReportAgentOutput(result) - delegates to core buildRunReport for the lines
```

Architecture boundary:
- `core/reportGenerator.ts` — unchanged reusable, retry-aware report formatting
  (`buildRunReport`). No formatting moved.
- `agents/reportAgent.ts` — use-case orchestration (safe load + wire to formatter).
- `cli/index.ts` — now only calls `runReportAgent`, prints the output to stdout,
  prints `result.errors` to stderr, and exits with `result.exitCode`.

Behavior preserved exactly:
- Valid `latest-run.json` → same report output (incl. retry-aware Result section).
- Missing → `No latest run result found. Run tests first.` (exit 1).
- Malformed/unreadable → `Could not read latest run result.` (exit 1), via the
  Step 40 safe reader.

---

## Step 42 — Formalize Test Runner Agent (completed)

Moved the `run` command orchestration out of `src/cli/index.ts` into an agent
module, with no behavior change. This is the largest command and covers all
three modes (`--file`, `--suite`, `--failed`).

New module: `src/agents/testRunnerAgent.ts` — exports:

```txt
TestRunnerAgentOptions             - { targetRepo, fileFlagPresent, relativeTestFile?,
                                       isSuite, isFailed, selectedEnv, selectedTarget, varsFileArg? }
TestRunnerAgentResult              - { ok, exitCode, errors, messages, executed }
runTestRunnerAgent(options)        - full orchestration: mode validation, --failed
                                       source-run load, env/target/vars-file handling,
                                       execution-config usage (or profile testCommand
                                       fallback), process execution, output streaming,
                                       and latest-run.json + retry metadata persistence
buildTestRunnerAgentOutput(result) - returns result.messages for the CLI to print
```

Architecture boundary:
- `core/` — unchanged reusable execution helpers (`envLoader`, `executionConfig`,
  `testRunner.buildRunCommand`, `runResults` parse/save). No low-level logic moved.
- `agents/testRunnerAgent.ts` — use-case orchestration and the actual process run.
- `cli/index.ts` — now only parses the run flags, calls `runTestRunnerAgent`,
  prints returned messages (stdout) / errors (stderr), and exits with
  `result.exitCode`.

Output-stream design: validation failures and the "No failed tests found in
latest run." informational case return structured data without printing, so the
CLI controls those streams. The executed path prints inline (header, loaded env
files, child stdout/stderr, the `Run result saved at:` notice, and the retry
notice) because that output is intrinsically interleaved with the spawned test
process.

Behavior preserved exactly for all three modes:
- Mode validation (exactly one of `--file`/`--suite`/`--failed`).
- `--failed` source-run load, no-failures short-circuit (exit 0), and retry metadata.
- Env/target/vars-file resolution, required-variable checks, and loaded-env-files output.
- execution-config script selection vs. legacy `testCommand` fallback notice.
- Mode-specific headers, command echo, child output streaming, `latest-run.json`
  write, and child exit-code preservation.

---

## Next planned feature

To be determined based on usage feedback from `ai-review --ai`.
- Parse `AiReviewResponse.additionalFindings` from the response.
- Append them to the report after the deterministic findings section.
