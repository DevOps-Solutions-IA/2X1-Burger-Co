# HOTFIX-DELIVERY-AUTO-UI-STALE-COPY-0

## 1. Resumen ejecutivo

Se eliminó copy stale/manual-first visible en la configuración de domicilios y se ajustó un mensaje técnico del POS para alinearlo con el modelo actual: backend calcula automáticamente, POS captura y muestra resultado, checkout exige snapshot válido y Caja refleja `deliveryFee` backend.

Decisión: **GO**.

## 2. Problema detectado

Settings todavía indicaba que el motor estaba en preparación y que las tarifas debían confirmarse o ingresarse manualmente. Ese copy contradecía PHASE-DELIVERY-AUTO-1/2/3.

## 3. Archivos con copy viejo

| Archivo | Copy viejo | Acción |
| --- | --- | --- |
| `apps/web/src/app/(app)/settings/page.tsx` | “Motor de domicilios en preparación...” | Reemplazado por copy de cálculo automático |
| `apps/web/src/app/(app)/settings/page.tsx` | “Tarifas automáticas desactivadas temporalmente.” | Reemplazado por “Cálculo automático activo.” |
| `apps/web/src/app/(app)/settings/page.tsx` | “El valor final de domicilio se ingresa manualmente en POS...” | Reemplazado por flujo backend/POS display-only |

## 4. Copy eliminado

- “Motor de domicilios en preparación.”
- “Por ahora, las tarifas deben confirmarse manualmente antes de guardar.”
- “Tarifas automáticas desactivadas temporalmente.”
- “No hay fórmula por kilómetro, bandas por alias ni fallback automático activo.”
- “El valor final de domicilio se ingresa manualmente en POS...”

## 5. Copy nuevo

- “El backend calcula la tarifa de domicilio con dirección, zona, ruta, reglas del negocio y proveedores configurados.”
- “Cálculo automático activo.”
- “El POS solo captura dirección, barrio y referencia. La tarifa final la calcula el backend y se conserva en comanda, venta, caja y comprobante.”
- “Si la dirección es insuficiente, ambigua, fuera de cobertura o el proveedor no está disponible, el sistema bloquea el checkout y solicita corregir la dirección. No se ingresa tarifa en POS.”
- POS: “Checkout bloqueado hasta obtener estimación válida.”

## 6. Confirmación Settings corregido

Archivo: `apps/web/src/app/(app)/settings/page.tsx`.

Settings ahora muestra:

- Badge “Automático”.
- Card “Cálculo automático activo.”
- Descripción de backend como fuente de cálculo.
- Sin referencias a tarifa manual ni automáticas desactivadas.

## 7. Confirmación POS corregido

Archivo: `apps/web/src/app/(app)/pos/page.tsx`.

Se reemplazó “Bloqueado por backend” por “Checkout bloqueado hasta obtener estimación válida”. No se cambió lógica.

## 8. Grep inicial

Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/stale-copy-map.log`.

Resultado: 3 ocurrencias, todas en Settings.

## 9. Grep final

Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/stale-copy-final.log`.

Resultado: 0 ocurrencias en `apps/web/src`.

## 10. Web typecheck/build

- Web typecheck: PASS.
- Web build: PASS.
- Warnings residuales `no-explicit-any`: preexistentes, no relacionados con este hotfix.
- Evidencia:
  - `/tmp/hotfix-delivery-auto-ui-stale-copy-0/web-typecheck.log`
  - `/tmp/hotfix-delivery-auto-ui-stale-copy-0/web-build.log`

## 11. E2E POS display

- `tests/e2e/phase-delivery-auto-2-pos-display.spec.ts`: PASS.
- Se actualizó la aserción de copy al nuevo mensaje “Checkout bloqueado”.
- Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/e2e-pos-display.log`.

## 12. E2E checkout/cash

- `tests/e2e/phase-delivery-auto-3-checkout-cash-audit.spec.ts`: PASS.
- Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/e2e-checkout-cash.log`.

## 13. Health

- `curl http://localhost/api/health`: PASS.
- Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/health.log`.

## 14. Screenshots

Directorio: `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/hotfix-delivery-auto-ui-stale-copy-0/`.

| Screenshot | Existe | Tamaño | Qué demuestra |
| --- | --- | ---: | --- |
| `01-settings-delivery-automatic-config.png` | Sí | 115549 | Settings con configuración automática |
| `02-pos-delivery-pending-clean-copy.png` | Sí | 135707 | POS pendiente sin copy manual-first |
| `03-pos-delivery-local-free-clean-copy.png` | Sí | 121981 | POS local free con copy limpio |
| `04-pos-delivery-address-correction-clean-copy.png` | Sí | 130429 | POS corrección de dirección sin manual-first |
| `05-final-grep-summary.png` | Sí | 115589 | Estado final visual de Settings |

Evidencia: `/tmp/hotfix-delivery-auto-ui-stale-copy-0/screenshots-list.log`.

## 15. Riesgos residuales

- Persisten warnings frontend `no-explicit-any` existentes.
- No se tocó backend pricing, auth, Caja core, Prisma, migraciones ni `.env`.

## 16. Decisión final

**HOTFIX-DELIVERY-AUTO-UI-STALE-COPY-0: GO**
