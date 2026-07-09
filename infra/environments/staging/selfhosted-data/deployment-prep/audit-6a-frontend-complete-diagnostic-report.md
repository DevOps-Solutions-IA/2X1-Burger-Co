# AUDIT-6A: FRONTEND ENTERPRISE UX/UI COMPLETE DIAGNOSTIC

**Date:** 2026-05-16
**Mode:** READ-ONLY diagnostic
**Environment:** Local Docker (WSL2), accessed via http://localhost

---

## DECISIÓN

### FRONTEND DESIGN READINESS: GO CONDICIONADO

El sistema es FUNCIONAL y OPERATIVO. Los flujos críticos (POS, caja, inventario, login, reportes, RBAC) funcionan correctamente. Sin embargo, existen **14 hallazgos P1** y **28 hallazgos P2** que deben remediarse antes de alcanzar calidad enterprise completa. El diseño base es sólido (8.5/10 promedio) pero la consistencia interna y la accesibilidad necesitan refuerzo.

---

## 1. INVENTARIO DE RUTAS (22 total)

| # | Ruta | Archivo | Rol permitido | Objetivo | Estado visual | Estado funcional |
|---|------|---------|---------------|----------|---------------|-----------------|
| 1 | /login | login/page.tsx | Público | Auth universal | ✅ Limpio | ✅ Funcional |
| 2 | /dashboard | dashboard/page.tsx | Auth | Panel operativo | ✅ Profesional | ✅ Funcional |
| 3 | /pos | pos/page.tsx | Admin/Cashier | Punto de venta | ⚠️ Sobrecargado | ✅ Funcional |
| 4 | /tables | tables/page.tsx | Admin/Cashier/Sup. | Mesas | ✅ Claro | ✅ Funcional |
| 5 | /deliveries | deliveries/page.tsx | Admin/Delivery | Domicilios | ✅ Claro | ✅ Funcional |
| 6 | /cash | cash/page.tsx | Admin/Cashier/Sup. | Caja | ⚠️ Denso | ✅ Funcional |
| 7 | /inventory | inventory/page.tsx | Admin/Inventory | Inventario | ⚠️ Tablas overflow | ✅ Funcional |
| 8 | /products | products/page.tsx | Admin/Inventory | Productos | ✅ Claro | ⚠️ Sin validación |
| 9 | /purchases | purchases/page.tsx | Admin/Inventory | Compras | ✅ Claro | ✅ Funcional |
| 10 | /expenses | expenses/page.tsx | Admin/Cashier/Sup. | Gastos | ✅ Claro | ✅ Funcional |
| 11 | /reports | reports/page.tsx | Admin/Cashier/Sup. | Reportes | ✅ Claro | ✅ Funcional |
| 12 | /users | users/page.tsx | Admin | Usuarios | ⚠️ Denso | ⚠️ Sin validación |
| 13 | /categories | categories/page.tsx | Admin/Inventory | Categorías | ✅ Claro | ✅ Funcional |
| 14 | /ingredients | ingredients/page.tsx | Admin/Inventory | Insumos | ✅ Claro | ✅ Funcional |
| 15 | /suppliers | suppliers/page.tsx | Admin/Inventory | Proveedores | ✅ Claro | ⚠️ Sin eliminar |
| 16 | /recipes | recipes/page.tsx | Admin/Inventory | Recetas | ⚠️ Básico | ⚠️ Sin validación |
| 17 | /settings | settings/page.tsx | Admin | Configuración | ✅ Claro | ✅ Funcional |
| 18 | /waiter/login | waiter/login/page.tsx | Público | Login mesero | ✅ Claro | ✅ Funcional |
| 19 | /waiter | waiter/page.client.tsx | Waiter | Panel mesero | ⚠️ Muy grande | ✅ Funcional |
| 20 | /delivery/login | delivery/login/page.tsx | Público | Login domiciliario | ✅ Claro | ✅ Funcional |
| 21 | /delivery | delivery/page.tsx | Delivery | Panel rider | ✅ Claro | ✅ Funcional |
| 22 | / | page.tsx | Público | Redirect | ✅ | ✅ Funcional |

