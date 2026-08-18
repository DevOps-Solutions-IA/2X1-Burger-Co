# Hallazgo — cobertura de redacción PII más débil en respuestas admin de SOFIA que en logs

- Fecha de registro: 2026-08-17
- Estado: **Corregido** (2026-08-17, rama `feat/sofia-ai-supervised-suggestion-wiring`) — ver "Corrección aplicada" al final de este documento.
- Componente: `apps/api/src/modules/sofia/privacy/sofia-admin-response-sanitizer.interceptor.ts`
- Descubierto durante: auditoría READ-ONLY de gates de producción de SOFIA (2026-08-17)

## Severidad

**Media.** Requiere acceso admin ya autenticado (`@Controller('admin/sofia')`, protegido por `JwtAuthGuard`/`RolesGuard`) para ser explotable — no es accesible externamente ni sin RBAC. No es un hallazgo crítico, pero es una inconsistencia real de diseño en una capa que existe específicamente para proteger PII.

## Alcance

Afecta a **todas** las respuestas HTTP del controlador `admin/sofia` (todo el panel administrativo de SOFIA), no a un endpoint aislado.

## Descripción

El proyecto tiene dos mecanismos de redacción de PII independientes, con cobertura distinta:

1. **`sanitizeJson`** (`apps/api/src/modules/sofia/privacy/sofia-pii-redaction.ts`) — usado para logs. Es **recursivo sobre todo string anidado**: escanea el contenido de texto libre en busca de patrones (teléfono, correo, secretos) sin importar el nombre de la clave que lo contiene.

2. **`SofiaAdminResponseSanitizerInterceptor`** — usado para las respuestas HTTP del panel admin. Su lógica es más limitada:
   - Solo redacta campos **cuyo nombre de clave contiene la palabra "phone"** (`isPhoneKey`).
   - **No aplica ningún escaneo de patrón sobre texto libre** — si un campo de respuesta como `notes`, `message`, `lastCustomerMessage`, etc. contiene un teléfono o correo incrustado en el texto (no en un campo llamado explícitamente "phone"), ese valor **no se redacta**.
   - Cualquier objeto con método `toJSON` (ej. `Decimal` de Prisma) se retorna **sin recursión ni sanitización alguna** (`if (typeof value.toJSON === 'function') return value;`).

## Escenario de riesgo concreto

Un administrador autenticado con permiso para ver un endpoint de `admin/sofia` que
incluya, por ejemplo, el resumen de una conversación (`sanitizedSummary`) o una nota
de caso de servicio al cliente con un número de teléfono u otro dato personal escrito
como texto libre (no en un campo llamado "phone"), vería ese dato sin enmascarar en
la respuesta HTTP — aunque el mismo dato, si terminara en un log, sí quedaría
redactado por `sanitizeJson`.

## Por qué no se corrige en este documento

Fuera del alcance autorizado para esta tarea (documentación de evidencia del canary
receive-only). Se registra aquí exclusivamente para que quede trazado y priorizable.

## Recomendación

1. Hacer que `SofiaAdminResponseSanitizerInterceptor` reutilice `redactSensitiveText`/`sanitizeJson`
   sobre cada valor string (no solo por nombre de clave), igual que el camino de logs.
2. Manejar explícitamente objetos con `toJSON` (ej. convertir a primitivo antes de
   decidir si sanitizar, en vez de retornarlos sin pasar por la recursión).
3. Añadir un test que cubra explícitamente un campo de texto libre con un teléfono/correo
   incrustado (el test actual, `sofia-admin-response-sanitizer.interceptor.spec.ts`, solo
   cubre objetos planos con claves ya nombradas "phone").

Este cambio, si se autoriza, es contenido dentro de un solo archivo de interceptor y
sus tests — no requiere tocar ninguna de las 4 capas de bloqueo de producción ni
ningún archivo de la lista "NO modificar todavía" de esta sesión.

## Corrección aplicada (2026-08-17)

Autorizado explícitamente en el alcance de "SOFIA WIRING PHASE 1". Cambios, contenidos
exactamente a `sofia-admin-response-sanitizer.interceptor.ts` y su spec:

1. `sanitize()` ahora aplica `redactSensitiveText` a **todo** valor string durante la
   recursión (no solo a los que tienen clave `phone`), igual que `sanitizeJson`. Los
   campos con clave `phone` conservan el enmascarado exacto (`maskPhone`, últimos 4
   dígitos visibles) para no romper el contrato existente del panel.
2. Los objetos con `toJSON` (ej. `Decimal` de Prisma) ahora se convierten a su
   primitivo (`toJSON()`) y ese resultado pasa por `sanitize()` en vez de devolverse
   intacto.
3. Tests añadidos: teléfono/correo incrustados en `notes`/`lastCustomerMessage` (texto
   libre, no en clave "phone") quedan redactados; un valor con `toJSON` se convierte y
   se sanitiza. Los 3 tests preexistentes siguen en verde sin modificación.

5/5 tests pasando localmente (`npx jest privacy/sofia-admin-response-sanitizer.interceptor.spec.ts`).
