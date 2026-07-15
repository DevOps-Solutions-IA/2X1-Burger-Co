# Engineering Framework Phase 2.4

## 1. Resumen ejecutivo

Phase 2.4 demuestra recovery y observabilidad en local/canary aislado. Tres ejecuciones finales crean backup PostgreSQL real, validan catalogo/checksum, cifran, restauran en una segunda DB, reconcilian invariantes y arrancan API/web sobre el restore. El resultado es **GO CONDICIONADO**: faltan storage offsite, WAL/KMS, monitoring/tracing backend, canal de alertas, staging remoto y owner approvals.

## 2. Snapshot

- HEAD preservado: `66c54785f6d1383e40f28e66dd825a4db11d6a44`.
- Runtime operativo preservado en API 4300/web 3301/DB 5432.
- Canary previo preservado en API 4400/web 3401/DB 55433.
- Artifact de test final: `0.1.0-66c54785f6d1-phase24-0799d8d57701`.
- Artifact marcado `dirtyBuild=true`, `environment=test`, `productionEligible=false`.
- API digest: `sha256:cb664ed0acad8b41dbe0192f9060e96250d430b52f66d8a8910deaaeb77e28e0`.
- Web digest: `sha256:a1f038eb245b91177d67ddf10e8e7235cfde27de619c5f4a62fa48515901e125`.

## 3. Recovery inventory

Los activos CRITICAL son PostgreSQL, ventas/pagos/caja, ordenes/Delivery y stock. Usuarios, RBAC, auditoria, config y custodia de sesion son HIGH. PDFs y artifacts son regenerables. Detalle: `phase-2-4-recovery-audit.md`.

## 4. Backup design

- Formato PostgreSQL custom, compression 9, sin owner/privileges.
- SHA-256 del dump y del cifrado.
- AES-256-CBC PBKDF2 con clave separada y permisos 0600/0700.
- Archivo y clave solo viven durante el drill; el trap los elimina aun ante fallo.
- Metadata y reconciliacion sanitizadas son la unica evidencia persistida.

## 5. Backup execution

| Run final | Backup | Plain size | Encrypted size | Catalogo | Checksum | Estado |
| --- | ---: | ---: | ---: | --- | --- | --- |
| phase24-final-1 | 1.810 s | 225981 B | 226000 B | PASS | PASS | GO |
| phase24-final-2 | 2.223 s | 225976 B | 226000 B | PASS | PASS | GO |
| phase24-final-3 | 2.513 s | 225963 B | 225984 B | PASS | PASS | GO |

## 6. Restore drill

Cada restore usa una DB vacia diferente, valida checksum antes de descifrar y ejecuta `pg_restore --exit-on-error`. Luego arranca el artifact API/web y prueba health, login, Caja/POS/Delivery/Inventory/Sofia read-only y provenance.

## 7. Data reconciliation

| Invariante | Source | Restore | Resultado |
| --- | ---: | ---: | --- |
| Migraciones aplicadas/fallidas | 29/0 | 29/0 | PASS |
| Tablas/indices | 60/240 | 60/240 | PASS |
| Constraints sin validar | 0 | 0 | PASS |
| Usuarios/ventas/ordenes | 7/1/2 | 7/1/2 | PASS |
| Sumas financieras | Hash/valor logico | Igual | PASS |
| Stock y movimientos | Hash/valor logico | Igual | PASS |
| Checksums por entidad | 9 grupos | Igual | PASS |

Evidencia agregada: `.engineering/evidence/phase-2-4/restore-reconciliation.json`.

## 8. RPO/RTO

- RPO observado: **0 s** en dataset controlado sin writes entre snapshot y dump.
- RTO observado: **11.729 s promedio**, rango 11.556–11.841 s.
- RPO productivo propuesto full-only: hasta 24 h; requiere owner approval.
- WAL/RPO <=15 min y RTO <=60 min son targets propuestos, no promesas.

## 9. Health/readiness

