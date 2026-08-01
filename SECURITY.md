# Política de seguridad

## Alcance

Esta política cubre el monorepo, la infraestructura Docker, la base PostgreSQL, los flujos de CI/CD y las integraciones de SOFIA AI.

## Reporte de incidentes

Los incidentes de seguridad deben comunicarse de forma privada al propietario del repositorio. No deben abrirse issues públicos con secretos, credenciales, payloads sensibles o datos de clientes.

## Información que nunca debe publicarse

- Archivos `.env`.
- Tokens, contraseñas y connection strings.
- Claves privadas GPG o certificados privados.
- Dumps y backups de producción.
- Sesiones de WhatsApp, QR o material de autenticación.
- Datos personales completos de clientes.
- Payloads de proveedores que incluyan credenciales temporales.

## Controles obligatorios

- Autenticación JWT y RBAC.
- Firma e idempotencia de webhooks.
- Auditoría para mutaciones sensibles.
- Proveedores mock restringidos a `NODE_ENV=test`.
- Startup y readiness fail-closed.
- Kill switch y pausa operativa para SOFIA.
- Backups cifrados y restauración validada en aislamiento.
- Secret scan antes de merge y despliegue.

## Producción

Está prohibido ejecutar sobre la base productiva:

```text
prisma migrate reset
prisma db push
prisma migrate dev
seed no autorizado
restore sin backup y autorización
```

Las migraciones productivas deben usar `prisma migrate deploy` después de revisión SQL, backup cifrado y decisión GO.

## Dependencias y CI

- Las dependencias deben declararse explícitamente.
- No se deben ocultar fallos con exclusiones o bypasses.
- Todos los checks requeridos deben finalizar en PASS.
- Una falla crítica exige NO-GO o rollback.

## Respuesta a incidentes

1. Activar pausa o kill switch cuando corresponda.
2. Preservar logs y evidencia.
3. Detener nuevas mutaciones.
4. Verificar integridad de datos.
5. Ejecutar rollback autorizado si es necesario.
6. Documentar causa, impacto, corrección y controles preventivos.
