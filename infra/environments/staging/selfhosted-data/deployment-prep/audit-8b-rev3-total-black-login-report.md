# AUDIT-8B-REV3 - Total Black Login Brand Restructure Hardline

Fecha: 2026-06-19  
Modulo: Login web  
Archivo principal: `apps/web/src/app/login/page.tsx`  
Decision: **TOTAL BLACK LOGIN BRAND RESTRUCTURE: GO**

## 1. Resumen ejecutivo

Se rehizo visualmente el login con una direccion total black: fondo general negro, formulario oscuro, logo original protagonista, copy mas propio de 2X1 Burger Co y decoraciones sutiles de hamburguesa construidas con CSS.

No se cambio backend, base de datos, nginx, contratos de API ni flujo de autenticacion.

| Area | Resultado | Estado | Evidencia |
| --- | --- | --- | --- |
| Fondo negro | Pantalla completa en negro premium | PASS | `login-total-black-shell` |
| Logo | Asset original actual visible y protagonista | PASS | `/brand/sidebar-logo.png` |
| Copy | Reemplazado por copy de marca | PASS | Nuevo headline y microcopy |
| Formulario | Integrado al lenguaje oscuro | PASS | Inputs oscuros, boton ambar, errores legibles |
| Decoracion | Hamburguesas sutiles CSS | PASS | `login-burger-accent` |
| Auth | Login admin funciona | PASS | Playwright y curl |
| Meseros | Link conservado | PASS | `/waiter/login` |
| Domiciliarios | Link conservado | PASS | `/delivery/login` |
| Responsive | Desktop/tablet/mobile validado | PASS | Screenshots |
| Typecheck/build | Web y API pasan | PASS | Comandos ejecutados |
| Playwright | Pasa sin retries | PASS | `2 passed` |
| Bundle | Sin `localhost:4300` | PASS | grep 0 ocurrencias |

## 2. Que cambio respecto a la version anterior

Antes, el login ya tenia un panel de marca, pero la pagina completa seguia apoyandose en un fondo claro y el formulario estaba en una tarjeta blanca. REV3 reemplaza esa direccion por una experiencia oscura integral:

- Fondo general negro/carbon.
- Panel hero negro con acentos ambar.
- Formulario oscuro integrado.
- Logo cuadrado original como pieza principal.
- Copy menos generico y mas de marca.
- Decoraciones pequenas de hamburguesa con baja opacidad.

## 3. Asset de logo usado

Asset real:

`apps/web/public/brand/sidebar-logo.png`

Validacion:

| Propiedad | Valor |
| --- | --- |
| Formato | PNG |
| Dimensiones | `1254x1254` |
| Peso | `667886` bytes |
| Ruta publica | `/brand/sidebar-logo.png` |

Se usa con `next/image`. No se inventaron rutas ni se agregaron dependencias.

## 4. Como se aplico el fondo negro

La raiz del login usa `data-testid="login-total-black-shell"` con base `bg-[#050403]`. Encima se aplican gradientes oscuros, brillo ambar controlado y una reticula sutil de bajo contraste.

El resultado conserva negro dominante en toda la composicion:

- shell general negro,
- panel izquierdo negro,
- formulario negro,
- inputs negros,
- bordes y acentos ambar/blanco controlados.

## 5. Copy reemplazado

Se elimino el copy anterior:

- `Control real para una operación que no se detiene.`
- textos blandos tipo consola generica,
- referencias antiguas a cards `Seguridad operativa`, `Caja viva`, `Lectura inmediata`.

## 6. Copy final

Marca:

`2X1 Burger Co.`

Headline:

`El control detrás del mejor ritmo de 2X1 Burger Co.`

Subheadline:

`Ventas, caja e inventario alineados para que cada turno fluya con precisión.`

Microcopy:

`Diseñado para controlar cada movimiento y sostener el nivel que distingue a 2X1 Burger Co.`

Formulario:

`Entra al panel que mueve cada venta, cada caja y cada turno de 2X1 Burger Co.`

## 7. Contraste

El contraste se resolvio con:

- texto principal marfil `#fff8ea`,
- texto secundario `stone-200/300`,
- inputs negros con borde claro,
- focus ambar visible,
- boton ambar con texto negro,
- errores en rojo claro sobre fondo rojo oscuro.

## 8. Decoraciones de hamburguesa

Se incorporo un componente local `BurgerAccent` dentro de `page.tsx`.

Caracteristicas:

- no usa imagenes externas,
- no invade el formulario,
- baja opacidad,
- posicionamiento intencional en esquinas y fondos,
- detectable por `data-testid="login-burger-accent"`,
- construido con spans CSS para mantenerlo liviano.

