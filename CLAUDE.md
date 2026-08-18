# CLAUDE.md

Guía operativa para Claude Code al trabajar en este repositorio.

Todo reporte, explicación, conclusión, hallazgo y comunicación hacia el owner debe realizarse en español, excepto código, comandos, nombres técnicos, identificadores, variables, endpoints o mensajes literales provenientes de herramientas.

---

# 1. Propósito del repositorio

Este repositorio contiene `inventario-fastfood-system` para 2X1 Burger Co.

Es una aplicación operacional que integra, entre otros dominios:

* POS
* Inventario
* Caja
* Compras
* Gastos
* Domicilios
* Reportes
* Pagos
* SOFIA
* CRM

Stack principal:

* Frontend: Next.js + TypeScript
* Backend: NestJS + TypeScript
* Base de datos: PostgreSQL + Prisma
* Monorepo: pnpm workspaces
* Infraestructura: Docker Compose, nginx, health checks, backup/recovery y CI

---

# 2. Principio fundamental

SOFIA es una capa de inteligencia, automatización y orquestación gobernada.

SOFIA:

* NO reemplaza las autoridades canónicas del POS.
* NO reemplaza Caja.
* NO reemplaza Inventario.
* NO reemplaza Checkout.
* NO reemplaza Payments.
* NO reemplaza Delivery.
* NO crea autoridades paralelas de negocio.

SOFIA consume y orquesta capacidades existentes mediante contratos, servicios y comandos autorizados.

---

# 3. Autoridad del owner

El owner del proyecto puede autorizar explícitamente fases de:

* desarrollo
* preproducción
* canary
* activación productiva
* migración
* integración con proveedores reales
* WhatsApp real
* pagos reales
* Bold
* automatización
* pedidos
* delivery

Una autorización explícita del owner permite PREPARAR e IMPLEMENTAR código production-capable dentro del alcance autorizado.

Sin embargo:

**implementar una capacidad productiva y activarla físicamente son gates diferentes.**

Un agente puede implementar una capacidad autorizada sin activar tráfico, cobros, mensajes ni mutaciones productivas hasta recibir la autorización específica correspondiente.

---

# 4. Clasificación obligatoria de controles

Todos los controles del proyecto deben clasificarse como uno de estos tipos:

## A. PERMANENT_SAFETY_INVARIANT

Nunca se elimina ni debilita.

Incluye como mínimo:

* RBAC server-side
* autenticación
* protección PII
* secret management
* auditoría
* idempotencia
* protección de concurrencia
* versionado
* fail-closed
* kill switch
* recovery
* protección contra doble pago
* `UNKNOWN_RESULT`
* prohibición de fake-success
* prohibición de mocks productivos
* validación de webhooks
* autoridad financiera server-side
* protección de stock/caja
* separación test/production

## B. PREPRODUCTION_TEMPORARY_GATE

Control temporal usado durante construcción o validación.

Puede ser reemplazado por un gate productivo gobernado cuando el owner autorice la fase correspondiente.

## C. OWNER_ACTIVATION_GATE

Requiere autorización explícita del owner antes de activarse.

## D. PROVIDER_READINESS_GATE

Depende de credenciales, binding, health, cuenta, webhook, infraestructura o configuración real del proveedor.

## E. FINANCIAL_SAFETY_GATE

Protección adicional para operaciones monetarias.

No puede omitirse aunque exista autorización owner.

---

# 5. Regla principal de seguridad

Ante incertidumbre operacional o financiera:

**FAIL CLOSED.**

No asumir:

* permiso
* éxito
* pago confirmado
* pedido creado
* mensaje enviado
* entrega completada
* identidad
* consentimiento
* provider health

La ausencia de evidencia válida nunca debe convertirse en éxito.

---

# 6. Módulos críticos protegidos

Los siguientes dominios tienen autoridad propia y no deben ser duplicados o reescritos desde SOFIA:

* POS
* Caja
* Stock / Inventario
* Checkout
* Domicilios
* Pagos
* Precios
* Catálogo comercial
* Kitchen
* Reglas Maxy Family

