# Buildx remediation runbook

## Estado verificado

- Fecha UTC: 2026-06-21.
- Versión efectiva verificada: `docker buildx v0.30.1`.
- Requisito de `docker compose build`: `buildx >= 0.17`.
- Validación local:
  - `docker compose build api`: PASS.
  - `docker compose build web`: PASS.

## Comandos de verificación

```bash
docker buildx version
docker version
docker compose version
docker compose build api
docker compose build web
```

## Si vuelve a aparecer buildx antiguo

1. Verificar `docker buildx version`.
2. Actualizar Docker Desktop o el plugin local de buildx a una versión `>= 0.17`.
3. Cerrar y abrir de nuevo la sesión de terminal para evitar usar un binario cacheado.
4. Repetir `docker compose build api` y `docker compose build web`.

## Criterio production readiness

Production/V2 solo puede marcarse READY si ambos builds reproducibles (`api` y `web`) pasan en el host/pipeline objetivo.
