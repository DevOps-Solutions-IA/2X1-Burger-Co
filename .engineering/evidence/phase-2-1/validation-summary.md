# Phase 2.1 - Validation Summary

| Validacion | Resultado | Evidencia |
| --- | --- | --- |
| API typecheck | PASS | `/tmp/phase-2-1-release-foundation/final-api-typecheck.log` |
| API build | PASS | `/tmp/phase-2-1-release-foundation/final-api-build.log` |
| Web typecheck | PASS | `/tmp/phase-2-1-release-foundation/final-web-typecheck.log` |
| Web build | PASS con 88 warnings conocidos | `/tmp/phase-2-1-release-foundation/final-web-build.log` |
| Config, provenance, timeout y Delivery | 4 suites, 20/20 PASS | `/tmp/phase-2-1-release-foundation/final-focused-tests-iteration-2.log` |
| Critical integration | 91/91 PASS, sin open handles | `/tmp/phase-2-1-release-foundation/release-critical-test.log` |
| Secret scan tracked source | PASS | `/tmp/phase-2-1-release-foundation/final-secret-scan.log` |
| SBOM | CycloneDX 1.5, 1074 componentes | Artifact final |
| Reproducibilidad | Bit-reproducible en builder actual para dos builds del commit `0d50d31` | `/tmp/phase-2-1-release-foundation/reproducibility.json` |

El primer intento focalizado fue bloqueado por el guard `_test` al detectar una URL operacional. Se creo una DB efimera separada, se aplicaron 29 migraciones y la repeticion paso. No se modifico la DB operacional.

Riesgos visibles: 88 warnings web, plugin Next ESLint no detectado, 2 vulnerabilidades moderadas en dependencias runtime web y plugin Docker Buildx ausente en el host.
