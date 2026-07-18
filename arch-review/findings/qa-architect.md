# Architecture Review: Quality Assurance & Testing

## Intake Summary
This review analyzes the testing automation framework, pipeline reliability, and QA infrastructure of the CollabPro project. The goal is to evaluate E2E test coverage, CI pipeline behaviors, and unit testing gaps.

## Key Findings

### Critical
1. **CI Pipeline Bypasses Core QA Suite:** The GitHub Actions workflow (`ci.yml`) exclusively executes `tests/showcase.spec.ts` (a cinematic walkthrough test), completely omitting functional QA regression tests such as `group-a-qa.spec.ts`, `group_b_qa.spec.ts`, and `playwright-qa-coverage.spec.ts`.

### High
1. **Critical Backend Exclusion from Coverage:** Unit testing configurations (`vitest.config.mts`) explicitly exclude the Next.js API endpoints (`app/api/**`) and the WebSocket gateway (`ws-server/**`), leaving core real-time sync logic untested in coverage metrics.
2. **Blocked Parallel E2E Execution:** Playwright is artificially constrained to `workers: 1` in both configuration files to prevent database transaction collisions. Test scripts manually wipe global DB schemas using `prisma.deleteMany` in `afterAll` hooks rather than utilizing isolated test transactions or per-worker mock databases.

### Medium
1. **Suppression of React Hydration Errors:** The `showcase.spec.ts` E2E test features a global error guard (`[TEST SUITE GUARD] Ignored benign hydration mismatch`) that intentionally swallows React hydration errors (#418, #423). While acceptable for a video recording, this masks potential SSR/CSR divergence bugs from the QA radar.

### Low
1. **Incomplete QA Playwright Config:** The `playwright.qa.config.ts` configuration lacks the `webServer` directive present in the main config. As a result, running `npx playwright test --config playwright.qa.config.ts` requires developers to manually boot Next.js and the WebSocket gateway, disrupting automated local developer testing.

## Recommendations
1. **Expand CI Playwright Coverage:** Update `.github/workflows/ci.yml` to trigger the full `./tests` directory or explicitly execute all QA specs (not just `showcase.spec.ts`), ensuring complete regression coverage on every push.
2. **Implement DB Transaction Rollbacks:** Refactor E2E test data seeding to use Prisma's interactive transactions or isolated schema names, enabling safe parallel test execution (`workers: >1`) and significantly reducing CI test runtime.
3. **Include Backend in Coverage:** Remove `app/api/**` and `ws-server/**` from the `exclude` array in `vitest.config.mts` and write mock-driven tests for these critical layers.
4. **Assert Hydration Stability:** Remove hydration error suppression in Playwright scripts (except strictly for cinematic recordings) to ensure the SSR output accurately matches CSR state.
5. **Sync Playwright Configs:** Add the standard `webServer` configuration block to `playwright.qa.config.ts` to improve the local developer experience.
