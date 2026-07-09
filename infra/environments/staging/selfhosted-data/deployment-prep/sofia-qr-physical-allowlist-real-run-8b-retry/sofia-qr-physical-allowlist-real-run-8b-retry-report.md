# SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B-RETRY - Reporte final

## 1. Resumen ejecutivo

La fase 8B-RETRY se ejecutó hasta el límite seguro permitido por el entorno actual. El sistema permanece seguro: health PASS, typecheck/build PASS para web y API, endpoints admin protegidos, sin activación real, sin secretos expuestos y sin acciones destructivas de Prisma.

La fase no puede cerrar GO porque no se configuró allowlist real local, no se generó/escaneó QR físico, no se validó estado CONNECTED y no se recibió inbound real desde número allowlist.

Decisión final: **SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B-RETRY: NO-GO**.

## 2. Estado recibido

- 8A UI/UX Premium: GO CONDICIONADO ACEPTABLE.
- 8A Gate Fix: GO CONDICIONADO ACEPTABLE.
- 8A.2 Clean Governance Dashboard: GO.
- 8B previo: GO CONDICIONADO.
- Pendientes físicos recibidos: allowlist real, QR físico, CONNECTED real, inbound real allowlist y conversaciones reales.

## 3. Objetivo de 8B-RETRY

Cerrar la validación física real de WhatsApp QR en modo `receive_only`, con allowlist local, inbound real visible en `/sofia/conversations`, outbound real en cero y producción bloqueada.

## 4. Allowlist sanitizada

El precheck sanitizado confirmó que no hay allowlist real configurada:

- `configured=false`
- `count=0`
- `phones=[]`
- `mode=receive_only`

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/allowlist-sanitized-precheck.json`

Se dejó creado un script local seguro para configurar allowlist sin imprimir el número completo:

`/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/configure_allowlist.py`

El script no fue ejecutado porque no hay número real disponible en el entorno y no se debe recibir/imprimir el número completo por chat o reporte.

## 5. QR_READY

No se generó QR real en esta ejecución porque la fase se detuvo al detectar que la allowlist real no está configurada.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/allowlist-sanitized-precheck.json`

## 6. CONNECTED real

No se validó `CONNECTED` real. Sin allowlist real configurada, no corresponde avanzar a escaneo físico ni afirmar conexión.

## 7. Inbound real allowlist

No se recibió inbound real desde número allowlist porque no existe allowlist real configurada y no hubo QR físico CONNECTED.

## 8. Mensajes reales probados

No se probaron mensajes reales. Los casos previstos quedan pendientes:

- `Hola`
- `Qué trae el Maxi Family`
- `Quiero un 2x1`
- `Ya pagué por Nequi`
- `Quiero hablar con alguien`
- `Quiero sushi`

## 9. Conversations

No se validaron conversaciones reales de QR físico allowlist en `/sofia/conversations`.

## 10. Provider `qr_gateway`

El precheck de `.env` no mostró `WHATSAPP_PROVIDER=qr_gateway`; por lo tanto no se puede afirmar provider efectivo desde configuración local en esta ejecución.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 11. Mode `receive_only`

El precheck confirmó `WHATSAPP_MODE=receive_only`.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 12. SafetyGuard

No se ejecutó flujo real inbound; SafetyGuard no pudo validarse con mensajes reales en esta fase. Las reglas siguen presentes en código y los checks de frases prohibidas solo encontraron usos permitidos en blocklists, prompt técnico, tests negativos o configuración técnica.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/maxi-family-prohibited-phrases-check.log`

## 13. Auto Safe dry-run/no productivo

No se ejecutó Auto Safe sobre inbound real porque no hubo inbound real. Los flags seguros confirman que Auto Safe productivo sigue desactivado.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 14. Maxi Family

No se probó Maxi Family con inbound real en esta ejecución. Los checks de frases prohibidas no detectaron copy comercial permitido con frases prohibidas.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/maxi-family-prohibited-phrases-check.log`

## 15. Nequi/PAID

No se probó `Ya pagué por Nequi` con inbound real. No se detectó activación real ni cambio de pagos en esta fase.

## 16. Human required

No se probó `Quiero hablar con alguien` con inbound real. Queda pendiente para ejecución física.

## 17. Unknown product

No se probó `Quiero sushi` con inbound real. Queda pendiente para ejecución física.

