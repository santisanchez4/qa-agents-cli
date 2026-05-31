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
init-rules [path]
env-check [path] --env <env> --target <target> [--vars-file <file>]
discover-envs [path]
run [path] --file <file> [--env <env>] [--target <target>] [--vars-file <file>]
run [path] --suite [--env <env>] [--target <target>] [--vars-file <file>]
run [path] --failed [--env <env>] [--target <target>] [--vars-file <file>]
analyze-failures [path]
report [path]
ai-config [path]
ai-review [path] --file <file> [--ai] [--save-report]
reviews [path]
doctor [path]
capabilities [path]
capability-check [path] [--script <script>]
normalize-spec [path] --input <file> --id <id>
import-spec [path] --provider <provider> --id <external-id>
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
  - Secrets / API keys
- Reports **cloud execution variables** in a separate `Cloud execution:` section,
  grouped by provider (LambdaTest, BrowserStack, Unknown cloud-related). See
  [Cloud execution variable detection](#cloud-execution-variable-detection).
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

Layer roles:
- `cli/` — argument parsing and dispatch only. Each command parses flags, calls
  the matching agent (or a core diagnostic), prints stdout/stderr, and exits with
  the agent's exit code.
- `agents/` — use-case orchestration (one flow per command).
- `core/` — reusable logic, helpers, templates, and AI providers. No command
  orchestration.

```txt
src/
  cli/
    index.ts              - argument parsing and dispatch
    help.ts               - printHelp()

  core/
    projectScanner.ts     - repo analysis (scanProject)
    executionConfig.ts    - ExecutionConfig types, buildExecutionConfig, classifyTestScript
    envLoader.ts          - parseEnvFile, loadEnvOverlay, isVarSet
    testRunner.ts         - buildRunCommand, RunCommand type
    runResults.ts         - LatestRunData types, parsePlaywrightSummary, parseFailedTests,
                            saveLatestRun, readLatestRunResultSafe
    failureAnalyzer.ts    - classifyFailure, cleanMojibake, buildRetryContextLines
    duplicateDetection.ts - detectRelatedTests
    testGeneration.ts     - buildAutomationPlan, buildTestCode, buildDeterministicTestDraft,
                            detectExistingPatterns, collectSpecFiles
    textSanitizer.ts      - stripAnsi, cleanText, normalizeErrorType
    reportGenerator.ts    - buildRunReport
    repoRulesTemplate.ts  - buildRepoRulesTemplate
    reviewRules.ts        - deterministic review checks (checkStability, checkSelectors, ...)
    reviewReportWriter.ts - saveAiReviewReport
    reviewHistory.ts      - buildReviewHistoryReport
    aiConfigReport.ts     - buildAiConfigReport
    aiProvider.ts         - AiProvider types, createDisabledAiProvider, REVIEW_SYSTEM_MESSAGE
    aiProviderResolver.ts - resolveAiProvider (env-driven provider selection)
    reviewerPromptBuilder.ts - buildReviewerPrompt
    cloudVars.ts          - cloud-var detection (classifyCloudVar, collectCloudVars);
                            shared by discover-envs and doctor
    specNormalizer.ts     - deterministic spec parsing (normalizeId, extractTitle,
                            extractSteps, extractExpectedResults, parseSpec)
    specTemplate.ts       - buildSpecMarkdown (standardized internal spec)
    specFileWriter.ts     - writeSpecFile (.qa-agents/specs/, refuses overwrite)
    providers/            - openAi, anthropic, gemini, deepSeek provider factories
    connectors/           - generic work-item connector interface (Step 60):
                            workItemConnector (types/interface),
                            disabledWorkItemConnector, workItemConnectorResolver

  agents/
    automationReviewerAgent.ts  - runAiReview, runAiLayer, buildAiReviewReport
    automationGeneratorAgent.ts - runAutomationGenerator, buildAutomationGeneratorReport
    failureAnalyzerAgent.ts     - runFailureAnalyzer, buildFailureAnalyzerReport
    reportAgent.ts              - runReportAgent, buildReportAgentOutput
    testRunnerAgent.ts          - runTestRunnerAgent, buildTestRunnerAgentOutput
    repoAnalystAgent.ts         - runRepoAnalyst, buildRepoAnalystReport
    executionConfigAgent.ts     - runInitConfigAgent/buildInitConfigReport,
                                  runEnvCheckAgent/buildEnvCheckReport,
                                  runDiscoverEnvsAgent/buildDiscoverEnvsReport
    suiteInspectorAgent.ts      - runSuiteInspector, buildSuiteInspectorReport
    repoRulesAgent.ts           - runRepoRulesAgent, buildRepoRulesReport
    doctorAgent.ts              - runDoctorAgent, buildDoctorReport
    capabilitiesAgent.ts        - runCapabilitiesAgent, buildCapabilitiesReport
    capabilityCheckAgent.ts     - runCapabilityCheckAgent, buildCapabilityCheckReport
    specNormalizerAgent.ts      - runSpecNormalizerAgent, buildSpecNormalizerReport
    importSpecAgent.ts          - runImportSpecAgent, buildImportSpecReport
```

All command flows now live in the agent layer (`automationGeneratorAgent.ts`, `failureAnalyzerAgent.ts`, `reportAgent.ts`, `testRunnerAgent.ts`, `repoAnalystAgent.ts`, `executionConfigAgent.ts`, `suiteInspectorAgent.ts`, `repoRulesAgent.ts`, plus the AI `automationReviewerAgent.ts`). `src/cli/index.ts` is now argument parsing + agent dispatch only.

---

## Remaining technical debt

Resolved (Steps 38–46). The original debt — splitting `src/cli/index.ts` command
blocks into separate modules — was paid down by extracting each command's
orchestration into the `src/agents/` layer instead of a parallel `src/commands/`
folder. `src/cli/index.ts` is now argument parsing + agent dispatch only.

See the module structure above for the per-command agent mapping.

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

## Step 43 — Formalize Repo Analyst Agent (completed)

Moved the `analyze` command orchestration out of `src/cli/index.ts` into an
agent module, with no behavior change.

New module: `src/agents/repoAnalystAgent.ts` — exports:

```txt
RepoAnalystOptions             - { targetRepo, save }
RepoAnalystResult              - { ok, exitCode, errors, profile, savedPath }
runRepoAnalyst(options)        - runs scanProject and, with --save, ensures
                                 .qa-agents exists and writes project-profile.json
buildRepoAnalystReport(result) - formats the analysis (and save notice) lines
```

Architecture boundary:
- `core/projectScanner.ts` — unchanged, generic, reusable detection (language,
  frameworks, package manager, test command, scripts, important files, structure).
  No detection logic moved.
- `agents/repoAnalystAgent.ts` — use-case orchestration (scan + optional save).
- `cli/index.ts` — now only parses the path and `--save`, calls `runRepoAnalyst`,
  prints the report to stdout, errors to stderr, and exits with `result.exitCode`.

Behavior preserved exactly:
- `analyze <repo>` → `QA Agents - Repo Analysis` header + the same JSON profile.
- `analyze <repo> --save` → additionally creates `.qa-agents/` if needed, writes
  `project-profile.json` (same schema/content), and prints `Project profile saved at:`.
- The old local `saveProjectProfile` helper was removed from the CLI (folded into the agent).

---

## Step 44 — Formalize Execution Config Agent (completed)

Moved the three execution-configuration command flows out of `src/cli/index.ts`
into a single agent module, with no behavior change.

New module: `src/agents/executionConfigAgent.ts` — exports three run/build pairs:

```txt
InitConfigOptions / InitConfigResult
runInitConfigAgent(options)        - builds .qa-agents/execution-config.json from
                                     detected scripts; refuses to overwrite an existing one
buildInitConfigReport(result)      - "Execution config created: <path>" on success

EnvCheckOptions / EnvCheckResult
runEnvCheckAgent(options)          - validates config/env/target, loads the env overlay,
                                     checks required vars (SET/MISSING — never values),
                                     returns the report and READY/NOT READY exit code
buildEnvCheckReport(result)        - returns the env-check report lines

DiscoverEnvsOptions / DiscoverEnvsResult
runDiscoverEnvsAgent(options)      - discovers .env* files, inferred environments,
                                     variable groups, and execution targets (keys only)
buildDiscoverEnvsReport(result)    - returns the discovery report lines
```

Architecture boundary:
- `core/executionConfig.ts` (`buildExecutionConfig`, `classifyTestScript`) and
  `core/envLoader.ts` (`parseEnvFile`, `loadEnvOverlay`, `isVarSet`) remain the
  reusable helpers. No low-level logic moved.
- `agents/executionConfigAgent.ts` — orchestration for all three commands. The
  discover-envs internals (`buildDiscoverReport`, `categorizeVar`, and the
  `DISCOVER_*` heuristics) moved here verbatim from the CLI.
- `cli/index.ts` — now only parses args, calls the matching run function, prints
  the report (stdout) / errors (stderr), and exits with `result.exitCode`.

Behavior preserved exactly:
- init-config: missing profile / existing config → stderr + exit 1; success →
  `Execution config created:` (exit 0). execution-config.json schema unchanged.
- env-check: same validation order and messages, SET/MISSING only (no secret
  values), and READY → exit 0 / NOT READY → exit 1.
- discover-envs: same discovery output; missing profile prints the stdout notice
  and still produces the report (exit 0).

---

## Step 45 — Formalize Suite Inspector Agent (completed)

Moved the `inspect` command orchestration out of `src/cli/index.ts` into an
agent module, with no behavior change.

New module: `src/agents/suiteInspectorAgent.ts` — exports:

```txt
SuiteInspectorOptions             - { targetRepo }
SuiteInspectorResult              - { ok, exitCode, errors, profile, targetRepo }
runSuiteInspector(options)        - loads project-profile.json (missing → error + exit 1)
buildSuiteInspectorReport(result) - lists spec files grouped by folder, support
                                    folders, and execution modes from package scripts
```

Architecture boundary:
- `core/` — unchanged reusable helpers (`collectSpecFiles`, `classifyTestScript`).
- `agents/suiteInspectorAgent.ts` — orchestration plus the inspect-specific
  helpers that previously lived in the CLI (`detectSupportFoldersInDir` and the
  `INSPECT_SUPPORT_FOLDER_NAMES` set moved here verbatim).
- `cli/index.ts` — now only calls `runSuiteInspector`, prints the report to
  stdout, errors to stderr, and exits with `result.exitCode`.

Behavior preserved exactly:
- Same `QA Agents - Suite Inspector` report (profile summary, spec files grouped
  by folder, support folders, execution modes, recommended next commands).
- Missing project profile → `Missing project profile. Run analyze --save first.`
  (stderr, exit 1).

All command flows except `init-rules` now live in agents.

---

## Step 46 — Formalize Repo Rules Agent (completed)

Moved the `init-rules` command orchestration out of `src/cli/index.ts` into an
agent module, with no behavior change. This was the last inline command.

New module: `src/agents/repoRulesAgent.ts` — exports:

```txt
RepoRulesOptions             - { targetRepo }
RepoRulesResult              - { ok, exitCode, errors, rulesPath, created }
runRepoRulesAgent(options)   - ensures .qa-agents exists; writes repo-rules.md
                               from buildRepoRulesTemplate() only if absent (never overwrites)
buildRepoRulesReport(result) - "Created repo rules file:" / "Repo rules file already exists:" + path
```

Architecture boundary:
- `core/repoRulesTemplate.ts` — unchanged reusable template (`buildRepoRulesTemplate`).
  No template content moved.
- `agents/repoRulesAgent.ts` — orchestration (ensure dir, conditional write).
- `cli/index.ts` — now only calls `runRepoRulesAgent`, prints the report, and
  exits with `result.exitCode`.

Behavior preserved exactly:
- Existing `repo-rules.md` → `Repo rules file already exists:` + path, file untouched.
- Missing → `Created repo rules file:` + path, written from the template.

With this step, **every** command flow lives in the agent layer; `src/cli/index.ts`
is argument parsing + agent dispatch only. The original `src/commands/` split debt
is resolved via agents.

---

## Step 47 — Final architecture cleanup (completed)

A safe verification/cleanup pass after all command flows moved to agents. **No
behavior changed** — no command output, exit code, schema, provider behavior, or
generated content was modified.

Findings and actions:
- `src/cli/index.ts` — already clean. Verified it is parse + dispatch only: every
  import is used, the only helper (`readFileIfExists`) is still used by the
  `ai-review` context build, and no dead code remains. No changes.
  (Per-command stdout uses each command's original leading-newline convention;
  these were intentionally left untouched to preserve exact output.)
- `src/agents/*.ts` — naming is already consistent (`runXAgent`/`run...` +
  `buildXReport`/`buildXOutput`). Automated scan found no unused named or default
  imports. No changes.
- `src/core/*.ts` — every "externally unused" export flagged by scanning is in
  fact referenced inside its own file (return-type annotations, schema
  composition like `RunSummary`, or internal calls like `detectExistingPatterns`).
  Nothing was definitely dead, so no exports were removed (avoids churn/risk).
- `help.ts` — confirmed all 13 commands and their flags are listed accurately.
  No changes.
- `CLAUDE.md` — updated the architecture section: documented the cli/agents/core
  layer roles, corrected the `cli/index.ts` description to "argument parsing and
  dispatch", and completed the `core/` module list (AI providers, review/report
  helpers) that earlier steps had added but not listed.

