# PHASE-DELIVERY-AUTO-2 — POS Automated Delivery Display Only

Fecha UTC: 2026-06-21

## 1. Resumen ejecutivo

El POS fue convertido de flujo manual-first a flujo de captura + visualización automática:

- El cajero captura dirección, barrio/sector y referencia.
- El POS llama a `POST /delivery-pricing/estimate`.
- La tarifa visible proviene solo del backend.
- Se eliminó el input operativo de tarifa manual.
- Se eliminó el motivo manual como flujo operativo.
- Guardar/cobrar queda bloqueado visualmente cuando `canCheckout=false`.
- Se agregó E2E nuevo para el flujo automático.

Decisión: **GO**.

## 2. Estado recibido

- AUDIT-8G.2: GO.
- SYS-1: GO.
- CLEAN-DELIVERY-UI-DEEPSEEK-0: GO.
- PHASE-DELIVERY-AUTO-1: GO.

PHASE-1 ya dejó el backend como fuente operativa de verdad y bloqueó `deliveryFee` arbitrario.

## 3. Manualidad encontrada en POS

Archivo auditado: `apps/web/src/app/(app)/pos/page.tsx`.

Hallazgos iniciales:

| Archivo | Hallazgo manual | Riesgo | Acción |
|---|---|---|---|
| `pos/page.tsx` | `deliveryFeeEditReason` como estado operativo | Manual-first | Removido del flujo operativo |
| `pos/page.tsx` | `pos-delivery-manual-fee-input` | Cajero podía inventar tarifa | Eliminado del DOM operativo |
| `pos/page.tsx` | `pos-delivery-manual-reason` | Motivo manual seguía siendo flujo normal | Eliminado del DOM operativo |
| `pos/page.tsx` | Envío de `deliveryFee` al guardar/checkout | Riesgo de fee libre desde frontend | Eliminado del payload |
| `tests/e2e/audit8g2-delivery-final.spec.ts` | E2E dependiente de manual fee | Obsoleto para modelo automático | Reemplazado por `phase-delivery-auto-2-pos-display.spec.ts` |

## 4. UI manual eliminada

Se eliminaron del flujo operativo:

- Input de tarifa manual.
- Input de motivo manual.
- `delivery-manual-quote-panel`.
- Envío de `deliveryFee` desde POS.
- Envío de `deliveryFeeEditReason` desde POS.
- Copy de confirmación manual como protagonista.

Quedan en tipos de frontend campos legacy (`deliveryFeeEdited`, `deliveryFeeEditReason`) solo para hidratar datos históricos si existen.

## 5. Nuevo flujo POS automático

Estados visuales:

- `PENDING`
- `CALCULATING`
- `LOCAL_FREE`
- `AUTO_PRICED`
- `NEEDS_ADDRESS_CORRECTION`
- `PROVIDER_UNAVAILABLE`
- `OUT_OF_COVERAGE`
- `ERROR_RETRYABLE`

Reglas UI:

- `LOCAL_FREE`: muestra COP 0 y habilita guardar/cobrar.
- `AUTO_PRICED`: muestra tarifa calculada por backend y habilita guardar/cobrar.
- `NEEDS_ADDRESS_CORRECTION`: pide corregir dirección y bloquea guardar/cobrar.
- `PROVIDER_UNAVAILABLE`: muestra mensaje claro, no inventa tarifa y bloquea guardar/cobrar.
- `OUT_OF_COVERAGE`: bloquea guardar/cobrar.

## 6. Trigger automático

El POS estima automáticamente cuando:

- `orderType = DELIVERY`.
- Hay dirección/referencia.
- Cambia dirección, barrio o subtotal.

También existe acción de usuario:

- `Recalcular domicilio`.

## 7. Debounce / anti-spam

Implementado:

- Debounce de 950 ms.
- `requestKey` por subtotal + dirección + barrio + referencia.
- No duplica llamada si el input no cambió.
- Ignora respuestas obsoletas si llega una estimación vieja.

## 8. Data-testid

Nuevos/preservados:

- `pos-delivery-panel`
- `pos-delivery-mode`
- `pos-delivery-address`
- `pos-delivery-reference`
- `pos-delivery-neighborhood`
- `pos-delivery-status`
- `pos-delivery-calculating`
- `pos-delivery-final-fee`
- `pos-delivery-message`
- `pos-delivery-breakdown`
- `pos-delivery-recalculate`
- `pos-delivery-can-checkout`
- `pos-checkout-button`
- `pos-delivery-save`

Manual legacy eliminado del DOM operativo:

- `pos-delivery-manual-fee-input`
- `pos-delivery-manual-reason`
- `delivery-manual-quote-panel`

## 9. E2E POS display

