# UI-CONSISTENCY-CASH-INVOICE-0 — Platform Visual Alignment + Stock Home + POS Order Scroll + Cash Premium + Invoice Audit

## 1. Resumen ejecutivo
Se alinearon Inicio, Usuarios, Punto de venta y Caja con la identidad visual premium ya presente en Inventario/Admin. No se tocó delivery pricing, Google Maps, Open-Meteo, checkout core, caja core contable, auth, Prisma ni migraciones. La factura/recibo POS fue auditada; existe recibo térmico/PDF y WhatsApp con datos configurados, pero no se inventaron NIT, resolución fiscal ni campos legales ausentes.

Decisión: GO CONDICIONADO por factura/recibo fiscal: la UI y regresión pasan, pero el cierre legal/fiscal requiere datos de negocio configurados y aprobación fiscal antes de declararlo factura completa.

## 2. Estado recibido
- DELIVERY-GOOGLE-MAPS-CORE-0: GO.
- DELIVERY-WEATHER-RAIN-SURCHARGE-GOOGLE-0: GO.
- Google Maps principal para rutas.
- Open-Meteo activo para lluvia.
- Prioridad de esta fase: consistencia visual, Inicio, POS, Caja y auditoría de factura POS.

## 3. Páginas revisadas
- Inicio / Dashboard.
- Inventario como referencia visual.
- Usuarios / crear usuario / roles.
- Punto de venta / pedidos abiertos / tarjetas de pedido.
- Caja / caja operativa / día hasta ahora / arqueo / ventas de jornada.
- Recibo térmico POS.

## 4. Textos alineados por rol
Los roles visibles en Usuarios ahora se presentan en español sin cambiar valores internos:
- admin -> Administrador.
- cashier -> Cajero.
- manager -> Supervisor.
- inventory -> Inventario.
- waiter -> Mesero.
- delivery -> Domiciliario.

## 5. Textos en inglés corregidos
- Select de rol principal usa labels en español.
- Badges de roles usan labels en español.
- Búsqueda contempla valor interno y label visible en español.
- Permisos visibles se formatean como labels legibles, no como códigos crudos.

## 6. Inicio — Atención requerida
Antes: usaba resumen más genérico y no mostraba stock actual, mínimo, categoría y cobertura con la misma jerarquía de Inventario.

Ahora: consume `/inventory/reorder-suggestions`, la misma fuente operativa usada por Inventario para alertas de reposición, y muestra stock actual, mínimo, categoría, cobertura, sugerido y badge de severidad.

## 7. Inicio — Última actividad
Se mejoraron tarjetas de movimientos con borde, sombra, truncado y jerarquía de evento, cantidad y fecha. Sigue usando datos reales de `/inventory/movements`.

## 8. Inicio — Lo más vendido
Se mejoraron tarjetas de best sellers con borde premium, acento de marca, truncado y monto destacado. Sigue usando datos reales de `/reports/operational`.

## 9. POS — comandas con scroll
Pedidos abiertos ahora tienen contenedor con scroll vertical interno (`overflow-y-auto`) y altura máxima. La página no crece indefinidamente si existen muchas comandas. No se ocultan comandas: quedan disponibles dentro del scroll.

## 10. POS — tarjetas sin desbordamiento
Las tarjetas de pedido ahora tienen estructura `min-w-0`, truncado controlado, badges `shrink-0`, total tabular y fecha truncada. Se preservaron `data-testid` críticos.

## 11. Caja — caja operativa
Caja operativa ahora muestra:
- Caja esperada con jerarquía dominante.
- Dinero inicial secundario.
- Apertura registrada como estado destacado.
- Estado activo en badge.

No se alteraron cálculos contables.

## 12. Caja — día hasta ahora
Ventas, compras, gastos y utilidad neta ahora se muestran como mini-cards premium. Utilidad neta queda destacada sin cambiar la fórmula.

## 13. Caja — métodos de pago dinámicos
Se agregó ranking visual dinámico:
- Mayor valor vendido: verde/success.
- Segundo: acento de marca.
- Tercero: secundario azul.
- Cero: neutro/muted.

No se hardcodea efectivo como verde.

## 14. Caja — arqueo
La grilla de denominaciones ahora usa fondo premium, inputs con foco visual y monto contado destacado. Estados de diferencia se mantienen con lógica existente.

## 15. Ventas de la jornada
Se ajustó la jerarquía visual de ventas: número, canal, referencia/cliente, hora, productos, domicilio si aplica, total dominante y acciones separadas. No se modificaron ventas ni endpoints.

## 16. Factura/recibo POS
Existe:
- `apps/web/src/lib/thermal-receipt.ts` con recibo térmico 58 mm.
- Factura/recibo PDF desde `/sales/:id/receipt-pdf`.
- WhatsApp receipt desde caja y POS.
- Datos disponibles: negocio, dirección, teléfono, venta, fecha, canal, referencia, cliente, notas, productos, pagos, subtotal, descuento y total.