Net: documentation-only updates. `npx tsc --noEmit` passes; smoke tests
(`analyze`, `inspect`, `report`, `reviews`, `ai-config`, `ai-review`) match
pre-cleanup output.

---

## Step 48 — Unit tests (Vitest) (completed)

Added a minimal, deterministic test setup for the most important pure logic.
No command behavior or output format changed.

Tooling:
- Dev dependency: `vitest`.
- Scripts: `npm test` → `vitest run`, `npm run test:watch` → `vitest`,
  `npm run typecheck` → `tsc --noEmit` (src), `npm run typecheck:tests` →
  `tsc --noEmit -p tests/tsconfig.json`, `npm run validate` →
  `typecheck && typecheck:tests && test` (`dev` unchanged).
- Tests live in `tests/unit/` and import directly from `src/core/*`. Vitest
  transpiles TS via esbuild; the root `tsconfig.json` still includes only `src/`,
  so `npx tsc --noEmit` is unaffected. `tests/tsconfig.json` (extends the root,
  `noEmit`) typechecks the test files for the editor and the
  `typecheck:tests` script.

Coverage (20 tests, 4 files):
- `textSanitizer.test.ts` — `stripAnsi` removes ANSI codes; `cleanText` strips +
  collapses + trims; `normalizeErrorType` maps toHaveURL → URLAssertionError,
  timeout+locator → LocatorTimeoutError, timeout+navigation →
  NavigationTimeoutError, 401/403 → AuthorizationError, else keeps original.