Toda venta debe respetar las autoridades existentes de:

* stock
* caja
* pedido
* pago
* auditoría

Toda compra recibida debe respetar la autoridad de stock.

Los gastos deben conservar su relación con el cierre diario.

El cierre diario debe permanecer auditable.

---

# 7. Estado operacional vs política permanente

Los estados operativos actuales como:

* receive-only
* outbound OFF
* auto reply OFF
* Bold OFF
* producción OFF
* proveedor bloqueado
* allowlist activa

son **estado runtime**, no necesariamente reglas permanentes del sistema.

No convertir automáticamente el estado actual en una prohibición eterna.

El estado actual debe obtenerse del código/configuración/runtime y de la fuente de verdad técnica correspondiente.

La documentación de estado puede actualizarse cuando una fase cambia formalmente el runtime.

---

# 8. Modos SOFIA

SOFIA puede operar conceptualmente en diferentes niveles:

## Disabled

SOFIA no ejecuta operaciones.

## Sandbox

Simulación/laboratorio.

No constituye evidencia de operación real.

## Dry-run

Puede utilizar lógica o proveedor real para producir sugerencias, pero sin mutación productiva.

## Receive-only

Permite recepción real de WhatsApp sin outbound.

## Supervised

SOFIA puede proponer y ejecutar capacidades autorizadas mediante control humano, RBAC, SecureCommand y runtime safety.

## Controlled Production

Permite operación real únicamente cuando:

* owner gate aprobado
* provider ready
* runtime safety PASS
* RBAC PASS
* kill switch OFF
* global pause OFF
* capability habilitada
* requisitos específicos del dominio satisfechos

## Automated Production

Nivel superior de autonomía.

Requiere autorización owner independiente y políticas adicionales.

No debe asumirse automáticamente por habilitar Controlled Production.

---

# 9. SOFIA Runtime Safety

Runtime Safety debe permanecer como autoridad de seguridad operacional.

Debe controlar al menos:

* producción
* outbound
* auto reply
* auto safe
* kill switch
* global pause
* capability activation
* provider readiness
* allowlist cuando corresponda

La arquitectura production-grade debe permitir que una capacidad pueda estar:

* disponible
* deshabilitada
* supervisada
* bloqueada
* degradada
* pending approval
* activa

No debe requerirse eliminar Runtime Safety para entrar en producción.

Debe evolucionar de:

`permanentemente imposible`

a:

`activable solo cuando todos los gates requeridos pasan`.

---

# 10. SecureCommand

Las operaciones sensibles de SOFIA deben utilizar SecureCommand cuando corresponda.

Debe preservar:

* actor
* acción
* entidad
* idempotency key
* aprobación
* policy
* lifecycle
* lease
* concurrencia
* resultado
* recovery
* auditoría

No ejecutar mutaciones críticas directamente desde componentes frontend.

---

# 11. WhatsApp

WhatsApp debe utilizar la arquitectura canónica existente.

Mantener:

* provider binding
* account binding
* session ownership
* deduplicación
* rate limiting
* consentimiento
* handoff humano
* media security
* audit
* recovery
* provider health

## Receive-only

Puede utilizarse como primer canary real.

## Outbound real

Solo puede activarse mediante una fase formal aprobada.

Antes de habilitar outbound deben verificarse como mínimo:

* account binding correcto
* provider health
* session ownership
* consentimiento cuando aplique
* dedup
* idempotencia
* rate limiting
* handoff
* runtime safety
* kill switch
* auditoría

Un mock nunca puede sustituir evidencia productiva.

---

# 12. Auto Reply / Auto Safe

Auto Reply y Auto Safe NO son invariantes permanentemente prohibidos.

Son capacidades de alto riesgo que requieren gates específicos.

Pueden implementarse como production-capable cuando el owner autorice la fase correspondiente.

Su activación efectiva requiere:

* production capability autorizada
* runtime safety PASS
* outbound PASS
* provider ready
* policy PASS
* confidence / SafetyGuard
* RBAC
* handoff disponible
* kill switch operativo
* auditoría

