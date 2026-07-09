# CLEAN-DELIVERY-UI-DEEPSEEK-0 — Remove Wrong Manual-First Visual Changes Safely

Fecha: 2026-06-21

## 1. Resumen ejecutivo

Se limpió el copy manual-first y el voseo introducido o reforzado en la UI de domicilios/POS sin tocar backend, Prisma, migraciones, delivery engine, checkout core, Caja core, auth, cookies, Nginx ni providers.

Decisión final:

**CLEAN-DELIVERY-UI-DEEPSEEK-0: GO**

## 2. Qué hizo DeepSeek

La intervención visual previa dejó textos que empujaban la operación hacia tarifa manual y justificación manual como eje del panel de domicilios:

- “tarifa acordada”.
- “manual justificada”.
- “Define la tarifa”.
- “Ingresa el valor acordado”.
- “Cotización manual”.
- Voseo en copy operativo.

## 3. Por qué no era el enfoque correcto

La dirección estratégica aprobada es **FULLY AUTOMATED DELIVERY PRICING**:

- Backend calcula la tarifa.
- Frontend muestra resultado.
- No se debe convertir al cajero en motor de pricing.
- No se debe reforzar tarifa manual como experiencia principal.

Esta fase no implementa el modelo automático final; solo limpia el copy incorrecto para dejar la base estable.

## 4. Archivos revisados

- `apps/web/src/app/(app)/pos/page.tsx`
- `apps/web/src/app/(delivery)/delivery/page.tsx`
- `apps/web/src/app/(app)/recipes/page.tsx`
- `apps/web/src/app/(app)/dashboard/page.tsx`
- `apps/web/src/app/(app)/deliveries/page.tsx`
- `apps/web/src/app/(app)/inventory/page.tsx`
- `apps/web/src/app/(app)/settings/page.tsx`
- `apps/web/src/components/error-boundary.tsx`
- `tests/e2e/audit8g2-delivery-final.spec.ts`

## 5. Cambios eliminados

- Se removió copy manual-first en POS.
- Se removió voseo detectado por grep en frontend.
- Se removieron textos de “cotización manual” como protagonista.
- No se encontró `data-testid-new`.

## 6. Copy corregido

Ejemplos:

- “Completa la direccion...” → “Completa la dirección...”
- “ingresá la tarifa acordada...” → copy neutral de corrección de dirección/observación.
- “Confirmá manualmente” → “Confirma la información”.
- “Define la tarifa y justifica” → copy neutral de cálculo pendiente.
- “Domicilio manual (COP)” → “Tarifa del domicilio (COP)”.
- “Motivo de ajuste manual” → “Observación del ajuste”.

## 7. Atributos inválidos eliminados

Resultado grep:

- `data-testid-new`: 0 ocurrencias.

Evidencia:

- `/tmp/clean-delivery-ui-deepseek-0/deepseek-ui-map-final.log`

## 8. Data-testid preservados

No se borraron test ids existentes requeridos por 8G.2:

- `pos-delivery-panel`
- `delivery-manual-quote-panel`
- `pos-delivery-pricing-status`
- `pos-delivery-suggested-fee`
- `pos-delivery-final-fee`
- `pos-delivery-manual-fee-input`
- `pos-delivery-manual-reason`
- `pos-delivery-save`
- `pos-checkout-button`

## 9. Qué NO se tocó

- Backend.
- Prisma.
- Migraciones.
- Delivery engine.
- Checkout core.
- Caja core.
- Auth.
- Cookies.
- Nginx.
- Providers externos.
- Columnas legacy/manuales.
- Contratos de persistencia.

## 10. Validación web typecheck

Resultado:

- PASS.

Evidencia:

- `/tmp/clean-delivery-ui-deepseek-0/web-typecheck.log`

## 11. Validación web build

Resultado:

- PASS.

Notas:

- Persisten warnings P3 `no-explicit-any` ya conocidos.
- No bloquean build.

Evidencia:

- `/tmp/clean-delivery-ui-deepseek-0/web-build.log`

## 12. Validación E2E delivery 8G.2

Resultado:

- PASS.
- `tests/e2e/audit8g2-delivery-final.spec.ts`: 2/2 PASS.

Ajuste de harness:

- Se endureció `openDeliveryDraft` para reautenticar si el flujo largo cae en `/login` por auth stale.
- No se alteró lógica de negocio.

Evidencia:

- `/tmp/clean-delivery-ui-deepseek-0/delivery-8g2-regression-final.log`

## 13. Health

Resultado:

- PASS.

Evidencia:

- `/tmp/clean-delivery-ui-deepseek-0/health.log`

## 14. Riesgos residuales

- Los campos funcionales de tarifa/observación manual siguen presentes temporalmente para no romper 8G.2.
- La eliminación funcional real debe esperar al backend automático total.
- Persisten warnings P3 `no-explicit-any`.

## 15. Próxima fase recomendada

**PHASE-DELIVERY-AUTO-1 — Backend automático total**

Objetivo:

- Backend calcula todo.
- Frontend deja de operar como manual-first.
- UI solo muestra resultado automático, estado y explicación.

## 16. Decisión final

**CLEAN-DELIVERY-UI-DEEPSEEK-0: GO**

Criterios cumplidos:

- No se tocó backend.
- No se tocó delivery engine.
- No se tocó auth.
- No se tocó checkout core.
- No se tocó Caja core.
- Copy manual-first nuevo removido/neutralizado.
- No queda voseo buscado.
- No queda `data-testid-new`.
- Web typecheck PASS.
- Web build PASS.
- Delivery 8G.2 regression PASS.
- Health PASS.