- `aiConfigReport.test.ts` — no provider → disabled / not configured; unsupported
  provider → unsupported message; deepseek + `DEEPSEEK_API_KEY` → configured /
  API key SET; asserts the key value is never printed. Snapshots and restores
  `process.env` per test (no real keys, no provider calls).
- `repoRulesTemplate.test.ts` — template includes all required sections and
  contains no project-specific names (warzone/intermex).
- `reviewReports.test.ts` — `saveAiReviewReport` writes `latest-ai-review.md` +
  a timestamped copy with identical content; `buildReviewHistoryReport` lists
  history newest-first, handles the missing folder, and ignores unrelated files.
  Uses `os.tmpdir()` temp repos, cleaned up after each test.

No Playwright runs, no AI provider calls, no target-repo writes (temp dirs only).

---

## Step 49 — doctor command (completed)

Added a read-only health-check command:

```bash
npm run dev -- doctor <target-repo>
```

New agent: `src/agents/doctorAgent.ts` — exports `DoctorAgentOptions`,
`DoctorAgentResult`, `runDoctorAgent(options)`, `buildDoctorReport(result)`.

Diagnostics only — **does not modify files, run Playwright, or call AI
providers**, and never prints secrets.

Checks performed:
- Target repo exists (directory).
- `package.json` found.
- `.qa-agents/project-profile.json` exists and is valid JSON (also source of
  spec-file count and tests directory).
