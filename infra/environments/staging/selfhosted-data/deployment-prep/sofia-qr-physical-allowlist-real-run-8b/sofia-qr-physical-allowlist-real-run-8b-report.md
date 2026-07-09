# SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B - Reporte final

## 1. Resumen ejecutivo
8B se ejecuto hasta el limite seguro del entorno local. El sistema sigue en `receive_only`, sin DeepSeek real, sin auto reply, sin Auto Safe productivo, sin envio real WhatsApp y sin produccion. No se pudo cerrar GO fisico porque no hay allowlist configurada localmente y no hubo operador humano escaneando WhatsApp Business en esta sesion.

Decision final: `SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B: GO CONDICIONADO`.

## 2. Estado recibido
F0/F1/F2/F3/F6 estan cerradas. F4/F5/F8 siguen condicionadas por QR fisico/inbound real. F7 es GO CONDICIONADO aceptable. 8A es GO CONDICIONADO aceptable por Prisma Guard seguro.

## 3. Objetivo real de 8B
Cerrar fisicamente QR real, CONNECTED real e inbound real allowlist en modo receive_only. Ese objetivo requiere numero allowlist local y operador humano con WhatsApp Business.

## 4. Que se configuro
No se configuro allowlist porque no habia numero real disponible en `.env` y no se debe pedir ni registrar el numero completo en logs/chat. Se genero evidencia sanitizada de que `configured=false`.

## 5. Que se modifico
No se modifico codigo, `.env`, Prisma, POS, Caja, Stock, Checkout, Domicilios ni Pagos.

## 6. Que no se toco
No se activo DeepSeek real, auto reply, Auto Safe productivo, envio real WhatsApp, produccion, QR productivo con envio ni pagos reales.

## 7. Allowlist sanitizada
Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b/allowlist-sanitized-precheck.json`.

Resultado:
- `configured=false`.
- `count=0`.
- no se imprimio ningun numero completo.

## 8. QR fisico
No se escaneo QR fisico real. La UI `/sofia/whatsapp-qr` esta disponible y el estado actual muestra QR gateway en receive_only.

## 9. QR_READY real
La UI muestra `Estado QR QR_READY`, pero no se considera validacion fisica completa porque falta escaneo WhatsApp Business y allowlist.

## 10. CONNECTED real
No alcanzado. Condicion pendiente.

## 11. Inbound real allowlist
No ejecutado. Condicion pendiente por falta de allowlist real y telefono operador.

## 12. Mensajes probados
No se enviaron mensajes reales. Se ejecuto validacion controlada de endpoints seguros:
- status QR receive_only;
- test-inbound simulado;
- deduplicacion simulada;
- test-send bloqueado;
- governance bloqueado.

## 13. Conversations
No hay inbound real nuevo. La UI `/sofia/conversations` fue capturada como evidencia visual de estado.

## 14. SafetyGuard
SafetyGuard permanece integrado y no se activo envio real.

## 15. Auto Safe dry-run
Auto Safe productivo permanece disabled. La validacion endpoint mantuvo produccion bloqueada y `whatsappCanMarkPaid=false`.

## 16. Maxi Family
No se modifico catalogo ni reglas Maxi Family. El check de frases prohibidas queda vacio bajo el patron ejecutado.

## 17. Nequi/PAID
No se marco PAID, no se crearon pagos reales y governance conserva `whatsappCanMarkPaid=false`.

## 18. Human required
No se recibio mensaje real. El flujo queda pendiente de prueba fisica allowlist.

## 19. Unknown product
No se recibio mensaje real. El flujo queda pendiente de prueba fisica allowlist.

## 20. No allowlist
No se probo numero no allowlist real. Pendiente.

## 21. Deduplicacion
Validada de forma controlada por endpoint autenticado:
- `duplicate=true`;
- `processingStatus=DUPLICATE_IGNORED`.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b/qr-current-ui-safe-validation.log`.

## 22. Test-send bloqueado
Validado por endpoint autenticado:
- `BLOCKED_REAL_SEND_DISABLED`;
- `sent=false`;
- `realSendingEnabled=false`.

## 23. Outbound SENT = 0
No se detecto envio real; no se habilito send real. No se hizo consulta destructiva directa a DB.

## 24. Metricas/governance
Validacion endpoint:
- production `BLOCKED`;
- `whatsappCanMarkPaid=false`;
- `realSendingEnabled=false`;
- `deepSeekEnabled=false`.

## 25. Produccion bloqueada
No real activation check vacio.

## 26. DeepSeek real disabled
Flag validado: `DEEPSEEK_ENABLED=false`.

## 27. WhatsApp real send blocked
Flag validado: `WHATSAPP_QR_ALLOW_REAL_SEND=false`.

## 28. Auto reply disabled
Flag validado: `SOFIA_AUTO_REPLY_ENABLED=false`.

## 29. Auto Safe produccion disabled
Flag validado: `SOFIA_AUTO_SAFE_ENABLED=false`.

## 30. POS/Caja/Stock/Checkout intactos
No se modificaron flujos ni se ejecuto Prisma reset. Typecheck/build API y web pasan.

