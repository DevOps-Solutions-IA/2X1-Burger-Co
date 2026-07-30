# System Total Audit Final

Fecha: 2026-07-12  
Repositorio: `/home/wundah/inventario`  
Commit base observado: `900449425e11e3d9305cb9677192c69a12ee8456`  
Decision: **NO-GO**

## 1. Resumen ejecutivo

Se inventariaron las nueve zonas, se ejecuto runtime real de desarrollo, UI autenticada read-only, builds, typechecks y suites de integracion. La fuente corregida queda con 91/91 tests criticos, 11/11 Delivery y 67/67 config/pricing en PASS.

No obstante, el sistema **no esta production ready**. El runtime activo fue construido antes de un fix critico de parsing booleano: `.env` contiene `SOFIA_AUTO_SAFE_ENABLED=false`, pero el dashboard efectivo devuelve `autoSafeEnabled=true`. El CD es placeholder, no hay remote/protections, el runtime no expone provenance, el working tree mezcla cambios no consolidados y Sofia sigue pausada/QR desconectado/allowlist pendiente. No se reconstruyo el contenedor porque hacerlo desplegaria indiscriminadamente cambios Delivery y Sofia no committed.

## 2. Inventario auditado

- 489 archivos de aplicacion/infra/reportes.
- 29 rutas/layouts web.
- Controladores/endpoints de auth, usuarios, roles, catalogo, inventario, compras, ventas, caja, ordenes, delivery, WhatsApp, reportes y Sofia.
- Docker Compose, nginx, CI, CD, backup, restore, smoke y deploy.
- Working tree, artefactos previos, flags, jobs/timers, renderers PDF y assets.

Inventario fuente: `/tmp/system-total-audit/auditoria-maestra.md` y logs adyacentes.

## 3. Estado por zonas

| Zona | Estado | Severidad | Evidencia | Riesgo residual |
| --- | --- | --- | --- | --- |
| Caja | AMARILLO | Alta | 91 tests; UI `/cash` real | Reimpresion/recovery no recorridos sobre DB efimera; tipos debiles |
| POS/Sales | AMARILLO | Alta | suite critica/build | Sin E2E obligatorio ni provenance runtime |
| Delivery | AMARILLO | Media | 11/11 + critical + screenshot | Cambios no consolidados/runtime no identificable |
| WhatsApp Core | ROJO | Alta | timer reproducido/fix; status runtime | Runtime viejo y QR desconectado |
| Sofia | ROJO | Critica | API efectiva + UI real + tests | Auto Safe efectivo true, allowlist/rotacion/QR pendientes |
| Catalogo/Pricing | AMARILLO | Alta | 67/67 + critical | Sin reconciliacion runtime firmada |
| Inventario/Compras | AMARILLO | Critica | critical PASS | Sin E2E aislado/reconciliacion completa |
| Usuarios/RBAC | AMARILLO | Alta | auth/RBAC tests | Matriz endpoint-permiso y protections incompletas |
| Infra | ROJO | Critica | workflows/runtime/scripts | Sin CD, provenance, remote, tracing ni restore drill |

## 4. Hallazgos y correcciones

| Hallazgo | Causa raiz | Fix | Validacion | Resultado |
| --- | --- | --- | --- | --- |
| Flags `false` efectivos como `true` | `z.coerce.boolean()` aplica truthiness a strings | Parser estricto `true/false/1/0` + tests | 2/2 config tests; API typecheck/build | Fuente corregida; runtime pendiente |
| Suite critica dependia del `.env` local | Config se carga antes de `beforeAll` | `setupFiles` Jest con baseline seguro | Sofia subset PASS y 91/91 global | PASS fuente |
| Test table groups 409 | Reset no truncaba tablas nuevas | Agregar assignments/groups al reset `_test` | Test y suite global PASS | PASS |
| Timer WhatsApp de 45 s quedaba vivo | Timeout perdedor de `Promise.race` no cancelado | `withTimeout()` con `clearTimeout` en `finally` | Delivery 11/11 sin warning; critical PASS | PASS fuente |
| QR test esperaba QR simulado | Contrato historico incompatible con truthful Baileys | Gate duro `DISABLED`; test de dedup/send separado | QR tests PASS | PASS fuente |
| Test exigia distancia inventada | Proveedor externo OFF y ubicacion logistics-only | Verificar coordenadas y preservar distancia inicial | Test focal + global PASS | PASS |
| Runtime Auto Safe contradice flag | Imagen anterior al parser estricto | No desplegado por working tree mezclado | Dashboard efectivo: true | BLOQUEADOR |
| Runtime sin provenance | Imagenes sin commit/build id comparable | Documentado; no hotfix inseguro | inspect/build timestamps | BLOQUEADOR |