- `/health/live`: proceso vivo, independiente de DB.
- `/health/ready`: DB accesible, migraciones terminadas y count compatible.
- `DEGRADED/UNHEALTHY`: DB no disponible o schema incompatible.
- DB detenida: live 200, ready 503, metric alert `DB_UNAVAILABLE`.
- Expected migrations 30 frente a 29: ready 503 `MIGRATION_INCOMPATIBLE`.

## 10. Structured logging

Se agregaron requestId, correlationId, traceId, spanId, modulo, action, result, duration, status y errorClass. Actor se guarda como hash corto; no se registran IP/user-agent crudos, tokens, telefonos, QR, cookies ni payloads completos. El filtro Prisma emite errores sanitizados.

## 11. Metrics

- Publico sanitizado: `/health/metrics` con process, CPU, memory, event-loop utilization, active resources, HTTP, DB connectivity, recovery y flags efectivos.
- Protegido RBAC admin/supervisor: `/health/observability` agrega sales/orders/cash/delivery/inventory y counters Sofia/WhatsApp.
- Labels de telefono, orderId, userId y requestId estan prohibidos.
- Retencion actual: in-memory por proceso; backend persistente es owner gate.

## 12. Tracing

Propagacion W3C-compatible y headers `X-Request-Id`, `X-Correlation-Id`, `X-Trace-Id` validados. Exporter actual: log estructurado local. No se enviaron trazas a terceros. Backend OpenTelemetry remoto queda pendiente.

## 13. SLO/error budgets

El catalogo define indicador, formula, ventana, target propuesto, fuente, alerta, owner y runbook. No se declara SLO productivo sin baseline persistente. Violaciones financieras, envio no autorizado, PAID por WhatsApp o restore inconsistente consumen todo el budget y bloquean release.

## 14. Alerting

Se evaluan localmente DB unavailable, pool pressure, error rate, p95, memoria, backup status y flags Sofia inseguros. El canal figura `OWNER_GATE_NOT_CONFIGURED`; no se invento PagerDuty/Slack/email.

## 15. Failure injection

| Escenario | Comportamiento observado | Recovery | Estado |
| --- | --- | --- | --- |
| Backup cifrado corrupto | Checksum mismatch; restore no intentado | Backup valido usado | PASS |
| Storage no escribible | Comando falla no-cero | Flujo preserva ultimo backup valido | PASS |
| DB pausada/lenta | Cliente timeout a 500 ms | Unpause + ready | PASS |
| DB detenida | Live 200, ready 503, alert activa | Restart + ready | PASS |
| Ruta protegida con DB down | Fail-closed 401 | DB recovery | PASS con riesgo residual |
| Migration mismatch | Ready 503 | Instancia incompatible retirada | PASS |
| API SIGTERM | Proceso termina | Recreate + ready | PASS |
| API/web restart | Servicios no-ready temporalmente | Smoke posterior | PASS |

Riesgo residual: el guard de auth clasifica una dependencia DB caida como 401 en rutas protegidas. Es fail-closed y no produce side effects, pero debe distinguirse como 503 en una fase API posterior.

## 16. Runbooks

Se crearon 13 runbooks en `docs/runbooks/`: API, DB, restore, rollback, latencia, errores, stock, caja, WhatsApp, Sofia, backup, secreto y deployment. Todos incluyen sintomas, severidad, diagnostico, accion segura, rollback/recovery, validacion, escalamiento y evidencia.

## 17. Operational dashboard

La base operacional interna esta preparada mediante el endpoint RBAC `/health/observability`; consume DB y counters reales. No se implemento una UI cosmetica ni se inventaron series historicas. La visualizacion historica queda bloqueada por el backend de monitoring.

## 18. Backup security

- Dump plaintext nunca queda versionado ni persiste tras cleanup.
- Dump cifrado y clave separada se eliminan al finalizar.
- Permisos 0600/0700 verificados.
- Ningun dump se sirve por web ni se incorpora a la imagen.
- KMS, offsite y destruccion legal requieren owner gate.

