# Phase 2.2 - Runtime Safety Gates Report

## 1. Resumen ejecutivo

Phase 2.2 demuestra en un canary aislado y trazable que Sofia y WhatsApp permanecen supervisados: real send, auto reply, Auto Safe, produccion y PAID son efectivos `false`. Pause, kill switch, allowlist, payment blocking, sandbox isolation, dedup, QR truthful y UI/API/runtime pasaron. No se monto sesion real, no se uso red externa y no se modifico produccion. La decision es `GO CONDICIONADO` por owner gates fisicos y remotos.

## 2. Snapshot y aislamiento

El canary usa API `4400`, web `3401` y PostgreSQL `55433`, volumen propio, numeros sinteticos, sin sesiones WhatsApp ni key DeepSeek. El runtime operativo anterior permanece activo e intacto. Los conteos iniciales operativos fueron cero.

## 3. Artifact identity

| Artifact | Commit | BuildId | Digest | Estado |
| --- | --- | --- | --- | --- |
| API | `66c54785f6d1383e40f28e66dd825a4db11d6a44` | `0.1.0-66c54785f6d1-1783929742` | `sha256:a8a978132db32c47f68d12b55a662d8ceaf70751c781ba6d5d793b15c46125ad` | PASS |
| Web | `66c54785f6d1383e40f28e66dd825a4db11d6a44` | `0.1.0-66c54785f6d1-1783929742` | `sha256:19f52f59a876b29a7005be811384318a76e7def5e70ed4d0679597dc4ac07bf9` | PASS |

Manifest, `/version`, OCI labels e imagenes no root coinciden. SBOM CycloneDX: 1074 componentes. `dirtyBuild=false`.

## 4. Cambios aplicados

- Fuente unica `SofiaRuntimeSafetyService` para controles efectivos, precedencia, allowlist, auditoria y counters.
- Pause y kill switch persistentes e independientes.
- Gates centrales antes de approve, retry, inbound automation y providers.
- Normalizacion exacta de telefonos colombianos y allowlist fail-closed.
- Overrides de provider/AI restringidos a `NODE_ENV=test`.
- Dashboard/UI con estados efectivos honestos.
- Canary receive-only sin bootstrap QR/sesiones y con alias de red aislado.
- Smoke runtime repetible sin contaminar operacion real.

## 5. Matriz de controles

| Control | Declarado | Efectivo | Comportamiento | Auditoria | Estado |
| --- | --- | --- | --- | --- | --- |
| Real send | false | false | bloquea approve/retry/test-send | counter/audit | PASS |
| Auto reply | false | false | solo draft/sugerencia | decision | PASS |
| Auto Safe | false | false | `shouldSend=false` | decision | PASS |
| Production | false | false | accion productiva bloqueada | audit | PASS |
| WhatsApp PAID | false | false | cero pago/PAID | decision/audit | PASS |
| Pause | reversible | efectivo al activar | bloquea automatizacion | setting/audit | PASS |
| Kill switch | reversible | precedencia maxima | bloquea envio/retry | setting/audit | PASS |
| Allowlist | sintetica | exacta/fail-closed | denied o gate final | counter/audit | PASS |

## 6. Escenarios negativos

| Escenario | Accion intentada | Resultado | Side effect | Estado |
| --- | --- | --- | --- | --- |
| Send OFF | aprobar outbound | bloqueado | 0 enviados | PASS |
| Auto reply OFF | procesar inbound permitido | draft solamente | 0 enviados | PASS |
| Auto Safe OFF | evaluar decision | `shouldSend=false` | 0 enviados | PASS |
| Production OFF | accion productiva | bloqueada | 0 negocio | PASS |
| PAID | mensaje de pago | human/payment sensitive | 0 pagos/PAID | PASS |
| Fuera de allowlist | inbound sintetico | rechazado | 0 conversacion real | PASS |
| Pause | inbound | automatizacion bloqueada | lectura intacta | PASS |
| Kill switch | retry/send | bloqueado | 0 provider calls | PASS |
| Unknown product | producto inexistente | human/unknown | 0 pedido/precio | PASS |
| Duplicado | mismo event id | suprimido | una decision/draft | PASS |

## 7. Flags API/UI/DB

| Flag | API | UI | DB/setting | Estado |
| --- | --- | --- | --- | --- |
| realSendingEnabled | false | bloqueado | no habilitado | PASS |
| autoReplyEnabled | false | OFF | no habilitado | PASS |
| autoSafeEnabled | false | OFF | no habilitado | PASS |
| productionEnabled | false | bloqueada | no habilitado | PASS |
| whatsappCanMarkPaid | false | bloqueado | no habilitado | PASS |
| pause | false tras restaurar | inactiva | false | PASS |
| kill switch | false tras restaurar | inactivo | false | PASS |

## 8. Reconciliacion de eventos y datos

| Evento/entidad | Count antes | Count despues | Diferencia | Estado |
| --- | ---: | ---: | ---: | --- |
| Inbound sintetico | 0 | 7 | 7 | validacion interna |
| Conversaciones internas | 0 | 4 | 4 | separadas |
| Ventas | 0 | 0 | 0 | PASS |
| Pagos | 0 | 0 | 0 | PASS |
| Movimientos caja | 0 | 0 | 0 | PASS |
| Outbound SENT | 0 | 0 | 0 | PASS |
| Ordenes PAID | 0 | 0 | 0 | PASS |

