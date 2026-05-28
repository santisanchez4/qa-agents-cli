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
<target-repo>/.qa-agents/specs/
```

Any behavior discovered during lab testing must be generalized before being added to the CLI logic. If it only makes sense for one project, it belongs in that project's `.qa-agents/` files — not here.

---

## Lab projects

`warzone-ui` is currently used only to validate the CLI against a real project.

It is a laboratory, not a first-class target. The CLI must work equally well against any repo with a compatible structure.

Warzone-specific rules live exclusively in:

```txt
C:\Repos\warzone-ui\.qa-agents\repo-rules.md
```

They must never be copied or replicated into `qa-agents-cli` source code.

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

### Run a specific test file

```bash
npm run dev -- run <target-repo> --file <test-file>
```

Loads the project profile, detects the test command, and runs the specified test file from inside the target repo.

For `npm run` commands:

```bash
npm run test:e2e -- <test-file>
```

For direct commands:

```bash
npx playwright test <test-file>
```

Streams stdout/stderr directly. Exits with the same code as the test process.

---

## Example only

> These examples use `warzone-ui` as the lab project. Replace with any compatible target repo.

```bash
npm run dev -- analyze C:\Repos\warzone-ui --save

npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md --dry-run

npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md --write

npm run dev -- run C:\Repos\warzone-ui --file tests/e2e/auth/login.spec.ts
```

> **Important:** Do not run qa-agents commands from inside the target repo using that repo's own `npm run dev`. For warzone-ui, `npm run dev` starts Next.js.
>
> Always run from the `qa-agents-cli` directory:
>
> ```bash
> cd C:\Users\Santiago\qa-agents-cli
> npm run dev -- generate C:\Repos\warzone-ui --spec .qa-agents/specs/login-smoke.md
> ```

---

## Current implemented behavior

```txt
analyze
analyze --save
generate --spec
generate --spec --dry-run
generate --spec --write
generate --spec --write --force
run --file
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
login / sign-in  -> auth, login
register / sign-up -> auth, register, registration
tournament       -> tournament, tournaments
team             -> team, teams
wallet           -> wallet
admin            -> admin
support          -> support
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

The `run` command:

1. Loads `<target-repo>/.qa-agents/project-profile.json`
2. Validates the test file exists on disk
3. Reads `testCommand` from the profile
4. Inserts `--` before the file path for `npm run` commands
5. Runs via `spawnSync` with `shell: true` and `cwd` set to the target repo
6. Streams stdout/stderr directly (`stdio: 'inherit'`)
7. Exits with the child process's exit code

Self-healing is not implemented yet and must come later, after the runner is stable.