Mejorado en esta fase:
- Auditoría documental y screenshot de sección disponible.
- No se inventaron datos fiscales.

Falta para GO fiscal completo:
- NIT si aplica.
- Resolución fiscal si aplica.
- Numeración fiscal formal si aplica.
- Campos legales desde configuración validada por negocio/contador.

Estado factura: NEEDS BUSINESS DATA para declararla factura fiscal completa. Recibo operativo POS sigue funcional.

## 17. Componentes reutilizados o creados
- Reutilizados: Card, Badge, EmptyState, MetricCard, StatusBanner, Field/Input/Select.
- Nuevos helpers: `formatRoleLabel`, `formatPermissionLabel`, `translateStockStatus`, `getPaymentMethodClass`, `translatePaymentMethod`.
- Nuevo E2E visual: `tests/e2e/ui-consistency-cash-invoice-0.spec.ts`.

## 18. API/Web tests
- API typecheck: PASS.
- API build: PASS.
- API test: PASS, 12 suites / 204 tests.
- Web typecheck: PASS.
- Web build: PASS.
- Docker build api/web: PASS.

## 19. E2E
- UI consistency visual evidence: PASS.
- phase-delivery-auto-2-pos-display: PASS.
- phase-delivery-auto-3-checkout-cash-audit: PASS.
- delivery-google-maps-core-0: PASS.
- delivery-weather-rain-surcharge-google-0: first chained attempt failed in `auth.setup` timeout; isolated rerun PASS.
- sys1-auth-refresh-concurrency: first chained attempt failed in `auth.setup` timeout; isolated rerun PASS.

## 20. Screenshots
Todas generadas en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/ui-consistency-cash-invoice-0/`:

| Screenshot | Existe | Tamaño | Qué demuestra |
| --- | --- | ---: | --- |
| 01-admin-reference-visual.png | Sí | 135142 bytes | Referencia visual Inventario/Admin |
| 02-home-atencion-requerida-stock-critical.png | Sí | 144668 bytes | Inicio con atención requerida real |
| 03-home-ultima-actividad-premium.png | Sí | 145451 bytes | Actividad premium |
| 04-home-lo-mas-vendido-premium.png | Sí | 148294 bytes | Best sellers premium |
| 05-create-user-roles-spanish.png | Sí | 145409 bytes | Roles visibles en español |
| 06-pos-open-orders-scroll-10.png | Sí | 156434 bytes | Contenedor de comandas con scroll |
| 07-pos-order-card-no-overflow.png | Sí | 157188 bytes | Tarjetas POS sin overflow crítico |
| 08-cash-caja-operativa-premium.png | Sí | 209021 bytes | Caja operativa premium |
| 09-cash-dia-hasta-ahora-premium.png | Sí | 209021 bytes | Métricas de jornada premium |
| 10-cash-payment-methods-dynamic-color.png | Sí | 209710 bytes | Métodos de pago dinámicos |
| 11-cash-arqueo-premium.png | Sí | 209710 bytes | Arqueo premium |
| 12-cash-ventas-jornada-premium.png | Sí | 209710 bytes | Ventas de jornada premium |
| 13-receipt-invoice-preview-if-available.png | Sí | 199198 bytes | Evidencia de sección factura/recibo disponible |
| 14-mobile-pos-cash-clean.png | Sí | 44980 bytes | Mobile POS/Caja sin overflow crítico |
| 15-final-summary.png | Sí | 127920 bytes | Resumen final visual |

## 21. Health
PASS: `curl -fsS http://localhost/api/health` respondió `status=ok`, database `ok`.

## 22. Bundle
PASS: `grep -R "localhost:4300" apps/web/.next` devolvió 0 ocurrencias.

## 23. Docker build
PASS: `docker compose build api web` completó y construyó `inventario-api` e `inventario-web`.

## 24. Bugs residuales
- P3: warnings `no-explicit-any` existentes en varios módulos, incluyendo Dashboard/Cash por uso histórico de respuestas no tipadas.
- P2 fiscal/negocio: factura fiscal completa requiere datos legales/configuración aprobada; recibo operativo POS existe.
- P3: el grep de inglés encuentra tokens técnicos en código (`role`, `user`, query keys), no evidencia de labels finales visibles en inglés para roles del formulario.
- Observación: el directorio actual no tiene metadata Git (`fatal: not a git repository`), por eso no se pudo listar diff desde Git.

## 25. Recomendación
Para DeepSeek:
- Deuda puramente visual fina en spacing/animación si negocio quiere pulido adicional de Caja/Inicio.

Para Codex:
- Factura fiscal completa si negocio entrega NIT/resolución/configuración legal.
- Tipado progresivo de responses Dashboard/Cash para reducir P3 `no-explicit-any` sin refactor masivo.

## 26. Decisión final
UI-CONSISTENCY-CASH-INVOICE-0: GO CONDICIONADO

Condición: el recibo POS operativo está conservado y auditado, pero factura fiscal completa queda condicionada a datos legales/configuración de negocio. No se inventaron campos fiscales.