---

## 2. HALLAZGOS POR SEVERIDAD

### P0 — Bloquea operación: 0

No se encontraron bloqueos de operación. Login, POS, caja, inventario y reportes funcionan.

### P1 — Daña operación o comprensión: 14

| ID | Componente/Archivo | Descripción | Impacto |
|----|-------------------|-------------|---------|
| P1-01 | confirm-dialog.tsx:81 | Botones usan `<button>` nativo en vez de componente `Button` | Inconsistencia visual en diálogos |
| P1-02 | confirm-dialog.tsx:49 | `<dialog>` sin `aria-labelledby` | Title no anunciado por screen readers |
| P1-03 | confirm-dialog.tsx:49 | `<dialog>` sin `aria-describedby` | Mensaje no asociado al diálogo |
| P1-04 | empty-state.tsx:29 | `title` renderizado como `<p>`, debe ser heading | Jerarquía de headings rota |
| P1-05 | skeleton.tsx:8 | `animate-pulse` no respeta `prefers-reduced-motion` | Violación WCAG 2.3.3 |
| P1-06 | app-shell.tsx:278 | Sin focus management post-navegación | Usuarios de teclado pierden contexto |
| P1-07 | app-shell.tsx:147 | `<aside>` sin `role="navigation"` ni `aria-label` | Sidebar no identificable por screen readers |
| P1-08 | pos/page.tsx:1972 | Botón "Cancelar comanda" sin ConfirmDialog (corregido parcialmente) | Acción destructiva sin confirmación |
| P1-09 | waiter-layout.client.tsx:197 | Backdrop sin `aria-hidden="true"` en menú móvil | Screen readers ven contenido duplicado |
| P1-10 | button.tsx:7 | `active:scale-[0.99]` sin `motion-safe:` | Violación WCAG 2.3.3 (animación) |
| P1-11 | inventory/page.tsx:336 | Tabla de stock con `grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_0.6fr]` sin responsive | Tabla inutilizable en mobile |
| P1-12 | inventory/page.tsx:346 | Mismo patrón en filas de datos | Overflow horizontal forzado |
| P1-13 | products/page.tsx:448 | Sin validación client-side de campos requeridos | Errores solo visibles tras submit |
| P1-14 | recipes/page.tsx:167 | Sin validación de líneas de receta | Recetas pueden guardarse incompletas |

### P2 — Baja percepción profesional: 28

