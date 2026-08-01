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

The remediation makes sanitized runtime metadata container-readable (`0644`), verifies the manifest from the API image before database startup, wires each Compose service endpoint, inherits the image healthcheck, keeps `dirtyBuild` validation on the local/Web artifact contract, generates a schema-valid incompatible migration fixture, and runs the existing `test:e2e:core` setup for the core UI suite.

Local core E2E result: PASS (contracts 12, RBAC 70, Playwright 3/3). Local isolated recovery result: PASS (`RPO=0s`, `RTO=11.872s`). Both teardowns reported zero containers, volumes, and networks; recovery also confirmed cryptographic material removal.