## 5. Runtime esperado vs observado

| Endpoint/Ruta | Runtime esperado | Runtime observado | Estado |
| --- | --- | --- | --- |
| `/api/health` | API/DB healthy | healthy, environment development | PASS tecnico |
| `/cash` | UI operativa | Carga con datos reales | PASS visual read-only |
| `/deliveries` | Cola real separada | Carga, 0 activos | PASS visual read-only |
| `/sofia` | Supervisada, flags honestos | Pausada; produccion bloqueada; Auto Safe API efectivo true | FAIL seguridad |
| `/sofia/conversations` | Real/sandbox separados | 0 real; sandbox/historico separados | PASS visual condicionado |
| `/sofia/whatsapp-qr` | Receive-only, send OFF | DISCONNECTED, adapter no disponible, send bloqueado | CONDICIONADO |
| `/admin/sofia/ai/status` | DeepSeek dry-run | deepseek/dry_run, key no expuesta | PASS condicionado |

## 6. Caja

La suite valida apertura/cierre, readiness, reapertura controlada, movimientos, conversion y recuperacion de ventas/comandas. La UI real carga. No se ejecuto una recuperacion o reimpresion mutante sobre la base operativa porque no existe entorno E2E efimero listo sin `prepare-test-db.sh` destructivo. Por ello Caja queda AMARILLO, no GO.

## 7. Delivery

Phase A conserva fee persistido, version vigente, ubicacion logistics-only, autoenvio idempotente y PDF deterministico. Tests focalizados y criticos pasan. Queda AMARILLO por falta de release/provenance del working tree actual, no por fallo funcional demostrado.

## 8. WhatsApp

El envio real no se activo ni se probo. Se corrigio en fuente la fuga de timers. QR runtime esta desconectado. Real send observado false. Sin deploy controlado y reconexion fisica no puede quedar VERDE.

## 9. Sofia

Tests de cerebro comercial, SafetyGuard, sandbox, DeepSeek controlado, governance, dedup, allowlist y PAID blocking pasan con baseline seguro. La UI real es honesta respecto a pause/QR/produccion y separa sandbox. El runtime efectivo de Auto Safe contradice el flag raw debido a la imagen antigua; este es un bloqueo critico.

## 10. Seguridad

- Secret scan por rutas: 0 hallazgos de valores en source/reportes auditados.
- Activaciones inseguras hardcoded en source/example: 0.
- No se imprimieron tokens, passwords, numeros completos ni QR raw.
- No se ejecuto Prisma reset/migrate destructivo.
- No se activo produccion, send real, auto reply ni PAID.
- Riesgo: compose contiene credenciales de desarrollo y no constituye configuracion productiva.

## 11. Observabilidad

Existe `X-Request-Id`, log JSON de request y auditLog de negocio. Faltan exporter de metricas infra, tracing distribuido, alert routing, SLO/error budgets y evidencia de retencion. Las metricas Sofia no sustituyen observabilidad de plataforma.

## 12. CI/CD, protections y runtime

- CI ejecuta typecheck/build/API tests; E2E es manual.
- CD solo imprime un placeholder.
- No hay remote Git configurado; branch protection/reviewers no verificables.
- API/web runtime provienen de imagenes con timestamps distintos.
- No hay version endpoint ni OCI labels de commit demostrados.
- Working tree mezcla cambios Delivery/Sofia y artefactos; no es release reproducible.

## 13. Recovery, rollback y backups

Hay scripts de backup y restore con validacion en DB temporal. El cifrado GPG es opcional; no existe evidencia de restore drill reciente, RTO/RPO, offsite custody ni rollback de imagen por version. El deploy hace backup previo salvo override, pero no hay pipeline CD operativo.

## 14. Tests y builds