- `.qa-agents/repo-rules.md` exists.
- `.qa-agents/execution-config.json` exists.
- `.qa-agents/runs/latest-run.json` via `readLatestRunResultSafe`
  (OK + last-run status / WARN if missing / FAIL if invalid).
- AI config status via `buildAiConfigReport` (configured | not configured |
  disabled) — no API key values printed.
- Spec files count (from the project profile).

Overall status rules:
- `NOT READY` if the target repo does not exist.
- `PARTIAL` if `project-profile.json` (missing/invalid) or
  `execution-config.json` is missing.
- `READY` if both exist (and the repo is readable).
- Missing `repo-rules.md` is a Warning (does not block). AI not configured is
  Info (does not block).

Output: header, target repo, overall status, the checks block, numbered
findings (severity + recommendation), and a recommended-next-commands block.
Reuses `readLatestRunResultSafe` and `buildAiConfigReport`. Exit code 0
(diagnostics only).

Unit tests: `tests/unit/doctorAgent.test.ts` (temp dirs only) cover missing repo
→ NOT READY, package.json-only → PARTIAL, profile-without-exec-config → PARTIAL,
both present → READY, invalid latest-run.json → FAIL/Error, and the report shape.

---

## Step 50 — validate script (completed)

Added a single pre-commit validation script.

