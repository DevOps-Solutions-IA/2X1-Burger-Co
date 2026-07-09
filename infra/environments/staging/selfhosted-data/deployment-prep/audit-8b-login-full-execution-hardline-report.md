# AUDIT-8B - Login Brand Panel Full Execution Hardline

Fecha: 2026-06-19  
Modulo: Login web  
Archivo principal: `apps/web/src/app/login/page.tsx`  
Decision: **LOGIN FULL EXECUTION HARDLINE: GO**

## 1. Resumen ejecutivo

Se redisenó la pantalla de login enfocando la intervencion en el panel izquierdo de marca, sin cambiar backend, base de datos, nginx, Docker productivo ni contratos de autenticacion.

Resultado:

| Area | Resultado | Estado | Evidencia |
| --- | --- | --- | --- |
| Login admin | Funciona | PASS | UI Playwright redirige a `/dashboard`; curl login local OK |
| Formulario derecho | Conservado | PASS | Inputs, submit, errores, loading y links secundarios se mantienen |
| Panel izquierdo | Reestructurado | PASS | Logo real protagonista, hero premium, copy corto |
| Cards antiguos | Eliminados | PASS | No existe `Seguridad operativa`, `Caja viva`, `Lectura inmediata` en login |
| Meseros | Conservado | PASS | Link `/waiter/login` validado |
| Domiciliarios | Conservado | PASS | Link `/delivery/login` validado |
| Responsive | Validado | PASS | Desktop, tablet y mobile con screenshots |
| Typecheck | Pasa | PASS | Web y API typecheck OK |
| Build | Pasa | PASS | Web y API build OK |
| Playwright | Pasa | PASS | `2 passed`, chromium, sin retry global |
| Bundle | Limpio | PASS | 0 ocurrencias de `localhost:4300` |

## 2. Diagnostico inicial

La pantalla original funcionaba, pero el panel izquierdo dependia de tres cards genericos que diluian la marca:

- `Seguridad operativa`
- `Caja viva`
- `Lectura inmediata`

El formulario derecho tenia la estructura correcta y no debia redisenarse de forma radical. El flujo de login ya estaba conectado a `useAuth`, `react-hook-form`, validaciones con `zod`, loading, errores y redireccion por rol.

## 3. Assets encontrados

Busqueda de assets relevantes:

| Asset | Dimension | Uso |
| --- | --- | --- |
| `apps/web/public/brand/sidebar-logo.png` | `1408x768` | Logo real usado en sidebar y ahora en login |
| `apps/web/public/pwa/icon-512.png` | `512x512` | Icono PWA, no elegido |
| `apps/web/public/pwa/icon-1024.png` | `1024x1024` | Icono PWA, no elegido |

## 4. Asset elegido y motivo

Se eligio `apps/web/public/brand/sidebar-logo.png` porque es el recurso real de marca 2X1 Burger Co usado por la aplicacion. Se renderiza mediante `next/image` desde `/brand/sidebar-logo.png`, sin rutas inventadas ni assets externos.

## 5. Que se conservo

- Formulario de login del lado derecho.
- Texto `Acceso seguro`.
- Titulo `Iniciar sesión`.
- Input correo con `data-testid="login-email"`.
- Input contraseña con `data-testid="login-password"`.
- Boton submit con `data-testid="login-submit"`.
- Loading `Entrando...`.
- Validaciones existentes de correo y contraseña.
- Manejo de error de autenticacion.
- Link de meseros.
- Link de domiciliarios.
- Redireccion por `resolveDefaultRoute`.

## 6. Que se elimino

Se eliminaron completamente del login:

- Cards inferiores anteriores.
- Iconos de esos cards.
- Textos `Seguridad operativa`, `Caja viva`, `Lectura inmediata`.
- Importaciones `ShieldCheck`, `WalletCards`, `ChartColumnBig`.

## 7. Que se reestructuro

Panel izquierdo:

- Se transformo en un hero oscuro premium con acentos dorados.
- El logo real queda como elemento principal.
- Se agrego headline fuerte: `Control real para una operación que no se detiene.`
- Se agrego subheadline breve: `Ventas, caja e inventario conectados en una consola rápida, clara y segura.`
- Se agrego microcopy operativo en desktop/tablet.
- En mobile se compacta el panel para evitar altura excesiva antes del formulario.

Formulario derecho:

- Solo refinamiento visual menor.
- Se agrego `role="alert"` y `data-testid="login-error"` al error de autenticacion para accesibilidad y test estable.

## 8. Refuerzo de marca

La marca ahora se refuerza con:

- Logo real grande.
- Composicion visual centrada en 2X1 Burger Co.
- Paleta negra/dorada coherente con el asset.
- Copy operativo no generico.
- Ausencia de cards informativos repetitivos.
- Jerarquia visual clara: logo -> marca -> headline -> subheadline -> formulario.