| Gate | Resultado | Motivo |
| --- | --- | --- |
| API typecheck | PASS | exit 0 |
| API build | PASS | exit 0 |
| Web typecheck | PASS | exit 0 |
| Web build | PASS condicionado | exit 0; 88 warnings `no-explicit-any`; plugin Next ESLint no detectado |
| Critical integration | PASS | 91/91, 315.996 s |
| Delivery Phase A | PASS | 11/11, sin open-handle warning |
| Config + delivery unit | PASS | 67/67 |
| Runtime smoke | PASS | API/web/waiter/PWA |
| UI runtime read-only | PASS condicionado | 5 rutas capturadas; no operaciones mutantes |

## 15. Evidencia visual

- `/tmp/system-total-audit/evidence/runtime-ui/cash.png`
- `/tmp/system-total-audit/evidence/runtime-ui/deliveries.png`
- `/tmp/system-total-audit/evidence/runtime-ui/sofia.png`
- `/tmp/system-total-audit/evidence/runtime-ui/sofia-conversations.png`
- `/tmp/system-total-audit/evidence/runtime-ui/sofia-whatsapp-qr.png`

## 16. Cambios aplicados

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `apps/api/src/config/env.ts` | Boolean parser estricto | Evitar flags `false` efectivos como true |
| `apps/api/src/config/env.spec.ts` | Tests de flags | Regresion de seguridad |
| `apps/api/jest.config.ts` | setup seguro pre-import | Tests deterministas |
| `apps/api/src/tests/setup-env.ts` | Flags test OFF | Aislar `.env` local |
| `apps/api/src/tests/helpers/test-data.ts` | Truncate tablas nuevas | Aislamiento DB |
| `apps/api/src/modules/whatsapp/whatsapp.service.ts` | Timeouts cancelables | Evitar handles/fugas |
| `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts` | Gate DISABLED honesto | No bootstrap con flag OFF |
| `apps/api/src/tests/app.critical.spec.ts` | Contratos QR/pricing coherentes | Eliminar expectativas falsas |
| `apps/api/src/tests/delivery-receipt-phase-a.spec.ts` | Usa timeout productivo corregido | Validar lifecycle real |

No hubo commit, push, restart ni deploy.

## 17. Pendientes y gate de produccion

| Produccion | Bloqueador | Accion requerida | Dueño sugerido |
| --- | --- | --- | --- |
| Release | Working tree mezclado | Separar/revisar/commitear por dominio | Tech lead |
| Runtime | Auto Safe efectivo true | Construir artefacto limpio con parser fix y desplegar canary | DevOps + owner |
| Sofia | Allowlist/rotacion/QR | Cerrar gates fisicos y security owner | Operaciones + seguridad |
| CI/CD | CD placeholder/E2E manual | Pipeline con approvals, artifacts y rollback | DevOps |
| Git | Sin remote/protections | Configurar remote, reviews y required checks | Repo owner |
| Observabilidad | Sin metrics/tracing/alerts | Instrumentar y probar alertas/runbooks | Platform |
| Backup | Cifrado/drill/RTO-RPO | Custodia offsite y restore drill | Infra owner |
| UI quality | 88 warnings tipos | Tipar contratos por zona y hacer lint blocking | Frontend lead |
| Operacion | Caja/POS/Stock E2E mutante pendiente | DB efimera y escenarios con rollback | QA/Operaciones |

## 18. Riesgos residuales

El mayor riesgo inmediato es ejecutar el runtime actual creyendo que `false` desactiva Auto Safe. La UI muestra produccion bloqueada y Sofia pausada, lo que reduce exposicion, pero no corrige la configuracion efectiva. Un rebuild directo tampoco es aceptable porque incorporaria cambios no revisados del working tree.

## 19. Recomendacion de despliegue

**No desplegar a produccion.** Crear primero un hotfix/release limpio con parser booleano y timeout, CI completo, artifact provenance y canary local/staging. Luego repetir status efectivo, QR/allowlist, E2E Caja/POS/Delivery/Stock, observabilidad y restore drill.

## 20. Decision final

**SYSTEM GLOBAL GATE: NO-GO**  
**ZONAS EN VERDE: 0/9**  
**CAJA: GO CONDICIONADO**  
**SOFIA: NO-GO**  
**PRODUCTION READINESS: NOT READY**  
**SIN HUMO: NO**