| ID | Componente/Archivo | Descripción | Recomendación |
|----|-------------------|-------------|---------------|
| P2-01 | button.tsx | `rounded-xl` vs Input/Select `rounded-2xl` | Unificar radio de borde |
| P2-02 | badge.tsx:7 | StatusBanner usa tone 'info'/'warning'/'success'/'danger', Badge usa 'default'/'danger'/'success'/'warning'/'info'/'neutral' | Unificar sistemas de tone |
| P2-03 | error-boundary.tsx:54 | Botones no usan componente `Button` | Usar Button component |
| P2-04 | error-boundary.tsx:41 | Contenedor sin `role="alert"` | Agregar role="alert" |
| P2-05 | skeleton.tsx:8 | Sin `aria-hidden="true"` | Ocultar de screen readers |
| P2-06 | skeleton.tsx:3-7 | Sin `role="status"` o `aria-label` | Anunciar carga a screen readers |
| P2-07 | field.tsx:21 | `cloneElement` frágil si children no es ReactElement | Usar Context o forwardRef |
| P2-08 | field.tsx:21 | `cloneElement` fuerza re-render del hijo | Memoizar children o usar patrón alternativo |
| P2-09 | metric-card.tsx:51 | `accent === 'brand'` duplicado (líneas 51 y 56) | Eliminar código duplicado |
| P2-10 | section-title.tsx:19 | `eyebrow` como `<p>` antes de `<h1>` sin asociación | Usar `<span>` dentro del `<h1>` |
| P2-11 | status-banner.tsx:7 | Tone system incompatible con Badge | Unificar |
| P2-12 | status-banner.tsx:38 | Iconos sin `aria-hidden="true"` | Agregar aria-hidden |
| P2-13 | select.tsx:21 | `<ChevronDown>` sin `aria-hidden="true"` | Agregar aria-hidden |
| P2-14 | app-shell.tsx:172 | Títulos de secciones nav como `<p>`, deben ser headings | Usar `<h2>` o `<h3>` |
| P2-15 | tailwind.config.ts | Sin tokens: z-index, font-size scale, animation, reduced-motion | Agregar tokens de diseño |
| P2-16 | app/layout.tsx:30 | Pantalla "cargando sesión" no usa Skeleton | Usar Skeleton component |
| P2-17 | (app)/layout.tsx:41 | Pantalla "Acceso restringido" duplicada con waiter/rider layouts | Extraer a componente |
| P2-18 | dashboard/page.tsx:25 | `useQuery<any>` — uso de `any` en tipos de respuesta | Tipar respuestas |
| P2-19 | auth-provider.tsx:50 | `lastSessionToastAt` throttling ad-hoc | Extraer a hook |
| P2-20 | waiter/page.client.tsx | Archivo extremadamente grande (>2000 líneas) | Dividir en componentes |
| P2-21 | pos/page.tsx:2267 | Archivo extremadamente grande | Dividir en componentes |
| P2-22 | users/page.tsx:423 | Sin validación requerida en nombre y email | Agregar validación requerida |
| P2-23 | recipes/page.tsx:189 | Resumen sin Skeleton durante carga | Agregar Skeleton |
| P2-24 | reports/page.tsx:402 | Skeleton usado como placeholder de "sin datos" | Usar EmptyState |
| P2-25 | suppliers/page.tsx | Sin botón de eliminación | Agregar con ConfirmDialog |
| P2-26 | deliveries/page.tsx:417 | Toasts duplicados al rehidratar cache | Comparar timestamps |
| P2-27 | globals.css:56 | `body { overflow: hidden }` en `lg:` puede romper scroll | Verificar en páginas largas |
| P2-28 | globals.css:82 | `* { @apply border-stone-200 }` agresivo | Usar utility en lugar de wildcard |

### P3 — Pulido visual: 7

| ID | Componente | Descripción |
|----|-----------|-------------|
| P3-01 | button.tsx | No especifica `type="button"` por defecto |
| P3-02 | card.tsx:11 | `rounded-[1.45rem]` valor arbitrario, debería ser token |
| P3-03 | metric-card.tsx:30 | `value` usa `<p>` en vez de heading |
| P3-04 | error-boundary.tsx:63 | Error capturado nunca expuesto en desarrollo |
| P3-05 | app-shell.tsx:288 | `QuickLink` como componente interno, debería ser reutilizable |
| P3-06 | badbe.tsx:4 | Tone 'default' sin borde explícito |
| P3-07 | provider.tsx:35 | `Toaster` fuera de `ErrorBoundary` |

---

## 3. HALLAZGOS POR PANTALLA