Archivo creado:

`tests/e2e/phase-delivery-auto-2-pos-display.spec.ts`

Casos cubiertos:

- Local free automático.
- Dirección ambigua.
- Provider unavailable con providers deshabilitados.
- Ausencia de input/motivo manual.
- Anti-spam debounce.
- Recalcular.
- Mobile 390x844 sin overflow crítico.

Resultado:

- PASS: 2/2 incluyendo setup.

Evidencia: `/tmp/phase-delivery-auto-2/e2e-pos-display.log`.

## 10. Regression SYS-1

Ejecutado:

`tests/e2e/sys1-auth-refresh-concurrency.spec.ts`

Resultado:

- PASS: 4/4.

Evidencia: `/tmp/phase-delivery-auto-2/e2e-sys1-auth.log`.

## 11. Web typecheck/build

Resultados:

- `pnpm --filter @inventory-fastfood/web typecheck`: PASS.
- `pnpm --filter @inventory-fastfood/web build`: PASS.

Build generó warnings preexistentes de `no-explicit-any`, no bloqueantes.

Evidencia:

- `/tmp/phase-delivery-auto-2/web-typecheck.log`
- `/tmp/phase-delivery-auto-2/web-build.log`

## 12. Health

`curl -fsS http://localhost/api/health`: PASS.

Evidencia: `/tmp/phase-delivery-auto-2/health.log`.

## 13. Bundle localhost

`grep -R "localhost:4300" apps/web/.next`: 0 ocurrencias.

Evidencia: `/tmp/phase-delivery-auto-2/bundle-localhost4300.log`.

## 14. Screenshots

| Screenshot | Existe | Tamaño | Qué demuestra |
|---|---:|---:|---|
| `01-pending-address.png` | Sí | 117208 bytes | Estado pendiente |
| `02-calculating.png` | Sí | 127149 bytes | Estado calculando |
| `03-local-free.png` | Sí | 122543 bytes | Local free automático |
| `04-auto-priced-or-provider-disabled.png` | Sí | 124304 bytes | Provider disabled sin fee inventado |
| `05-address-correction-required.png` | Sí | 124679 bytes | Dirección ambigua bloqueada |
| `06-provider-unavailable.png` | Sí | 124304 bytes | Provider unavailable |
| `07-checkout-blocked.png` | Sí | 124679 bytes | Checkout/guardar bloqueado |
| `08-checkout-allowed-local-free.png` | Sí | 122543 bytes | Checkout/guardar habilitado |
| `09-no-manual-fee-ui.png` | Sí | 122543 bytes | Sin input manual fee |
| `10-mobile-390x844.png` | Sí | 451784 bytes | Mobile sin overflow crítico |

Directorio:

`infra/environments/staging/selfhosted-data/deployment-prep/screenshots/phase-delivery-auto-2/`

## 15. Nota de validación local

`docker compose build web` no pudo reconstruir por buildx local antiguo (`buildx 0.17+` requerido). Para validar en `http://localhost` sin cambiar nginx ni producción, se copiaron artefactos locales ya construidos:

- `apps/web/.next` al contenedor `web`.
- `apps/api/dist` al contenedor `api` para alinear con PHASE-1.

No se cambió nginx ni `.env`.

## 16. Riesgos residuales

- Los E2E históricos `audit8g0` y `audit8g2` siguen documentando el flujo manual anterior y deben retirarse o reescribirse en una limpieza posterior. No se usaron como gate de esta fase porque contradicen el modelo automático definitivo.
- Con providers deshabilitados por `.env`, direcciones no locales quedan bloqueadas como `PROVIDER_UNAVAILABLE`, lo cual es correcto para no inventar tarifa.

## 17. Qué queda para PHASE-DELIVERY-AUTO-3

- Reemplazar o archivar E2E históricos manual-first.
- Refinar UI final para providers habilitados con `AUTO_PRICED` real externo.
- Ajustar documentación operacional del cajero: corregir dirección, recalcular, no ingresar tarifa.
- Resolver buildx local para reconstrucción Docker normal.

## 18. Decisión final

**PHASE-DELIVERY-AUTO-2 POS DISPLAY ONLY: GO**

Motivo:

- POS no permite fee manual operativo.
- POS no permite motivo manual operativo.
- POS no calcula tarifa.
- Backend es fuente única.
- Local free automático PASS.
- Dirección ambigua bloquea checkout PASS.
- Provider unavailable no inventa fee PASS.
- Anti-spam PASS.
- Recalcular PASS.
- Web typecheck/build PASS.
- E2E nuevo PASS.
- SYS-1 regression PASS.
- Health PASS.
- Bundle limpio.
- Screenshots 10/10.
