# Phase 2.4 - RPO y RTO

## Medicion observada

| Run | Backup | RPO observado | RTO observado | Tiempo total | Reconciliacion | Cleanup |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| phase24-final-1 | 1.810 s | 0 s | 11.556 s | 58.658 s | PASS | PASS |
| phase24-final-2 | 2.223 s | 0 s | 11.789 s | 59.640 s | PASS | PASS |
| phase24-final-3 | 2.513 s | 0 s | 11.841 s | 64.850 s | PASS | PASS |

- RPO observado: **0 s** en el dataset controlado, porque el dump se tomo despues del ultimo write y antes de cualquier write adicional.
- RTO observado: **11.729 s promedio**, rango 11.556–11.841 s, desde inicio de restore hasta API/web saludables y smoke read-only.
- Este RPO no representa produccion continua. Con full diario y sin WAL, el RPO target propuesto seria hasta 24 h.
- El RTO productivo requiere medicion con volumen real, storage offsite, approvals y DNS/routing.

## Descomposicion

El drill mide preparacion automatizada, descifrado/checksum, `pg_restore`, reconciliacion, startup, readiness y smoke. Deteccion humana, aprobacion, descarga offsite y cambio de trafico no estan incluidos y son owner gates.

| Tipo | Valor | Estado |
| --- | --- | --- |
| OBSERVED local RPO | 0 s controlado | PASS local |
| OBSERVED local RTO | 11.729 s promedio | PASS local |
| TARGET full-only RPO | <=24 h | OWNER APPROVAL REQUIRED |
| TARGET con WAL RPO | <=15 min propuesto | OWNER APPROVAL REQUIRED |
| TARGET productivo RTO | <=60 min propuesto | OWNER APPROVAL REQUIRED |
