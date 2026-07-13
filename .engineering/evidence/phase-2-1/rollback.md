# Phase 2.1 - Rollback Drill

| Paso | Duracion | Resultado |
| --- | ---: | --- |
| Baseline inicial | 23 s | PASS |
| Candidato | 23 s | PASS |
| Rollback a baseline | 24 s | PASS |
| Restauracion candidato | 23 s | PASS |

- Mecanismo: digest local inmutable.
- Rebuild durante rollback: no.
- Rollback de DB: no.
- Configuracion canary conservada: si.
- Estado final: candidato restaurado y saludable.

Evidencia detallada: `/tmp/phase-2-1-release-foundation/rollback-drill-output.json`.
