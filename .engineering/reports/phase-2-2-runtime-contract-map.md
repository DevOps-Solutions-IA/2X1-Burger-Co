# Phase 2.2 - Runtime Contract Map

| Endpoint/servicio | Fuente | Gate | Estado esperado | Riesgo residual | Test |
| --- | --- | --- | --- | --- | --- |
| `GET /admin/sofia/dashboard/summary` | Governance + runtime safety + QR + AI + DB | auth/admin | flags efectivos y pause/kill honestos | staging remoto pendiente | API/UI runtime |
| `GET /admin/sofia/runtime-safety` | `SofiaRuntimeSafetyService` | auth/admin | cinco controles false, counters sanitizados | metricas no exportadas aun | contract/runtime |
| `GET /admin/sofia/conversations/inbox` | SofiaService + DB | scope sanitizado | real, internal y sandbox separados | owner allowlist pendiente | reconciliation/UI |
| `GET /admin/sofia/whatsapp/qr/status` | socket vivo + config | QR enabled | `DISABLED`, sin QR ni adapter en canary | QR fisico no ejecutado | contract/UI |
| `POST /admin/sofia/whatsapp/qr/test-send` | QR gateway | real send + kill/pause | siempre bloqueado en canary | canal real no ejecutado | negative runtime |
| `POST /admin/sofia/outbound/:id/approve-send` | Whatsapp service | gate central + provider | bloqueo antes del provider | staging remoto pendiente | negative runtime |
| `POST /admin/sofia/outbound/:id/retry` | Whatsapp service | gate central + dedup | bloqueo sin retry externo | metricas externas pendientes | negative runtime |
| `POST /integrations/whatsapp/:provider/webhook` | adapter + DB | pause/kill/allowlist/dedup | receive-only, fail-closed | solo adapter sintetico | synthetic runtime |
| `POST /admin/sofia/governance/pause` | Setting + audit | admin | pausa independiente y reversible | approvals remotos pendientes | runtime priority |
| `POST /admin/sofia/control/kill-switch/*` | Setting + audit | admin | precedencia maxima | runbook remoto pendiente | runtime priority |
| `GET /admin/sofia/ai/status` | provider factory + config | dry-run | dry-run honesto, externo OFF | llamada externa fuera de politica canary | contract/UI |
| Auto Safe engine | config + safety + DB | autoSafe + production + pause/kill | `shouldSend=false` | gate fisico pendiente | unit/critical |
| Allowlist | normalizador central | exact match | fail-closed, telefono masked | lista comercial owner pendiente | table/runtime |
| Runtime counters | safety service | auth/admin | counters sin PII | persistencia/exporter Phase 2.4 | reconciliation |

## Precedencia demostrada

`KILL SWITCH > PAUSE > PRODUCTION > AUTO SAFE > AUTO REPLY > REAL SEND`.

No se identifico una ruta publica que omita el gate central. El endpoint sintetico de tests usa una opcion interna no aceptada desde payload publico y solo existe para pruebas autenticadas.