```bash
npm run validate
```

Scripts added to `package.json` (existing scripts unchanged):
- `typecheck` → `tsc --noEmit` (src typecheck).
- `validate` → `npm run typecheck && npm run typecheck:tests && npm test`.

`validate` runs, in order: the `src/` type check, the test type check
(`tests/tsconfig.json`), and the Vitest unit tests. It fails fast on the first
non-zero step. **Recommended before commits.** Diagnostics only — it does not
modify files, run Playwright, or call AI providers.

---

## Step 51 — GitHub Actions CI (completed)

Added `.github/workflows/ci.yml` — a simple CI workflow that validates the CLI.

- Name: `CI`. Triggers: `push` and `pull_request`.
- Single `validate` job on `ubuntu-latest`, Node.js 22, with npm cache.
- Steps: checkout → setup-node → `npm ci` → `npm run validate`.

CI runs only `npm run validate` (src typecheck, tests typecheck, unit tests).
It uses **no secrets**, does **not** call AI providers, does **not** run
Playwright tests, and does **not** require any target repo (e.g. warzone-ui).

---

## Step 52 — CLAUDE.md update reminder hook (completed)

Added a lightweight, **non-blocking** Claude Code hook that reminds you to update
CLAUDE.md when important project files changed but CLAUDE.md did not.

Files:
- `scripts/claude/check-claude-md.ps1` — PowerShell (Windows-friendly). Detects
  both **tracked modifications** (`git diff --name-only HEAD`) and **brand-new
  untracked files** (`git status --porcelain --untracked-files=all`, `??` lines).
  If important files changed and `CLAUDE.md` is not among the changes (whether
  modified or newly untracked), it prints a short reminder listing those files.
  It **never edits files and always exits 0**, so it cannot block or fail the
  session. Important paths: `src/agents/*`, `src/core/*`, `src/cli/help.ts`,
  `src/cli/index.ts`, `package.json`, `package-lock.json`, `tests/*`,
  `.github/workflows/*`.
- `.claude/settings.json` — registers the script as a `Stop` hook:
  `powershell -ExecutionPolicy Bypass -File scripts/claude/check-claude-md.ps1`.
  (`.claude/settings.local.json` permissions are left untouched.)

Behavior: reminder only when important files changed AND CLAUDE.md was not;
silent when CLAUDE.md was changed, when only non-important files changed, or when
nothing changed. Advisory only — it does not block the workflow or auto-edit
anything.

---

## Cloud execution variable detection

The shared detection logic lives in `src/core/cloudVars.ts` (`classifyCloudVar`,
`collectCloudVars`) and is used by both `discover-envs` and `doctor`.

`discover-envs` detects **real** cloud-grid credential variable *names* from the
target repo, grouped by provider, without inventing names or printing values.

Sources scanned (names only — values are never read or printed):
- `.env*` keys.
- `package.json` scripts that reference env vars (`$VAR`, `${VAR}`, `%VAR%`,
  `process.env.VAR`).
- `playwright.config.*` (`.ts/.js/.mjs/.cjs`) env-var references.
- `.qa-agents/execution-config.json` `requiredEnv` arrays (environments + targets).

Provider classification (`classifyCloudVar`):
- LambdaTest — names starting with `LT_` or `LAMBDATEST` (e.g. `LT_USERNAME`,
  `LT_ACCESS_KEY`, `LAMBDATEST_KEY`, `LT_GRID_URL`).