| Pantalla | P0 | P1 | P2 | P3 | Score | Principal problema |
|----------|----|----|----|----|-------|--------------------|
| Login | 0 | 0 | 0 | 0 | 9.8/10 | Ninguno |
| Dashboard | 0 | 0 | 2 | 0 | 9.0/10 | any types, skeleton falta |
| POS | 0 | 1 | 1 | 0 | 8.2/10 | Archivo enorme, ConfirmDialog parcial |
| Cash | 0 | 0 | 0 | 0 | 9.2/10 | Ninguno |
| Inventory | 0 | 2 | 0 | 0 | 8.0/10 | Tablas sin responsive |
| Products | 0 | 1 | 0 | 0 | 8.8/10 | Sin validación client-side |
| Purchases | 0 | 0 | 0 | 0 | 9.2/10 | Ninguno |
| Expenses | 0 | 0 | 0 | 0 | 9.0/10 | Ninguno |
| Reports | 0 | 0 | 1 | 0 | 9.0/10 | Skeleton como empty |
| Users | 0 | 0 | 1 | 0 | 8.8/10 | Sin validación requerida |
| Recipes | 0 | 1 | 1 | 0 | 8.0/10 | Sin validación, sin skeleton |
| Suppliers | 0 | 0 | 1 | 0 | 8.8/10 | Sin botón eliminar |
| Deliveries | 0 | 0 | 1 | 0 | 8.4/10 | Toasts duplicados |
| Waiter | 0 | 0 | 1 | 0 | 8.0/10 | Archivo enorme |
| Tables | 0 | 0 | 0 | 0 | 9.0/10 | Ninguno |
| Settings | 0 | 0 | 0 | 0 | 9.0/10 | Ninguno |

---

## 4. HALLAZGOS DE ACCESIBILIDAD

| ID | Descripción | WCAG |
|----|-------------|------|
| A11Y-01 | `active:scale-[0.99]` sin `motion-safe:` | 2.3.3 |
| A11Y-02 | Skeleton `animate-pulse` sin `prefers-reduced-motion` | 2.3.3 |
| A11Y-03 | ConfirmDialog sin `aria-labelledby`/`aria-describedby` | 4.1.2 |
| A11Y-04 | EmptyState title como `<p>` en vez de heading | 1.3.1 |
| A11Y-05 | Sidebar sin `role="navigation"` | 1.3.1 |
| A11Y-06 | Nav section titles como `<p>` en vez de headings | 1.3.1 |
| A11Y-07 | Sin focus management post-navegación | 2.4.3 |
| A11Y-08 | Icons decorativos sin `aria-hidden` | 1.1.1 |
| A11Y-09 | ErrorBoundary sin `role="alert"` | 4.1.3 |
| A11Y-10 | Skeleton sin `aria-hidden` | 1.1.1 |

---

## 5. HALLAZGOS DE RESPONSIVE

| ID | Pantalla | Breakpoint | Descripción |
|----|----------|-----------|-------------|
| R-01 | Inventory | <768px | Tabla de stock sin columnas adaptativas |
| R-02 | Inventory | <760px | Kardex con min-w-[760px] overflow |
| R-03 | POS | <1280px | Panel lateral no sticky en tablet |
| R-04 | AppShell | <1024px | Sidebar ocupa toda la pantalla en mobile (parcialmente mitigado con hamburger) |
| R-05 | POS | <640px | Botones de cantidad con touch target <44px |

---

## 6. HALLAZGOS DE PERFORMANCE

| ID | Archivo | Descripción | Impacto |
|----|---------|-------------|---------|
| PERF-01 | pos/page.tsx | 2,267 líneas en un solo archivo | Carga y mantenibilidad |
| PERF-02 | waiter/page.client.tsx | Archivo extremadamente grande | Carga y mantenibilidad |
| PERF-03 | inventory/page.tsx | Tabla sin virtualización, renderiza todas las filas | Performance con catálogos grandes |
| PERF-04 | field.tsx | `cloneElement` en cada render | Re-renders innecesarios |
| PERF-05 | dashboard/page.tsx | 4 queries paralelas, algunas podrían agruparse | Latencia inicial |

---

## 7. SCREENSHOTS GENERADOS

41 screenshots en `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-6a-frontend-diagnostic/`

- **Desktop** (20): Todas las páginas a 1440x900 + login a 1920x1080, 1440x900, 1366x768
- **Tablet** (11): Páginas clave a 1024x768 + POS portrait 768x1024
- **Mobile** (10): Páginas clave a 390x844 + login a 430x932, 390x844, 360x740

---

## 8. TOP 10 PROBLEMAS MÁS IMPORTANTES

