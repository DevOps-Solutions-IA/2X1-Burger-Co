# UIUX-DELIVERY-CARD-1 — Compact Premium Delivery Card Report

## 1. Resumen ejecutivo

Rediseño de la tarjeta de estimación de domicilio en POS. Eliminados todos los códigos internos visibles, reducido el tamaño de la card un 50%, métricas en grid compacto 4 columnas.

## 2. Archivos tocados

| Archivo | Cambio |
|---------|--------|
| `apps/web/src/app/(app)/pos/page.tsx` | deliveryVisualState + panel rendering |

## 3. Qué NO se tocó

Backend, Prisma, delivery engine, pricing, checkout, Caja, auth, cookies, Nginx, .env

## 4. Mapping visual

| Código interno | UI anterior | UI nueva |
|---------------|-------------|----------|
| PENDING | "PENDIENTE" | **"Pendiente"** |
| LOCAL_FREE | "GRATIS" | **"Gratis"** |
| AUTO_PRICED | "CALCULADA" | **"Calculada"** |
| OUT_OF_COVERAGE | "SIN COBERTURA" | **"Sin cobertura"** |
| NEEDS_ADDRESS_CORRECTION | "NEEDS_ADDRESS_CORRECTION" | **"Corregir"** |
| PROVIDER_UNAVAILABLE | "PROVIDER_UNAVAILABLE" | **"No disponible"** |
| default | deliveryStatus raw | **"Reintentar"** |

## 5. Diseño compacto

| Antes | Después |
|-------|---------|
| Card con p-5, título grande, descripción larga | p-4, badge + mensaje en 1 línea |
| Grid 2x3 con 6 cards grandes | **Grid 4 columnas compacto** |
| "Explicación" expandida con breakdown | **Eliminado** (info redundante) |
| Checkout: texto largo | **"OK" / "Bloqueado"** |
| Botón "Recalcular" grande | **Botón compacto** |

## 6. Nuevos data-testid

- pos-delivery-distance
- pos-delivery-eta
- pos-delivery-coverage
- pos-delivery-message

## 7. Validación

| Prueba | Resultado |
|--------|-----------|
| Web typecheck | 0 errors |
| Web build | PASS |
| Docker | Built + healthy |
| Códigos internos en UI | 0 |
| Backend tocado | NO |

## 8. Screenshots (10/10)

Generados en `screenshots/ref-delivery-ui-0/`

## 9. Decisión

### UIUX-DELIVERY-CARD-1: GO
