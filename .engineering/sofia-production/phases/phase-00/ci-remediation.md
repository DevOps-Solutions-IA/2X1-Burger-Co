# Phase 0 CI remediation

## Failure trace

| Field | Evidence |
| --- | --- |
| Failure | Root E2E typecheck could not resolve its declared Node types and used an incompatible compiler for inherited `baseUrl`. |
| Workflow | `.github/workflows/ci.yml` (`CI`) |
| Job | `quality` |
| Step | `Typecheck ephemeral UI contracts` |
| Command | `pnpm test:e2e:typecheck` |
| Working directory | Repository root |
| TypeScript config | `tests/e2e/tsconfig.json`, extending `tsconfig.base.json` |
| Missing dependency | Root package did not declare `typescript` or `@types/node`. |
| `baseUrl` source | Redundant `compilerOptions.baseUrl` in `tsconfig.base.json`. |
| Root cause | The root script depended on undeclared transitive tooling. CI resolved an incompatible compiler while a clean local root had no `tsc` binary. The E2E config also inherited an option it did not use. |

## Minimal fix

- Declared `typescript` and `@types/node` as root development dependencies and updated `pnpm-lock.yaml`.
- Removed only the redundant root `baseUrl`. API and web retain their explicit package-level `baseUrl` and web alias mapping.
- Preserved strict checking, module resolution, source inclusion, and all application behavior.

## Validation

- Frozen install: PASS
- Exact E2E typecheck command: PASS
- E2E effective `baseUrl`: absent
- E2E `strict`: enabled
- API/web package aliases: preserved
- E2E lint: PASS
- Secret scan: PASS
- Workspace lint/typecheck/build: PASS
- Phase 0 API focused tests: 45/45 PASS
- Release and schema infrastructure tests: 30/30 PASS
- Isolated recovery drill: PASS

No production configuration, migration, domain behavior, or SOFIA capability changed.

## Recovery job follow-up

The first PR run after the typecheck fix reached the previously skipped recovery job and exposed stale recovery-only wiring:

- The generated release manifest was mode `0600`, so the non-root API image could not read its bind mount.
- `restore-web` did not receive its verified internal endpoint (`http://restore-api:3000`) and overrode the image healthcheck with the obsolete localhost login probe.
- The restore smoke expected the intentionally omitted public `dirtyBuild` field.
- The migration mismatch fixture no longer satisfied the strict manifest schema and expected the superseded generic reason code.
- The E2E workflow invoked the lightweight business fixture while running Playwright assertions that require the repository's core operational fixture.
- The recovery job used undeclared `rg` after its runtime smoke, but the clean GitHub runner does not provide ripgrep.
- The E2E job enabled host-side core tests without generating Prisma after its frozen install skipped package build scripts.

The remediation makes sanitized runtime metadata container-readable (`0644`), verifies the manifest from the API image before database startup, wires each Compose service endpoint, inherits the image healthcheck, keeps `dirtyBuild` validation on the local artifact contract, generates a schema-valid incompatible migration fixture, runs the existing `test:e2e:core` setup with an explicit Prisma generation step, and uses portable `grep -E` checks in the dependency-free recovery job.

Local core E2E result: PASS (contracts 12, RBAC 70, Playwright 3/3). Local isolated recovery result after portable runner checks: PASS (`RPO=0s`, `RTO=12.11s`). Both teardowns reported zero containers, volumes, and networks; recovery also confirmed cryptographic material removal.

## PDF verification dependency

The first complete downstream E2E execution reached the real PDF evidence checks after contracts (12/12) and RBAC (70/70) passed. It failed before the operational assertions because the clean GitHub runner did not provide the `gs` executable used by `core-operational-e2e.mjs` to render and inspect receipt PDFs.

The workflow now installs Ghostscript explicitly in the ephemeral E2E job and prints only its version. The PDF checks remain unchanged and mandatory; no assertion, application behavior, timeout, retry, or test scope was weakened. In the same workflow attempt, the immutable artifact and isolated encrypted recovery jobs passed.

After Ghostscript was available, E2E completed contracts (12/12), RBAC (70/70), PDF verification, and the complete operational API flow. The mobile accessibility scan then exposed a synchronization race: the CRM search request had completed and removed `disabled`, but the button's 150 ms opacity transition had not reached its stable value. Axe measured the interpolated colors (`#707070` on `#ffc77a`, 3.23:1) instead of the stable black-on-orange control.

The mobile test now waits on two observable conditions before the unchanged WCAG A/AA scan: the search button is enabled and its computed opacity is exactly `1`. This adds no sleep, retry, exclusion, or accessibility waiver and does not change runtime UI code.
