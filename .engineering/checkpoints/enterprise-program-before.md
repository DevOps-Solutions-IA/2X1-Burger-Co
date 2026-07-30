# Enterprise Program - Baseline

Fecha: 2026-07-27 America/Bogota.

## Git

- Branch: `master`.
- HEAD: `c8a82998ef5265f70dc1a1039cab2e9327f8f66d`.
- Remote configurado: no.
- Tags: no.
- Staging area: vacia.
- Working tree: contiene documentacion/evidencia R2 sin commit y dos cambios del owner bajo `.agents/` y `.claude/` que deben preservarse.

## Runtime observado

| Runtime | Puertos | Health | Provenance | Estado |
| --- | --- | --- | --- | --- |
| Operativo | `80`, `4300`, `3301`, `5432` | PASS | No expone `/version`; imagenes sin labels OCI | CONDICIONADO |
| Canary R2 | `4400`, `3401`, `55433` | PASS | Commit `c8a82998ef52`, mismo buildId API/web, `dirtyBuild=false` | PASS LOCAL |

El runtime operativo no fue reiniciado, reemplazado ni modificado durante este snapshot.

## Estado de gobierno

- Enterprise Score documentado: 86%.
- Production Readiness documentado: 86%, `NOT READY`.
- Semaforo: 0 verdes, 16 amarillos, 0 rojos.
- `GLOBAL_STATUS.md` refleja R2, pero la cabecera de `ROADMAP.md` aun referencia el bloqueo R1.
- `docs/sofia-current-state.md` fue actualizado por ultima vez el 2026-07-05 y debe revalidarse contra el artifact actual antes de cambiar su estado.
- Delivery Phase A permanece congelada.

## Restricciones de ejecucion

- No activar produccion ni WhatsApp saliente sin gate humano explicito.
- No tocar la DB operativa durante pruebas.
- No modificar ni descartar archivos del owner.
- No promover un modulo a verde usando solo evidencia local historica.
- Todo artifact candidato debe demostrar source = commit = artifact = runtime y rollback por digest.

## Primeros bloqueadores

1. Runtime operativo sin provenance verificable.
2. Remote, registry, protections, required checks y staging remoto no configurados.
3. Working tree de gobierno/evidencia aun no consolidado.
4. Deuda frontend: warnings, `any`, contratos y cobertura UI mutante.
5. Vulnerabilidades de dependencias pendientes de triage por alcanzabilidad.
6. Monitoring, alerting, KMS/secret store y backup offsite sin backend externo aprobado.

