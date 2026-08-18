# Evidencia — bridge de forward-compatibility para migración 39 (correlación de sugerencias SOFIA AI)

- Fecha: 2026-08-18
- Registrado por: sesión de agente (Claude Code), a petición del owner
- Alcance: `apps/api/src/modules/health/migration-identity.ts` únicamente (más sus pruebas). No se incluye la migración 39, no se activa producción, no se toca runtime safety ni governance.
- Autorización owner: `SOFIA_AI_SUGGESTION_CORRELATION_FORWARD_COMPATIBILITY_2026-08-17`, limitada explícitamente a demostrar compatibilidad forward/rollback de esta migración. No autoriza deployment productivo, `migrate deploy` productivo, activación SOFIA, WhatsApp outbound, pagos, pedidos, cocina, ni modificación de datos productivos.

## Contexto

PR #31 (`feat/sofia-ai-supervised-suggestion-wiring`) introduce la migración
`20260817120000_sofia_ai_suggestion_correlation` (FK nullable
`WhatsappOutboundMessage.autoSafeDecisionEventId -> SofiaAutoSafeDecisionEvent`).
El job `canary-rollback` de CI falló porque el mecanismo de identidad de
migraciones (`migration-identity.ts`) de la imagen baseline fija del rollback
drill no reconocía esa migración — comportamiento correcto y esperado
(fail-closed) de un `PERMANENT_SAFETY_INVARIANT`, no un defecto de la
migración. Esta fase separada prepara — sin activar nada — el bridge que
permitiría a un runtime cuyo frontier esperado es 38 aceptar exactamente esa
migración como forward-compatible, sin debilitar el resto del mecanismo.

## Diseño anterior vs. nuevo

**Antes:** `AUTHORIZED_FORWARD_MIGRATIONS` era un arreglo evaluado
posicionalmente completo: `additionalRows.length === AUTHORIZED_FORWARD_MIGRATIONS.length`,
comparando cada fila adicional contra la entrada del mismo índice. Con una
sola entrada (Phase 8, base 37) esto funcionaba, pero añadir una segunda
entrada de forma ingenua habría exigido que *ambas* migraciones estuvieran
presentes simultáneamente para que cualquiera de las dos fuera aceptada —
rompiendo la compatibilidad 37→38 para cualquier runtime que solo viera la
migración 38.

**Después:** cada entrada de `AUTHORIZED_FORWARD_MIGRATIONS` es un bridge
independiente, seleccionado por la huella exacta de la base del runtime que
evalúa (`baseMigrationCount` + `baseLatestMigration` + `baseInventoryFingerprint`),
no por posición. `findAuthorizedForwardBridge()` busca la única entrada cuya
base coincide exactamente con el `expectedInventory` del runtime que llama, y
exige que las filas adicionales sean *exactamente una* migración que coincida
en nombre y checksum con esa entrada. Un runtime en frontier 37 nunca
considera la entrada de frontier 38 y viceversa. Ninguna combinación de
múltiples migraciones no autorizadas (encadenadas o no) se acepta jamás —
solo un salto de exactamente una migración por bridge.

## Valores verificados de forma independiente

Todos calculados con Node ejecutando el mismo código de producción
(`infra/schema/migration-expectation.mjs`) que genera el manifest de release,
no copiados manualmente:

| Campo | Valor | Verificación |
|---|---|---|
| `MIGRATION39_NAME` | `20260817120000_sofia_ai_suggestion_correlation` | nombre exacto del directorio de migración en PR #31 |
| `MIGRATION39_CHECKSUM` | `660d122232054cd1d744b8017d90688c45cf3cb0613361ccc12e787246b77d97` | `sha256(migration.sql)` calculado desde el archivo exacto de PR #31, cruzado con `sha256sum` independiente — coinciden |
| `BASE_MIGRATION_COUNT` | `38` | conteo de migraciones en `main` actual |
| `BASE_LATEST_MIGRATION` | `20260812130000_sofia_crm_product_core` | última migración en `main` actual |
| `BASE_INVENTORY_FINGERPRINT` | `5cf17b1a70a5bacfb9e913a9870a1e39c2317dd77133aeccfa991dabb5291c45` | `sha256(JSON.stringify(inventory))` sobre las 38 migraciones de `main` |

