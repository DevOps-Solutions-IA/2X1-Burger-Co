# Phase 2.5.1-R1 - Root Cause

Fecha: 2026-07-15

## Flujo reproducido

```text
RequestLoggingMiddleware
  -> crea AuditRequestContext en AsyncLocalStorage
  -> JwtAuthGuard valida JWT y Passport asigna request.user
  -> RolesGuard evalúa roles/permisos
  -> si deniega, escribe RBAC_DENIED y lanza 403
  -> AuditContextInterceptor solo se ejecuta si todos los guards permiten
  -> controller/service
```

## Evidencia

| Pregunta | Resultado |
| --- | --- |
| ¿Dónde se obtiene `request.user`? | `JwtStrategy.validate()` produce `AuthUser`; Passport lo asigna durante `JwtAuthGuard`. |
| ¿Cuándo se crea ALS? | En `RequestLoggingMiddleware`, antes de guards. |
| ¿Cuándo se hidrata actorId/actorRole? | En `AuditContextInterceptor.setActor(request.user)`, después de guards. |
| ¿Por qué actorId llega al rechazo? | `RolesGuard` pasa `request.user.sub` directamente como `userId`. |
| ¿Por qué actorRole no llega? | `RolesGuard` no lo pasa y el interceptor aún no ejecutó. |
| ¿Hay múltiples guards? | Sí, `JwtAuthGuard` seguido de `RolesGuard` en rutas protegidas. |
| ¿Hay otro interceptor de actor? | No. El único global es `AuditContextInterceptor`. |
| ¿Cambia el orden entre rutas? | Las rutas protegidas usan la misma secuencia; rutas públicas omiten autenticación/RBAC según metadata. |

## Causa raíz

La hidratación del principal autenticado está situada demasiado tarde para auditar fallos de autorización. El contexto técnico existe, pero el contexto de actor solo se llena después de que `RolesGuard` haya permitido continuar.

## Diseño seleccionado

Estrategia B: `RolesGuard` hidrata `AuditContextService` desde `request.user` inmediatamente después de `JwtAuthGuard`, antes de evaluar y auditar. La misma API central conserva el interceptor como defensa para rutas sin `RolesGuard`.

Controles:

- el rol proviene exclusivamente del principal JWT validado;
- headers no pueden fijar actor ni rol;
- un contexto ya autenticado no puede reemplazarse por otro actor;
- usuario autenticado sin rol queda clasificado explícitamente como `no_role`;
- request/correlation/trace/idempotency permanecen intactos;
- 401 se audita aparte como `AUTHENTICATION_DENIED`, sin fingir actor autenticado.