## 9. Pause, kill switch y allowlist

Se demostro la precedencia `KILL SWITCH > PAUSE > PRODUCTION > AUTO SAFE > AUTO REPLY > REAL SEND`. Ambos controles preservan lectura y auditoria y fueron restaurados sin reinicio destructivo. La allowlist normaliza formatos validos, compara exacto, rechaza vacios/invalidos/parciales y nunca registra el numero completo.

## 10. Payments, sandbox y dedup

Mensajes de pago, comprobante, saldo y solicitud de PAID escalan sin crear pagos ni alterar orden, caja, stock o total. `operation_real`, `internal_validation`, `sandbox` e historico permanecen separados. Duplicados por inbound/event/revision se suprimen con keys deterministicas; no hubo envios.

## 11. QR, DeepSeek y SafetyGuard

QR se muestra `DISABLED`, disconnected, `adapterReal=false`, sin QR raw y sin sesion montada. DeepSeek se muestra `dry_run` con proveedor externo OFF, sin key ni red externa. SafetyGuard precede cualquier accion y bloquea payment, unknown product, prompt injection, secretos y PAID.

## 12. UI/API/runtime consistency

Se validaron `/sofia`, `/sofia/conversations`, `/sofia/whatsapp-qr` y `/sofia/sandbox` en desktop, mas dashboard/conversations mobile. La UI coincide con contratos API sanitizados: no hay conectado falso, Auto Safe activo falso, produccion activa, numeros completos, QR raw ni mezcla sandbox/real.

## 13. Auditoria, redaccion y observabilidad

Los eventos incluyen actor, timestamp, reason, estado, resultado, idempotency key y telefono masked cuando aplica. Secret scan y DB scan reportaron cero secretos/QR raw/telefonos completos. Counters minimos de received, blocked, send attempts, duplicates, payments, escalations, timeout y allowlist estan disponibles por interfaz admin; exporter/alertas quedan para Phase 2.4.

## 14. Tests y builds

| Test | Assertions | Exit | Warning | Estado |
| --- | ---: | ---: | --- | --- |
| Config/runtime safety/timeout | 17/17 | 0 | ninguno | PASS |
| Provider overrides | 2/2 | 0 | ninguno | PASS |
| Critical integration | 91/91 | 0 | sin open handles | PASS |
| Delivery Phase A | 11/11 | 0 | ninguno | PASS |
| Runtime safety smoke x2 | todos PASS | 0/0 | ninguno | PASS |
| UI runtime smoke | 4 desktop + 2 mobile | 0 | ninguno | PASS |
| API typecheck/build | N/A | 0/0 | ninguno | PASS |
| Web typecheck/build | N/A | 0/0 | 88 warnings conocidos | PASS condicionado |

## 15. Iteraciones del loop

1. Se corrigio el harness visual que no esperaba el flujo asincrono.
2. Se corrigio el alias Docker aislado que impedia al web canary alcanzar API.
3. Se hizo repetible el smoke liberando exclusivamente conversaciones sinteticas internas. Dos ejecuciones consecutivas pasaron.

## 16. Rollback

| Rollback | Desde | Hacia | Duracion | Estado |
| --- | --- | --- | ---: | --- |
| Candidato a baseline | `a8a978...` | `049521...` | 23 s | PASS |
| Restauracion candidato | `049521...` | `a8a978...` | 24 s | PASS |

No hubo rebuild ni rollback de DB. El canary final quedo sobre el candidato.

## 17. Regresion

Health, version/provenance, web login, Delivery Phase A, critical integration y rutas Sofia pasaron. POS, Caja e Inventory solo se verificaron read-only; no se ejecutaron mutaciones. Produccion y runtime operativo no se modificaron.

## 18. Commits locales

| Commit | Descripcion | Estado |
| --- | --- | --- |
| `87f0f1e3bde3` | safety gates Sofia/WhatsApp | validado |
| `a6cf3126370d` | routing canary web aislado | validado |
| `66c54785f6d1` | smoke runtime repetible | artifact final |

Push realizado: NO.

## 19. Owner gates

- QR fisico y sesion real.
- Allowlist comercial final.
- Staging remoto/registry.
- Security owner/secret store.
- Branch protections y approvals.

Estos gates bloquean produccion y el semaforo verde, pero no invalidan la prueba canary interna.

## 20. Scores

| Modulo | Score antes | Score despues | Semaforo |
| --- | ---: | ---: | --- |
| Sofia | 68% | 82% | AMARILLO |
| WhatsApp | 67% | 80% | AMARILLO |
| Security | 64% | 71% | AMARILLO |
| Testing | 80% | 84% | AMARILLO |
| API | 88% | 89% | AMARILLO |

## 21. Riesgos residuales y decision

Persisten owner gates, CSP/dependencias, observabilidad externa, staging remoto y automatizacion required de la DB/E2E. No existe evidencia para declarar operacion real ni verde. Decision: `ENGINEERING PHASE 2.2: GO CONDICIONADO`.