Auto Safe nunca puede saltarse SecureCommand cuando SecureCommand sea requerido por la operación.

---

# 13. IA / DeepSeek

El proveedor IA puede evolucionar entre:

* disabled
* dry-run
* suggest
* supervised
* auto

El modo real debe respetar:

* provider health
* timeout
* retry policy
* redacción PII
* fallback
* SafetyGuard
* confidence
* runtime mode

DeepSeek real no debe implicar automáticamente automatización productiva.

---

# 14. Pedidos

SOFIA puede crear pedidos reales únicamente mediante una fase productiva autorizada y utilizando la autoridad canónica existente.

Flujo conceptual:

SOFIA
→ SecureCommand cuando corresponda
→ canonical Checkout
→ Order Orchestration
→ Kitchen / Delivery

Nunca crear un modelo paralelo de pedido.

Nunca asumir éxito por respuesta parcial.

Idempotencia obligatoria.

---

# 15. Pagos

Los pagos son infraestructura financiera crítica.

Reglas permanentes:

* frontend nunca determina `PAID`
* crear PaymentIntent no significa pago
* crear PaymentLink no significa pago
* redirect del navegador no significa pago
* request aceptado por proveedor no significa pago
* webhook sin verificar no significa pago
* no blind retry
* no duplicate charge

`UNKNOWN_RESULT` es un estado financiero de primera clase.

Ante `UNKNOWN_RESULT`:

* bloquear retry automático
* mantener evidencia
* solicitar reconciliación/revisión
* no cobrar nuevamente

Bold real requiere autorización owner separada y provider readiness.

---

# 16. Caja / Stock

SOFIA nunca debe escribir directamente en:

* Caja
* Stock

Debe utilizar las autoridades de dominio existentes.

Toda operación debe mantener:

* consistencia
* trazabilidad
* atomicidad
* reconciliación
* auditoría

---

# 17. CRM y PII

El CRM puede utilizar identidad persistida y Customer 360.

Debe respetar:

* PII masking
* identity hashes
* consent
* retention
* secret rotation
* RBAC
* audit

Nunca reconstruir PII protegida desde frontend.

Nunca mostrar números completos cuando el contrato backend entregue datos enmascarados.

---

# 18. Mocks y sandbox

Permitidos únicamente en:

* tests
* ambientes aislados
* fixtures
* CI
* sandbox explícitamente identificado

Prohibido en producción:

* mock WhatsApp
* mock payment provider
* fake-success
* fixture business results
* demo database como autoridad
* sample data presentado como real

---

# 19. Migraciones y Prisma

No ejecutar:

```bash
prisma migrate reset --force
```

en bases existentes del owner.

No modificar migraciones históricas.

Las migraciones nuevas deben ser:

* versionadas
* revisables
* ensayadas
* reconciliables
* recuperables

Una migración productiva requiere autorización explícita separada.

---

# 20. Producción

No confundir:

**código production-grade**

con:

**producción activada**.

Durante desarrollo puede construirse código completamente production-capable mientras tráfico real permanece OFF.

La activación productiva requiere una orden explícita del owner para el gate correspondiente.

Ejemplos de gates independientes:

* production runtime
* WhatsApp outbound
* Auto Reply
* Auto Safe
* Order creation
* Kitchen
* Bold
* Payment orchestration
* Delivery
* Notification workers

No activar todos automáticamente como consecuencia de autorizar uno.

---

# 21. Procedimiento formal de activación

Toda activación productiva debe seguir como mínimo:

1. Owner authorization.
2. Confirmar SHA exacto.
3. CI verde.
4. Dependency audit.
5. Secret scan.
6. Backup válido cuando corresponda.
7. Provider readiness.
8. Runtime safety PASS.
9. RBAC PASS.
10. Kill switch probado.
11. Recovery probado.
12. Canary.
13. Observación.
14. Reconciliación.
15. Expansión gradual.
16. Rollback disponible.

Si un gate falla:

STOP.

---

# 22. Regla Maxy Family

Composición autorizada:

```text
6 burgers + 1 porcion personal de papitas + 1 Pepsi 1.5 L
```

