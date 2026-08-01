# Arquitectura del sistema

## Visión general

2X1 Burger Co opera como un monorepo con dos aplicaciones principales:

- `apps/api`: API NestJS, servicios de dominio, seguridad, integración con Prisma y conectores operativos.
- `apps/web`: interfaz administrativa y operativa construida con Next.js.

La persistencia utiliza PostgreSQL y Prisma. La infraestructura productiva se ejecuta mediante Docker Compose y Nginx.

## Componentes

```text
Usuarios / Meseros / Clientes
          ↓
Web / WhatsApp / Webhooks
          ↓
NestJS Controllers
          ↓
Application Services
          ↓
Domain Services
          ↓
Prisma
          ↓
PostgreSQL
```

## Dominios principales

- Autenticación y RBAC.
- Usuarios, roles y configuración.
- Productos, categorías y marcas.
- Ingredientes, recetas e inventario.
- Compras y proveedores.
- POS, ventas y comprobantes.
- Mesas, comandas y atención por mesero.
- Caja, gastos, cierres y reportes.
- Clientes, domicilios y pagos.
- SOFIA AI, CRM, WhatsApp, memoria, gobierno y auditoría.

## SOFIA AI

SOFIA se integra al backend existente; no mantiene un sistema paralelo. Su responsabilidad es interpretar conversaciones y coordinar capacidades autorizadas del dominio.

```text
WhatsApp inbound
      ↓
Validación de proveedor, firma e idempotencia
      ↓
Conversación y memoria
      ↓
Interpretación comercial
      ↓
Servicios autoritativos de producto, inventario y domicilio
      ↓
Borrador y confirmación
      ↓
OrdersService / comanda real
```

### Límites actuales

- Los proveedores mock están restringidos a pruebas.
- Las rutas sandbox no están disponibles en producción.
- Las mutaciones productivas de SOFIA permanecen gobernadas.
- El kill switch y la pausa global se conservan.
- La creación autónoma completa de comandas forma parte de las fases siguientes.

## Seguridad transversal

- JWT access/refresh y rotación de sesiones.
- RBAC por módulo y operación.
- Validación de firmas para webhooks.
- Idempotencia en eventos entrantes y mutaciones sensibles.
- Auditoría persistente.
- Redacción de PII y secretos.
- Backups cifrados.
- Restore validation en base temporal aislada.
- Startup/readiness fail-closed.

## Despliegue

```text
Pull Request
   ↓
CI y gates
   ↓
Merge a main
   ↓
Build desde SHA exacto de main
   ↓
Backup cifrado
   ↓
Despliegue controlado
   ↓
Health, readiness, seguridad y observación
```

El criterio de cierre exige la igualdad exacta:

```text
LOCAL_MAIN_SHA = ORIGIN_MAIN_SHA = PRODUCTION_SOURCE_SHA
```