## 31. Screenshots
Generados:
- `/tmp/sofia-qr-physical-allowlist-real-run-8b/screenshots/01-whatsapp-qr-initial.png`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b/screenshots/02-qr-ready-real-not-executed.png`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b/screenshots/04-conversations-no-real-inbound.png`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b/screenshots/05-outbox-real-send-blocked-ui.png`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b/screenshots/07-sofia-governance-no-real-inbound.png`

No existen screenshots `03-qr-connected-real`, `04-conversations-inbound-real-allowlist` real ni `06-test-send-blocked` fisico porque no se ejecuto el flujo fisico.

## 32. Logs build/typecheck
- Web typecheck: PASS.
- Web build: PASS con warnings ESLint no bloqueantes.
- API typecheck: PASS.
- API build: PASS.

## 33. Prisma Guard/API tests condition
API tests completos no se ejecutaron porque `infra/scripts/test-api.sh` llama `prepare-test-db.sh`, que ejecuta `prisma migrate reset --force`. No se uso bypass ni variable de consentimiento.

## 34. Checks seguridad
- `test.skip`: vacio.
- `process.exit(0)`: vacio.
- secret regression: vacio.
- no-real-activation: vacio.

## 35. Riesgos residuales
- Allowlist real no configurada.
- QR fisico no escaneado.
- CONNECTED fisico no validado.
- Inbound real allowlist no recibido.
- No allowlist real no probado.
- API tests completos bloqueados por Prisma Guard seguro.

## 36. Proxima fase recomendada
Reejecutar 8B cuando el operador pueda configurar `SOFIA_QR_PILOT_ALLOWED_PHONES` localmente y escanear QR con WhatsApp Business. No avanzar a F9 DeepSeek dry-run hasta completar QR fisico o aceptar formalmente la condicion.

## 37. Decision final
`SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B: GO CONDICIONADO`.

## Tabla 1: Componente | Resultado | Evidencia | Estado
| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Precheck flags | Seguros | `precheck-safe-flags.log` | PASS |
| Allowlist | No configurada | `allowlist-sanitized-precheck.json` | PENDIENTE |
| QR UI | Disponible en receive_only | screenshots | PASS |
| QR fisico | No ejecutado | falta operador | PENDIENTE |
| Inbound real | No ejecutado | falta allowlist | PENDIENTE |
| Test-send | Bloqueado por endpoint | safe validation | PASS |
| Deduplicacion | Simulada PASS | safe validation | PASS |

## Tabla 2: QR fisico | Resultado | Evidencia | Estado
| QR fisico | Resultado | Evidencia | Estado |
|---|---|---|---|
| Initial UI | Capturada | `01-whatsapp-qr-initial.png` | PASS |
| QR_READY | UI muestra QR_READY | `02-qr-ready-real-not-executed.png` | CONDICION |
| CONNECTED | No validado | sin escaneo humano | PENDIENTE |
| WhatsApp Business scan | No ejecutado | sin operador | PENDIENTE |

## Tabla 3: Inbound real | Resultado | Evidencia | Estado
| Inbound real | Resultado | Evidencia | Estado |
|---|---|---|---|
| Allowlist real | No configurada | configured=false | PENDIENTE |
| Mensajes reales | No enviados | sin telefono allowlist | PENDIENTE |
| Conversations real | No validado | screenshot sin inbound real | PENDIENTE |
| Inbound simulado | PASS | endpoint safe validation | PASS |

## Tabla 4: Casos criticos | Resultado | Evidencia | Estado
| Casos criticos | Resultado | Evidencia | Estado |
|---|---|---|---|
| Maxi Family | Sin cambios y check limpio | maxicopy check | PASS |
| Nequi/PAID | PAID bloqueado | governance validation | PASS |
| Human required | Pendiente real | falta inbound real | PENDIENTE |
| Unknown product | Pendiente real | falta inbound real | PENDIENTE |
| No allowlist | Pendiente real | falta segundo numero | PENDIENTE |

## Tabla 5: Bloqueos de seguridad | Estado | Evidencia
| Bloqueos de seguridad | Estado | Evidencia |
|---|---|---|
| Produccion | BLOCKED | no-real-activation check |
| DeepSeek real | DISABLED | flags |
| Auto reply | DISABLED | flags |
| Auto Safe productivo | DISABLED | flags |
| WhatsApp real send | BLOCKED | flags + endpoint validation |
| WhatsApp PAID | BLOCKED | governance validation |
| Prisma reset | No ejecutado | script audit |

## Tabla 6: Gate tecnico | Resultado | Evidencia
| Gate tecnico | Resultado | Evidencia |
|---|---|---|
| Docker/health | PASS | docker/health logs |
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS | `web-build.log` |
| API typecheck | PASS | `api-typecheck.log` |
| API build | PASS | `api-build.log` |
| API tests | BLOCKED_SAFE | Prisma reset audit |
| Checks seguridad | PASS | logs vacios |

## Tabla 7: Que no se toco | Estado | Evidencia
| Que no se toco | Estado | Evidencia |
|---|---|---|
| POS | Intacto | sin cambios |
| Caja | Intacta | sin reset |
| Stock | Intacto | sin cambios |
| Checkout | Intacto | sin cambios |
| Domicilios | Intacto | sin cambios |
| Pagos reales | Intactos | sin PAID |
| `.env` completo | No impreso | solo flags seguros |