- BrowserStack — names containing `BROWSERSTACK`.
- Unknown cloud-related — other cloud-grid signals (`SAUCE`, `SAUCELABS`,
  `SELENIUM`, `GRID`, `HUB`, word-bounded to avoid false matches like `GITHUB`).

Output (only when at least one cloud variable is found):

```txt
Cloud execution:
LambdaTest:
- LT_USERNAME
- LT_ACCESS_KEY

BrowserStack:
- BROWSERSTACK_USERNAME
- BROWSERSTACK_ACCESS_KEY

Unknown cloud-related:
- <REAL_VAR_NAME>
```

Cloud variables are listed only in this section (excluded from the normal
Variable groups). Repos with no cloud variables show no `Cloud execution:`
section — normal env detection is unchanged. This step does not modify any
config files and does not change `env-check`.

---

## Step 54 — Cloud variable discovery (completed)

Improved `discover-envs` cloud detection (`src/agents/executionConfigAgent.ts`).
Previously only four hardcoded names (`LT_USERNAME`, `LT_ACCESS_KEY`,
`BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`) were recognized as cloud
vars. Now real cloud variable names are detected from `.env*`, package.json
scripts, `playwright.config.*`, and `execution-config.json` `requiredEnv`, and
grouped by provider. See [Cloud execution variable detection](#cloud-execution-variable-detection).

No values are ever printed, no names are invented, normal env grouping is
unchanged, and `execution-config.json` / `env-check` are untouched. Unit tests:
`tests/unit/discoverEnvsCloud.test.ts` (temp dirs) cover LambdaTest/BrowserStack/
unknown detection, execution-config sourcing, and that values never appear.

---

## Step 55 — doctor cloud-target diagnostics (completed)

`doctor` now uses the Step 54 cloud-variable signal. The detection logic was
extracted from `executionConfigAgent` into `src/core/cloudVars.ts` and is now
shared by both `discover-envs` and `doctor` (no duplication).

`doctor` (`src/agents/doctorAgent.ts`):
- Detects cloud-execution variables in the repo (names only) via `collectCloudVars`.
- Inspects `execution-config.json` targets for a likely cloud target name
  (`lambda`, `lambdatest`, `cloud`, `browserstack`, `bs`, `remote`, or any name
  containing `lambda`/`browserstack`/`cloud`/`remote`).
- When cloud variables are found, adds a `- Cloud variables: <Provider (n)>` line
  (with `— no cloud target configured` suffix when applicable).
- If cloud variables are found but **no** cloud target exists, adds a **Warning**
  finding: *"Cloud execution variables found, but no cloud target is configured."*
  with a recommendation listing the detected variable **names** (e.g.
  `LT_USERNAME, LT_ACCESS_KEY`).

Constraints: never prints variable values, never modifies `execution-config.json`,
never auto-creates targets, runs no tests. The warning is advisory only — it does
**not** change readiness (a repo with valid `project-profile.json` +
`execution-config.json` stays READY). Repos without cloud variables show no
Cloud variables line and no warning.

Unit tests: `tests/unit/doctorAgent.test.ts` cover cloud vars without a target →
Warning, cloud vars with a `lambda` target → no warning, readiness stays READY,
no cloud line when no cloud vars, and that values are never printed.

---

## Step 56 — capabilities command (completed)

Added a read-only `capabilities` command:

```bash
npm run dev -- capabilities <target-repo>
```

New agent: `src/agents/capabilitiesAgent.ts` — exports `CapabilitiesAgentOptions`,
`CapabilitiesAgentResult`, `runCapabilitiesAgent(options)`,
`buildCapabilitiesReport(result)`.

Purpose: detect what automation/QA capabilities a target repo already supports,
so future agents can orchestrate existing scripts instead of duplicating them.

Inspects (read-only): `package.json` scripts (falls back to
`project-profile.json` `packageScripts` when no package.json),
`.qa-agents/execution-config.json` targets.

Classifies each script name into a single group (priority order, first match):
Test generation (`tc:*`, `generate`) → AI / automation (`ai` segment, `agent`,
`codex`, `claude`, `gpt`) → Cloud/grid (`lambda`, `lambdatest`, `browserstack`,
`cloud`, `remote`) → Test data / seed (`seed`, `data`, `setup`) → Reports
(`allure`, `report`) → Test execution (`test`, `test:*`, `e2e`, `smoke`,
`regression`). Cloud targets from execution-config are added as `target: <name>`.

Output: per-group repo capabilities (only non-empty groups), a fixed list of
qa-agents native capabilities (analyze, inspect, doctor, generate, ai-review,
run, report, reviews, env-check, discover-envs, init-config, init-rules), and a
recommended-strategy block (prefers orchestrating existing generation scripts
when present). If no package.json exists, prints a friendly warning and still
lists qa-agents capabilities.

Read-only: never executes scripts, modifies files, prints script command values
(names only), or calls AI providers. Unit tests:
`tests/unit/capabilitiesAgent.test.ts`.

---

## Step 57 — capabilities strategy recommendations (completed)

Improved the `Recommended strategy` section of `capabilities` so it helps
qa-agents-cli decide whether to use repo-native scripts or qa-agents native
commands. Capability detection from Step 56 is unchanged; only the strategy
output is richer. Still read-only.

Strategy rules (driven by the detected signals):
- **Repo-native generation present** (`tc:*`, `generate`, …): prefer orchestrating
  repo-native generation; use `qa-agents generate` only when no repo generator
  fits; use `qa-agents ai-review` after generation.
- **No repo-native generation**: use `qa-agents generate` for deterministic draft
  generation; use `qa-agents ai-review` to review generated/existing tests.
- **Cloud/grid detected** (cloud script or execution-config target): prefer
  `qa-agents run` with the detected cloud target (named when known) for repos
  that require VPN or remote browsers.
- **Cloud variables but no cloud target** (via `collectCloudVars`, names only):
  recommend adding a cloud target to `execution-config.json` first.
- **Test execution scripts present**: use `qa-agents run`/`report`/
  `analyze-failures` for the execution lifecycle.
- **No package.json**: recommend initializing/verifying the repo and running
  `qa-agents analyze --save` once package metadata exists (generation guidance is
  skipped in this case).

Unit tests in `tests/unit/capabilitiesAgent.test.ts` cover each branch. No
secrets are printed (cloud detection reads variable names only).

---

## Step 58 — capability-check command (completed)

Added a read-only, **static-analysis** command that evaluates repo-native QA
automation scripts by EVIDENCE (not exact names) and judges whether they look
usable/safe to orchestrate:

```bash
npm run dev -- capability-check <target-repo> [--script <script-name>]
```

New agent: `src/agents/capabilityCheckAgent.ts` — exports
`CapabilityCheckOptions`, `CapabilityCheckResult`, `runCapabilityCheckAgent`,
`buildCapabilityCheckReport`.

Detects candidates by evidence from: package.json scripts (name + command
signals like `tc`, `generate`, `automation`, `playwright`, `ai`, scripts/ path
references), generator-like files under `scripts/` that no package script
references, and soft signals from README / repo-rules ("generate test", "test
case", …).

Each candidate is classified:
- **Type**: Test generation / Test execution / AI automation / Test data / seed /
  Reporting / Unknown QA capability.
- **Confidence**: High / Medium / Low.
- **Safety**: Safe to inspect / Needs manual review / Potentially unsafe to
  execute automatically. Unsafe when the command contains destructive/deploy
  tokens (`rm`, `del`, `delete`, `clean`, `deploy`, `publish`, `release`, `prod`,
  `migrate`, `write`, …); test-execution and dry-run/check/list scripts are Safe;
  generation/AI without a dry-run flag → Needs manual review.

Modes:
- `--script <name>`: analyzes only that script; if missing, prints a friendly
  "Script not found" + closest candidates (Levenshtein) and exits 1.
- no flag: analyzes all candidates. If none, prints the native fallback
  (`generate`, `ai-review`, `run`, `report`).

Output also includes a `Recommended orchestration:` block. Read-only: never
executes scripts, modifies files, calls AI providers, or echoes raw command
values (so secrets in commands are never printed). Unit tests:
`tests/unit/capabilityCheckAgent.test.ts`.

---

## Step 59 — Spec Intake / Normalizer (completed)

Added a local, deterministic Spec Intake / Normalizer that converts a local
input file into a standardized internal spec under the target repo:

```bash
npm run dev -- normalize-spec <target-repo> --input <file> --id TC-12345
```

Output: `<target-repo>/.qa-agents/specs/TC-<number>.md`.

Files added:
- `src/core/specNormalizer.ts` — pure parsing: `normalizeId` (`12345` / `TC-12345`
  / `tc_12345` / `TC12345` → `TC-12345`; invalid → null), `extractTitle`,
  `extractSteps`, `extractExpectedResults`, `extractSummary`, `parseSpec`. Strips
  a leading UTF-8 BOM so Windows-created files parse correctly.
- `src/core/specTemplate.ts` — `buildSpecMarkdown` (Metadata / Summary /
  Preconditions / Steps / Expected Results / Notes / Raw Input).
- `src/core/specFileWriter.ts` — `writeSpecFile` (creates `.qa-agents/specs/`,
  refuses to overwrite).
- `src/agents/specNormalizerAgent.ts` — `runSpecNormalizerAgent` (async),
  `buildSpecNormalizerReport`.
- Tests: `tests/unit/specNormalizer.test.ts`, `tests/unit/specNormalizerAgent.test.ts`.

Parsing (first version, deterministic): title = first heading → first non-empty
line → `Untitled Spec`; steps = numbered lines (`1.`, `2)`) and `Step:`/`Action:`
lines (else `TBD`); expected results = `Expected:` / `Expected Result:` /
`Then` lines (else `TBD`); original input preserved under `Raw Input`.

Validation/errors (each exits non-zero with a friendly message): missing target
repo / `--input` / `--id`, invalid id, target repo path missing, input file
missing, unsupported extension (only `.md`/`.txt`), and refuses to overwrite an
existing normalized spec.

Safety: local-only and deterministic — no AI, no network, no Playwright, no
external connectors (Azure/Jira/Trello are out of scope for this step). It does
not modify the input or any other repo files beyond writing the new spec, and
tests use temp dirs only.

---

## Step 60 — Generic Work Item Connector Interface (completed)

Added the architecture (interface only — **no real network/API logic**) for
importing external work items from providers like Azure DevOps, Jira, or Trello:

```bash
npm run dev -- import-spec <target-repo> --provider <provider> --id <external-id>
```

Files added:
- `src/core/connectors/workItemConnector.ts` — provider-agnostic types and the
  `WorkItemConnector` interface (`WorkItemProviderName`, `WorkItemStep`,
  `WorkItemPayload`, `WorkItemImportRequest`, `WorkItemImportResponse`).
- `src/core/connectors/disabledWorkItemConnector.ts` —
  `createDisabledWorkItemConnector()`: `isConfigured()` false; `importWorkItem()`
  returns `{ ok: false, reason: 'not_implemented', error: '…not implemented…' }`.
- `src/core/connectors/workItemConnectorResolver.ts` — `resolveWorkItemConnector`
  (case-insensitive; supported: `azure`, `jira`, `trello`, `disabled`). Step 60:
  every supported provider resolves to the disabled connector while preserving
  the requested provider name; unsupported → friendly error. No env vars read.
- `src/agents/importSpecAgent.ts` — `runImportSpecAgent` (async),
  `buildImportSpecReport`.
- Tests: `tests/unit/workItemConnector.test.ts`, `tests/unit/importSpecAgent.test.ts`.

Behavior (Step 60): all providers report `Status: Not implemented yet.` (exit 0,
no spec file written). Validation errors exit non-zero: missing target repo /
`--provider` / `--id`, unsupported provider, target repo path missing.

Extension point for Step 61: `runImportSpecAgent` already calls the connector via
the interface; when a real connector returns `response.ok` with a `payload`, the
documented `response.ok` branch converts that `WorkItemPayload` into a spec using
the existing Step 59 flow (`specTemplate.buildSpecMarkdown` +
`specFileWriter.writeSpecFile`, `specNormalizer.normalizeId`) to produce
`<target-repo>/.qa-agents/specs/TC-<id>.md` — without duplicating the normalizer.

Safety: no Azure/Jira/Trello HTTP, no network, no AI, no Playwright, no env-var
reads, and no secrets printed. Tests use temp dirs only and make no external
calls.

---

## Next planned feature

To be determined based on usage feedback from `ai-review --ai`.
- Parse `AiReviewResponse.additionalFindings` from the response.
- Append them to the report after the deterministic findings section.