Upsell permitido:

```text
Si quieres que todos acompanen con papitas, puedes agregar porciones adicionales.
```

No usar como copy comercial válido:

* papas grandes
* papas familiares
* papas para todos
* porción familiar de papas
* papitas para todos
* combo familiar con papas familiares

Estas frases solo pueden aparecer en:

* blocklists
* pruebas negativas
* documentación técnica de prohibición

---

# 23. Seguridad y secretos

Nunca:

* imprimir `.env`
* publicar secretos
* mostrar API keys
* mostrar JWT
* guardar QR raw en reportes
* publicar session auth
* publicar private keys
* publicar contraseñas seed
* copiar números completos innecesariamente

Los reportes deben estar sanitizados.

---

# 24. Comandos comunes

```bash
pnpm install --frozen-lockfile
pnpm --filter @inventory-fastfood/api typecheck
pnpm --filter @inventory-fastfood/web typecheck
pnpm --filter @inventory-fastfood/api build
pnpm --filter @inventory-fastfood/web build
docker compose ps
curl -fsS http://localhost/api/health
```

---

# 25. Estructura relevante

```text
apps/api/          Backend NestJS
apps/web/          Frontend Next.js
packages/          Paquetes compartidos
prisma/            Schema y migraciones
infra/             Docker, nginx, backups y release
tests/e2e/         Playwright
docs/              Documentación
```

SOFIA:

```text
apps/api/src/modules/sofia/
apps/web/src/app/(app)/sofia/
apps/web/src/components/sofia/
```

---

# 26. Testing

Production-grade requiere pruebas más fuertes, no menos pruebas.

Ejecutar según el alcance:

* unit
* component
* contract
* architecture
* integration
* PostgreSQL concurrency
* E2E
* RBAC
* security
* secret scan
* dependency audit
* recovery
* migration rehearsal
* canary
* rollback

Mocks de tests nunca son evidencia productiva.

---

# 27. Reglas para agentes

Un agente NO debe:

* eliminar protecciones permanentes
* inventar fake-success
* debilitar controles financieros
* saltarse RBAC
* activar producción sin autorización
* activar proveedores reales automáticamente
* reescribir historia Git
* eliminar evidencia del owner

Un agente SÍ puede, cuando existe autorización explícita:

* implementar código production-capable
* transformar gates temporales en gates gobernados
* preparar providers reales
* crear tests productivos
* preparar canary
* preparar rollout
* preparar rollback
* construir mecanismos de activación segura

No debe negarse a preparar una capacidad production-grade únicamente porque el runtime actual esté desactivado, siempre que el owner haya autorizado explícitamente la fase de implementación y no se esté solicitando todavía su activación física.

---

# 28. Criterio de cierre para una fase de implementación

Antes de considerar una fase completa:

1. Alcance implementado completamente.
2. Backend authority preservada.
3. RBAC PASS.
4. Runtime Safety PASS.
5. Idempotencia PASS cuando aplique.
6. Concurrencia PASS cuando aplique.
7. Recovery PASS cuando aplique.
8. Auditoría PASS.
9. PII PASS.
10. Secret scan PASS.
11. Dependency audit PASS.
12. Typecheck PASS.
13. Build PASS.
14. Tests relevantes PASS.
15. CI PASS.
16. No mocks productivos.
17. No fake-success.
18. No TODO crítico.
19. Revisión independiente.
20. Owner review antes de merge cuando haya sido requerido.

---

# 29. Criterio de cierre para activación productiva

Una activación productiva no se considera completa hasta demostrar:

* configuración válida
* provider binding
* readiness
* canary
* health
* observabilidad
* auditoría
* reconciliación
* rollback
* ausencia de side effects inesperados

Cada capability puede activarse progresivamente.

---

# 30. Regla final

El objetivo arquitectónico no es mantener SOFIA permanentemente bloqueada.

El objetivo es:

**SOFIA production-capable, gobernada, auditable, reversible y fail-closed.**

La seguridad debe impedir operaciones incorrectas.

No debe impedir permanentemente operaciones correctas y explícitamente autorizadas.