1. **POS y Waiter son archivos monolíticos** (>2000 líneas) — dificultan mantenimiento y testing
2. **Tablas de inventario sin responsive** — inutilizables en tablet/mobile
3. **Inconsistencia de design system** — Badge vs StatusBanner tones, radios de borde, botones en diálogos
4. **Accesibilidad de diálogos** — sin aria-labelledby, botones nativos duplicados
5. **Sin focus management** — usuarios de teclado pierden contexto al navegar
6. **Animation sin reduced-motion** — violación WCAG 2.3.3 en Button y Skeleton
7. **Validación client-side ausente** — Products, Users, Recipes
8. **Jerarquía de headings** — EmptyState y nav sections usan `<p>` en vez de headings
9. **cloneElement frágil** en Field — falla silenciosamente si children no es ReactElement
10. **Tailwind config incompleta** — faltan tokens de z-index, font-size, reduced-motion

## 9. PLAN DE REMEDIACIÓN SUGERIDO

### Fase 1 (P1 — 2-3 días)
- Unificar tones en Badge/StatusBanner
- aria-labelledby/describedby en ConfirmDialog
- Reemplazar botones nativos por Button en ConfirmDialog y ErrorBoundary
- motion-safe en Button y Skeleton
- aria-hidden en iconos decorativos
- aria-label/role en sidebar

### Fase 2 (P2 — 3-5 días)
- Tablas de inventario responsive
- Validación client-side en Products, Users, Recipes
- Tokens de diseño en tailwind.config.ts
- Extraer pantalla "Acceso restringido" y "Cargando sesión"
- Tipar respuestas de queries
- Agregar Skeleton donde falta
- Separar QuickLink a componente reutilizable

### Fase 3 (P3 — 2-3 días)
- Refactorizar POS en componentes (CartView, PaymentSection, WhatsAppModal)
- Refactorizar Waiter en componentes
- Unificar radios de borde
- Eliminar `accent === 'brand'` duplicado en MetricCard
- Exponer error en ErrorBoundary modo dev

---

## 10. ESTIMACIÓN DE RIESGO SI SE DESPLIEGA SIN CORREGIR

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Usuarios de teclado no pueden navegar eficientemente | Alta | Medio | Fase 1 accesibilidad |
| Inventario inutilizable en tablet | Alta | Alto | Fase 2 responsive |
| Screen readers no entienden diálogos | Media | Medio | Fase 1 aria |
| Mantenimiento de POS/Waiter costoso | Media | Bajo | Fase 3 refactor |
| Errores de formulario no visibles hasta submit | Media | Bajo | Fase 2 validación |

---

## 11. ARCHIVOS QUE PROBABLEMENTE SE MODIFICARÁN EN AUDIT-6B

- `apps/web/src/components/confirm-dialog.tsx` (aria, Button)
- `apps/web/src/components/error-boundary.tsx` (Button, role)
- `apps/web/src/components/ui/button.tsx` (motion-safe, type)
- `apps/web/src/components/ui/badge.tsx` (unificar tones)
- `apps/web/src/components/ui/status-banner.tsx` (unificar tones, aria)
- `apps/web/src/components/ui/empty-state.tsx` (headings)
- `apps/web/src/components/ui/skeleton.tsx` (aria, reduced-motion)
- `apps/web/src/components/ui/field.tsx` (cloneElement)
- `apps/web/src/components/ui/metric-card.tsx` (código duplicado)
- `apps/web/src/components/app-shell.tsx` (role, headings, focus)
- `apps/web/src/app/layout.tsx` (skip-link focus)
- `apps/web/src/app/(app)/layout.tsx` (extraer componentes)
- `apps/web/src/app/(app)/inventory/page.tsx` (responsive)
- `apps/web/src/app/(app)/pos/page.tsx` (ConfirmDialog, validación)
- `apps/web/src/app/(app)/products/page.tsx` (validación)
- `apps/web/src/app/(app)/users/page.tsx` (validación)
- `apps/web/src/app/(app)/recipes/page.tsx` (validación, skeleton)
- `apps/web/tailwind.config.ts` (tokens)
- `apps/web/src/app/globals.css` (overflow, wildcard border)