## 19. Repeatability

Tres ejecuciones finales consecutivas PASS con run IDs, DB, red, volumen y puertos propios. Todos los cleanup reportan containers=0, volumes=0, networks=0 y cryptographicMaterialRemoved=true.

## 20. Regression

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| Contract runtime | 12 PASS | `contract-results.json` |
| RBAC runtime | 70 PASS | `rbac-results.json` |
| Playwright | 5/5 PASS | `playwright.log` |
| Critical + RBAC backend + Delivery | 156/156 PASS | `api-regression.log` |
| API typecheck/build | PASS/PASS | `final-validation/` |
| Web typecheck/build | PASS/PASS | `final-validation/` |
| Health/observability unit | 6/6 PASS | ejecucion focalizada |
| Secret scan | PASS | `secret-scan.log` |

Web build conserva 88 warnings conocidos y el warning del plugin Next ESLint; no se ocultaron.

## 21. Security

El secret scan no imprimio valores y paso. El endpoint publico no contiene business totals; los agregados operativos requieren JWT + roles admin/supervisor. Real WhatsApp, QR, provider externo, Auto Reply, Auto Safe, real send y produccion permanecieron OFF.

## 22. CI

El job `recovery-drill` esta preparado en `.github/workflows/ci.yml` y conserva evidencia. No puede ser required hasta que el owner configure remote/protections.

## 23. Artifact and rollback

El artifact final es trazable y no elegible para produccion. El rollback por digest sigue demostrado en Phase 2.1; Phase 2.4 no cambio schema. Recovery de DB se probo sin sobrescribir runtime ni DB operativos.

## 24. Iteraciones del loop

1. El primer artifact fallo por DI faltante en middleware; root cause corregida y cleanup PASS.
2. Backup/restore paso; se detecto exposure de business metrics y counters incompletos, se separo endpoint publico/RBAC y se genero artifact nuevo.
3. Artifact final paso 3X, regresion y matriz de fallos. La simulacion DB lenta se hizo deterministica con pause/unpause.

## 25. Owner gates

| Gate | Disponible | Bloquea GO pleno |
| --- | --- | --- |
| Offsite storage/WAL | No | Si |
| KMS/secret store | No | Si |
| Monitoring/tracing backend | No | Si |
| Alert channel/on-call | No | Si |
| Remote/protections/required CI | No | Si |
| Staging remoto/approvals | No | Si |
| RPO/RTO owner approval | No | Si |

## 26. Scores

| Modulo | Antes | Despues | Semaforo |
| --- | ---: | ---: | --- |
| Database | 84 | 90 | AMARILLO |
| Deployment | 68 | 72 | AMARILLO |
| Security | 73 | 76 | AMARILLO |
| Performance | 36 | 65 | AMARILLO |
| API | 92 | 94 | AMARILLO |
| Testing | 91 | 93 | AMARILLO |
| Dashboard | 75 | 80 | AMARILLO |
| Sofia | 82 | 84 | AMARILLO |
| WhatsApp | 80 | 83 | AMARILLO |

## 27. Working tree

No se hizo reset, clean, commit ni push. Los cambios previos mezclados se conservaron. Los cambios Phase 2.4 se limitan a health/observability/logging, recovery tooling, CI, runbooks y framework.

## 28. Riesgos residuales

- Recovery remoto, volumen real y WAL no demostrados.
- Auth devuelve 401 durante caida DB en vez de 503.
- Metrics/traces no persisten entre procesos.
- No hay canal de alertas ni owners asignados.
- 2 vulnerabilidades moderadas y 88 warnings web siguen abiertos.
- Capacity/load testing pertenece a una fase posterior.

## 29. Decision

**ENGINEERING PHASE 2.4: GO CONDICIONADO.** Recovery, reconciliacion, health, metrics, tracing base, SLO, failure injection y runbooks pasan en entorno aislado. Produccion sigue NOT READY por owner gates externos.
