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
- Phase 0 focused tests: 64/64 PASS

No production configuration, migration, domain behavior, or SOFIA capability changed.