**Validación cruzada del método:** antes de confiar en el fingerprint nuevo,
se recalculó el fingerprint de frontier 37 con el mismo método y se comparó
contra el valor ya hardcodeado en el mecanismo existente
(`130bc2f2b8338c4340f316bfb740b4933db7a5c93b8d0ddb9b1eb8a59f18d1e8`) —
coinciden exactamente, confirmando que el método de cálculo es correcto antes
de aplicarlo al valor nuevo.

## Casos de prueba (los 10 solicitados + 3 adicionales)

Archivo nuevo: `apps/api/src/modules/health/migration-identity-forward-bridge.spec.ts`.

| Caso | Escenario | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| 1 | runtime 37, DB 37 | EXACT PASS | PASS |
| 2 | runtime 37, DB 38 autorizada | FORWARD_COMPATIBLE PASS (sin cambio) | PASS |
| 3 | runtime 38, DB 38 | EXACT PASS | PASS |
| 4 | runtime 38, DB 39 autorizada | FORWARD_COMPATIBLE PASS | PASS |
| 5 | runtime 38, DB 39 checksum alterado | FAIL CLOSED | PASS |
| 6 | runtime 38, DB migración desconocida | FAIL CLOSED | PASS |
| 7 | runtime 38, DB 39 + migración 40 desconocida | FAIL CLOSED | PASS |
| 8 | runtime 37, DB 38+39 | FAIL CLOSED (explícito, no encadenamiento accidental) | PASS |
| 9 | orden de migraciones incorrecto | FAIL CLOSED | PASS |
| 10 | migración rolledBack/incompleta | FAIL CLOSED | PASS |
| extra | runtime 37 ve migración 39 directamente sin 38 aplicada | FAIL CLOSED | PASS |
| extra | filas duplicadas de migración 39 sobre frontier 38 | FAIL CLOSED | PASS |
| extra | checksum de migración SQL vinculado al archivo real del PR #31 | coincide | PASS |

13/13 PASS. Suite completa de `migration-identity.spec.ts` (preexistente,
19 tests) también PASS sin modificación — cero regresión en el bridge
37→38 ni en ningún otro camino existente.

## No regresión confirmada

- `SOFIA_MACRO_PHASE_8_CRM_DOMAIN_EXTENSION_2026-08-13` permanece exactamente
  igual (mismo `baseMigrationCount`, `baseLatestMigration`,
  `baseInventoryFingerprint`, `migrationName`, `checksum`,
  `authorizationReference`).
- `AUTHORIZED_ATTESTATION` (mecanismo de attestation de checksum, separado
  del forward-bridge) no se tocó.
- Ninguna combinación de múltiples migraciones no autorizadas se acepta —
  verificado explícitamente en los casos 7 y 8.
- El fail-closed se preserva en todos los casos: entrada sin bridge
  coincidente, checksum incorrecto, nombre incorrecto, orden incorrecto,
  historial incompleto/rolled-back — todos producen
  `MIGRATION_HISTORY_INCOMPATIBLE`.

## Qué NO incluye este cambio

- La migración `20260817120000_sofia_ai_suggestion_correlation` en sí misma
  no está en esta rama — el bridge la conoce únicamente por nombre, checksum,
  base y referencia de autorización, tal como pidió el owner.
- No se desplegó nada a producción. No se ejecutó `migrate deploy`
  productivo. No se activó SOFIA, WhatsApp outbound, pagos, pedidos, cocina
  ni domicilios.
- No se modificó `SofiaRuntimeSafetyService`, `SofiaGovernanceService` ni
  `env.ts`.