## 9. Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `apps/web/src/app/login/page.tsx` | Total black redesign, copy nuevo, logo original, formulario oscuro, decoraciones CSS |
| `tests/e2e/audit8b-rev3-total-black-login.spec.ts` | Test UI REV3 con validacion visual, auth, responsive y screenshots |
| `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/` | Evidencia visual |
| `infra/environments/staging/selfhosted-data/deployment-prep/audit-8b-rev3-total-black-login-report.md` | Reporte final |

## 10. Screenshots

| Evidencia | Ruta |
| --- | --- |
| Before REV3 | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/before/login-before-rev3-desktop-1440.png` |
| Desktop `1440x900` | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/desktop/login-total-black-desktop-1440x900.png` |
| Tablet `1024x768` | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/tablet/login-total-black-tablet-1024x768.png` |
| Mobile `390x844` | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/mobile/login-total-black-mobile-390x844.png` |
| Error state | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/error-state/login-total-black-error-state.png` |
| Fondo negro/logo/decoracion | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/after/black-background-logo-decoration-proof.png` |
| Estado normal | `infra/environments/staging/selfhosted-data/deployment-prep/screenshots/audit-8b-rev3-total-black-login/after/login-total-black-after.png` |

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

Nota: persisten warnings historicos de `no-explicit-any` en modulos fuera del login. No fueron introducidos por REV3 y no bloquean build.

## 13. Resultado login

| Validacion | Estado |
| --- | --- |
| `curl http://localhost/api/health` | PASS |
| Login API `admin@2x1burger.co` | PASS |
| Login UI admin por Playwright | PASS |
| Redireccion a `/dashboard` | PASS |

Observacion: `admin@2x1burgerco.local` devuelve `401` en esta base local. No se modifico base de datos por regla hardline.

## 14. Resultado Playwright

Comando:

```sh
npx playwright test tests/e2e/audit8b-rev3-total-black-login.spec.ts --project=chromium --retries=0
```

Resultado:

```text
2 passed
```

Cobertura:

- `/login` carga.
- Fondo negro detectado.
- Logo visible.
- Copy nuevo visible.
- Copy generico anterior ausente.
- Decoraciones de hamburguesa visibles.
- Formulario visible.
- Email/password/submit visibles.
- Login admin funciona.
- Links meseros/domiciliarios conservados.
- Mobile sin overflow horizontal.
- Sin failed requests criticas.
- Sin errores criticos de consola.

## 15. Validacion responsive

| Viewport | Estado | Resultado |
| --- | --- | --- |
| Desktop `1440x900` | PASS | Composicion impactante, logo protagonista, formulario claro |
| Tablet `1024x768` | PASS | Sin overflow horizontal, contenido legible |
| Mobile `390x844` | PASS | Logo visible, formulario usable, decoracion no estorba |

## 16. Auto-QA

| Pregunta | Resultado |
| --- | --- |
| Pantalla realmente negra | PASS |
| Contraste resuelto | PASS |
| Logo original protagonista | PASS |
| Copy no generico | PASS |
| Pantalla mas de marca | PASS |
| Hamburguesas sutiles presentes | PASS |
| Composicion mejor organizada | PASS |
| Formulario funciona | PASS |
| Meseros conservado | PASS |
| Domiciliarios conservado | PASS |
| Responsive correcto | PASS |
| Build pasa | PASS |
| Typecheck pasa | PASS |
| Playwright pasa | PASS |
| Sin `localhost:4300` | PASS |
| Sin errores criticos | PASS |

## 17. Riesgos residuales

| Riesgo | Severidad | Accion |
| --- | --- | --- |
| Warnings historicos de ESLint en otros modulos | Baja | Resolver en fase de hardening tipado |
| Indicador de Next dev aparece en screenshots locales | Baja | No aplica al build productivo |
| Stack Docker local podia servir imagen anterior | Cerrado | Se reconstruyo `inventario-web` local y se recreo solo `web`; `localhost/login` ya sirve REV3 |

## 18. Decision

**TOTAL BLACK LOGIN BRAND RESTRUCTURE: GO**

Motivo:

- La pantalla completa se ve negra y premium.
- El logo original queda protagonista.
- El copy es mas fuerte y propio de 2X1 Burger Co.
- El formulario mantiene funcionalidad.
- Las decoraciones de hamburguesa son sutiles y ordenadas.
- Responsive validado.
- Screenshots generados.
- Typecheck/build pasan.
- Playwright pasa sin retries.
- Bundle sin `localhost:4300`.
