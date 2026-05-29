export function buildRepoRulesTemplate(): string {
  return `# QA Agents Repo Rules

## Project context
Describe what this project is and what the main automation goals are.

Example:
- This is a web application tested with Playwright.
- Automation covers smoke, regression, and critical user flows.
- E2E tests validate the full user journey from login through key features.

---

## Test organization
Describe where tests live and how they are grouped.

Example:
- Tests live under tests/e2e and are grouped by feature area.
- Each feature folder contains spec files for that domain.
- Shared helpers and fixtures live in tests/helpers and tests/fixtures.

---

## Selector strategy
Describe preferred selectors for this project.

Example:
- Prefer user-facing Playwright locators.
- Prefer getByRole, getByLabel, getByText, getByPlaceholder.
- Use data-testid only when user-facing locators are not stable.
- Avoid brittle CSS class selectors and XPath.
- Do not use nth-child or positional selectors.

---

## Environment variables
List required environment variables and their purpose.
Do not include secret values in this file.

Example:
- E2E_EMAIL — test user email address
- E2E_PASSWORD — test user password
- BASE_URL — base URL for the test environment (set per environment)

---

## Test data rules
Describe what test users and data should be used.
Mention which data must not be hardcoded.

Example:
- Use dedicated E2E test accounts that are isolated from production data.
- Do not hardcode credentials in test files. Load them from environment variables.
- Do not modify shared test data that other tests depend on.
- Do not depend on data created by a previous test run.

---

## Critical flows
List the most important flows that must always have automation coverage.

Example:
- User login and logout
- Account creation and profile update
- Core feature interaction (describe your main feature here)
- Error handling for invalid inputs

---

## Stability rules
Describe how tests should handle timing and asynchronous behavior.

Example:
- Avoid waitForTimeout unless the wait is explicitly documented and justified.
- Avoid waitUntil: networkidle when the app uses polling or WebSockets.
- Prefer waiting for a specific visible UI element instead of a fixed delay.
- Prefer explicit UI assertions after each action.
- Use Playwright's built-in retry-ability (expect) rather than manual sleep.

---

## Do not do
List things that tests must never do.

Example:
- Do not hardcode credentials in test files.
- Do not hardcode environment URLs. Use process.env.BASE_URL or playwright.config.ts baseURL.
- Do not run tests that modify production or shared staging data.
- Do not generate tests that depend on the execution order of other tests.
- Do not use console.log for debugging in committed test code.

---

## Notes for AI reviewer
Provide project-specific review preferences and constraints for the AI-assisted reviewer.

Example:
- Flag any test that navigates directly to a hardcoded URL.
- Flag login helper duplication — this project uses a shared login fixture.
- Flag tests that do not assert a meaningful UI state after the main action.
- This project uses Page Object Model — flag tests that bypass the page layer.
`;
}