## 18. No allowlist

No se validó número no allowlist porque no hay allowlist base configurada.

## 19. Deduplicación

No se validó deduplicación real/controlada en esta ejecución porque no se avanzó a inbound.

## 20. Test-send bloqueado

No se ejecutó test-send real ni endpoint autenticado. El endpoint admin sin sesión se mantiene protegido con `401 Unauthorized`.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/qr-status-auth-check.log`

## 21. Outbound SENT = 0

No hubo flujo inbound real ni test-send real. Al no activarse envío real y no ejecutarse inbound, no hay evidencia de mensajes `SENT` generados durante esta fase.

## 22. Governance después de inbound

No aplica: no hubo inbound real.

## 23. Producción bloqueada

No se activó producción. El check de no activación real quedó vacío.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/no-real-activation-check.log`

## 24. DeepSeek real disabled

`DEEPSEEK_ENABLED=false` confirmado.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 25. WhatsApp real send blocked

`WHATSAPP_QR_ALLOW_REAL_SEND=false` confirmado.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 26. Auto reply disabled

`SOFIA_AUTO_REPLY_ENABLED=false` confirmado.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 27. Auto Safe producción disabled

`SOFIA_AUTO_SAFE_ENABLED=false` confirmado.

Evidencia: `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/precheck-safe-flags.log`

## 28. POS/Caja/Stock/Checkout intactos

No se modificaron POS, Caja, Stock, Checkout, Domicilios, Pagos, catálogo ni precios. No se ejecutaron migraciones destructivas ni Prisma reset.

## 29. Screenshots

No se generaron screenshots físicos porque no hubo allowlist real ni QR físico. No se afirma evidencia visual inexistente.

## 30. Build/typecheck

- Web typecheck: PASS.
- Web build: PASS.
- API typecheck: PASS.
- API build: PASS.

Evidencias:

- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/web-typecheck.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/web-build.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/api-typecheck.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/api-build.log`

## 31. Prisma Guard/API tests condition

No se ejecutaron API tests porque `infra/scripts/test-api.sh` llama a `infra/scripts/prepare-test-db.sh`, que ejecuta `prisma migrate reset --force`. Se documentó como:

`BLOCKED_BY_PRISMA_AI_GUARD_SAFE`

No se usó bypass, no se usó consentimiento peligroso y no se ejecutó reset/migración destructiva.

Evidencias:

- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/test-api-script-audit.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/prepare-test-db-script-audit.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/tests.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/api-test-exit-code.log`

## 32. Checks seguridad

- `test.skip`: vacío.
- `process.exit(0)`: vacío.
- Secret regression: vacío.
- No real activation: vacío.
- Maxi Family prohibited phrases: solo apariciones permitidas en blocklists/tests/documentación técnica/configuración técnica.

Evidencias:

- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/test-skip-check.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/process-exit-check.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/secret-regression-check.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/no-real-activation-check.log`
- `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/maxi-family-prohibited-phrases-check.log`

## 33. Riesgos residuales

- Allowlist real no configurada.
- QR físico real no generado.
- WhatsApp Business no escaneó QR.
- `CONNECTED` real no validado.
- Inbound real allowlist no recibido.
- `/sofia/conversations` no validado con inbound físico real.
- Outbound `SENT=0` no validado contra un flujo real.
- Test-send bloqueado no validado desde UI autenticada.
- API tests completos siguen bloqueados por Prisma Guard seguro.

## 34. Próxima fase recomendada

Reintentar 8B-RETRY después de que el operador configure el número localmente con:

```bash
python3 /tmp/sofia-qr-physical-allowlist-real-run-8b-retry/configure_allowlist.py
docker compose restart api web
```

Luego validar QR físico, `CONNECTED`, inbound real y screenshots. No pegar el número en chat ni incluirlo en reportes.

## 35. Decisión final

**SOFIA-QR-PHYSICAL-ALLOWLIST-REAL-RUN-8B-RETRY: NO-GO**

Motivo: no se cumplen los criterios obligatorios de GO: allowlist real, QR físico escaneado, `CONNECTED` real e inbound real allowlist.

## Tabla 1: Componente

| Componente | Resultado | Evidencia | Estado |
|---|---|---|---|
| Health inicial | PASS | `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/health-before.log` | PASS |
| Allowlist real | No configurada | `/tmp/sofia-qr-physical-allowlist-real-run-8b-retry/allowlist-sanitized-precheck.json` | FAIL |
| QR físico | No generado | Allowlist faltante | FAIL |
| CONNECTED real | No validado | QR físico no ejecutado | FAIL |
| Inbound real | No recibido | Sin CONNECTED real | FAIL |
| Web typecheck/build | PASS | logs web | PASS |
| API typecheck/build | PASS | logs API | PASS |
| API tests | Bloqueado seguro | `BLOCKED_BY_PRISMA_AI_GUARD_SAFE` | CONDITION |

## Tabla 2: QR físico

| QR físico | Resultado | Evidencia | Estado |
|---|---|---|---|
| QR_READY | No ejecutado | Allowlist real ausente | FAIL |
| Escaneo WhatsApp Business | No ejecutado | QR no generado | FAIL |
| CONNECTED | No validado | Sin escaneo físico | FAIL |
| Real send OFF | Confirmado por flag | `WHATSAPP_QR_ALLOW_REAL_SEND=false` | PASS |

## Tabla 3: Inbound real

| Inbound real | Resultado | Evidencia | Estado |
|---|---|---|---|
| `Hola` | No probado | Sin inbound real | FAIL |
| `Qué trae el Maxi Family` | No probado | Sin inbound real | FAIL |
| `Quiero un 2x1` | No probado | Sin inbound real | FAIL |
| `Ya pagué por Nequi` | No probado | Sin inbound real | FAIL |
| `Quiero hablar con alguien` | No probado | Sin inbound real | FAIL |
| `Quiero sushi` | No probado | Sin inbound real | FAIL |

## Tabla 4: Casos críticos

| Casos críticos | Resultado | Evidencia | Estado |
|---|---|---|---|
| Maxi Family correcto | No validado en inbound real | Sin inbound real | FAIL |
| Nequi no marca PAID | No validado en inbound real | Sin inbound real | FAIL |
| Human required | No validado en inbound real | Sin inbound real | FAIL |
| Unknown product | No validado en inbound real | Sin inbound real | FAIL |
| No allowlist bloqueado | No validado | Sin allowlist base | FAIL |
| Deduplicación | No validada | Sin inbound real | FAIL |

## Tabla 5: Bloqueos de seguridad

| Bloqueos de seguridad | Estado | Evidencia |
|---|---|---|
| DeepSeek real | OFF | `DEEPSEEK_ENABLED=false` |
| Auto reply | OFF | `SOFIA_AUTO_REPLY_ENABLED=false` |
| Auto Safe productivo | OFF | `SOFIA_AUTO_SAFE_ENABLED=false` |
| WhatsApp real send | OFF | `WHATSAPP_QR_ALLOW_REAL_SEND=false` |
| Producción | No activada | `no-real-activation-check.log` vacío |
| Secretos | No expuestos | `secret-regression-check.log` vacío |
| Admin QR endpoint | Protegido | `401 Unauthorized` |

## Tabla 6: Gate técnico

| Gate técnico | Resultado | Evidencia |
|---|---|---|
| Web typecheck | PASS | `web-typecheck.log` |
| Web build | PASS | `web-build.log` |
| API typecheck | PASS | `api-typecheck.log` |
| API build | PASS | `api-build.log` |
| API tests | BLOCKED_BY_PRISMA_AI_GUARD_SAFE | `tests.log` |
| test.skip | PASS | archivo vacío |
| process.exit(0) | PASS | archivo vacío |
| Secret regression | PASS | archivo vacío |
| No real activation | PASS | archivo vacío |

## Tabla 7: Qué no se tocó

| Qué no se tocó | Estado | Evidencia |
|---|---|---|
| POS | Intacto | Sin cambios ejecutados |
| Caja | Intacta | Sin cambios ejecutados |
| Stock | Intacto | Sin cambios ejecutados |
| Checkout | Intacto | Sin cambios ejecutados |
| Domicilios | Intacto | Sin cambios ejecutados |
| Pagos | Intacto | Sin cambios ejecutados |
| Catálogo/precios | Intacto | Sin cambios ejecutados |
| Prisma reset/migrate destructivo | No ejecutado | `BLOCKED_BY_PRISMA_AI_GUARD_SAFE` |