## 9. Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `apps/web/src/app/login/page.tsx` | Rediseño del panel izquierdo, uso de `next/image`, eliminacion de cards, error accesible |
| `tests/e2e/audit8b-login-full-execution-hardline.spec.ts` | Test UI hardline de login, responsive, screenshots y auth |
| `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/` | Evidencia visual before/after |
| `infra/environments/staging/selfhosted-data/deployment-prep/audit-8b-login-full-execution-hardline-report.md` | Reporte final |

## 10. Screenshots

| Captura | Ruta |
| --- | --- |
| Before desktop | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/before/login-before-desktop-1440.png` |
| After desktop | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/desktop/login-desktop-1440x900.png` |
| After tablet | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/tablet/login-tablet-1024x768.png` |
| After mobile | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/mobile/login-mobile-390x844.png` |
| Error state | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/error-state/login-error-state.png` |
| Normal form visible | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/after/login-after-desktop.png` |
| Cards removed proof | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-login-full-execution-hardline/after/legacy-cards-removed-proof.png` |

## 11. Resultado typecheck

| Comando | Estado |
| --- | --- |
| `pnpm --filter @inventory-fastfood/web typecheck` | PASS |
| `pnpm --filter @inventory-fastfood/api typecheck` | PASS |

## 12. Resultado build

| Comando | Estado |
| --- | --- |
| `pnpm --filter @inventory-fastfood/web build` | PASS |
| `pnpm --filter @inventory-fastfood/api build` | PASS |

Nota: el build web mantiene warnings existentes de `@typescript-eslint/no-explicit-any` en modulos no relacionados con login. No bloquean build y no fueron introducidos por AUDIT-8B.

## 13. Resultado login

| Validacion | Estado |
| --- | --- |
| `curl http://localhost/api/health` | PASS |
| Login local admin por API | PASS |
| Login admin por UI Playwright | PASS |
| Redireccion a `/dashboard` | PASS |
| Heading `Panel de operación` visible | PASS |

No se imprimieron tokens ni secretos.

## 14. Resultado Playwright

Comando ejecutado:

```sh
npx playwright test tests/e2e/audit8b-login-full-execution-hardline.spec.ts --project=chromium --retries=0
```

Resultado:

```text
2 passed
```

Cobertura del test:

- `/login` carga.
- Formulario visible.
- Bloque de marca visible.
- Logo de marca visible.
- Cards antiguos ausentes.
- Email input visible.
- Password input visible.
- Boton entrar visible.
- Login admin funciona.
- Acceso meseros existe.
- Acceso domiciliarios existe.
- Mobile `390x844` sin overflow horizontal.
- Sin failed requests criticas.
- Sin errores criticos en consola.

## 15. Validacion responsive

| Viewport | Estado | Observacion |
| --- | --- | --- |
| Desktop `1440x900` | PASS | Logo protagonista y formulario balanceado |
| Tablet `1024x768` | PASS | Sin overflow, logo y formulario visibles |
| Mobile `390x844` | PASS | Hero compactado, formulario usable, sin overflow horizontal |

## 16. Auto-QA

| Pregunta | Resultado |
| --- | --- |
| Login funciona | PASS |
| Formulario derecho se conserva | PASS |
| Meseros visible | PASS |
| Domiciliarios visible | PASS |
| Logo gana protagonismo real | PASS |
| Tres cards eliminados | PASS |
| Pantalla mas premium | PASS |
| Panel izquierdo con proposito | PASS |
| Mobile usable | PASS |
| Typecheck pasa | PASS |
| Build pasa | PASS |
| Playwright pasa | PASS |
| Screenshots existen | PASS |
| No hay `localhost:4300` | PASS |
| Sin errores criticos | PASS |

## 17. Riesgos residuales

| Riesgo | Severidad | Accion |
| --- | --- | --- |
| Warnings existentes de ESLint por `any` en otros modulos | Baja | Resolver en una fase de hardening de tipos |
| Indicador de Next dev aparece en screenshots locales | Baja | No aparece en build productivo |
| El asset `sidebar-logo.png` pesa 1.6 MB | Media | Optimizar asset en fase posterior si se requiere performance mas fina |

## 18. Decision final

**LOGIN FULL EXECUTION HARDLINE: GO**

Motivo:

- El cambio visual es evidente.
- El logo queda protagonista.
- El panel izquierdo ya no parece plantilla generica.
- Los tres cards antiguos fueron eliminados.
- El formulario y flujo de autenticacion se conservan.
- Accesos de meseros y domiciliarios se mantienen.
- Responsive validado.
- Screenshots generados.
- Typecheck/build pasan.
- Playwright pasa sin retry global.
- Bundle no contiene `localhost:4300`.
